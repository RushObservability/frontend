// Rule-based natural-language → Explore filter parser (the ✦ search mode).
// It is the baseline that works without an LLM; /api/v1/parse-query only
// refines it when configured.
//
// The parser is mode-aware because the two Explore modes query different
// schemas: logs have a severity (`level`, resolved server-side to SeverityText),
// while APM spans have no level — an "error" there is an HTTP 5xx response
// (`http_status_code`).

export type NlMode = 'logs' | 'spans'

export interface NlChip { field: string; op: string; value: string | number }

export interface NlParseResult { chips: NlChip[]; search: string; confidence: number }

const STOPWORDS = new Set(['the', 'a', 'an', 'this', 'all', 'my', 'logs', 'log', 'errors', 'error',
  'warn', 'info', 'debug', 'that', 'which', 'with', 'have', 'show', 'me', 'i',
  'want', 'need', 'find', 'get', 'give', 'where', 'there', 'are', 'is', 'recent', 'latest'])

const SERVICE_PATTERNS: RegExp[] = [
  /\b(?:from|for)\s+(?:the\s+)?([a-z0-9][a-z0-9_-]*)\s+service\b/,
  /^([a-z0-9][a-z0-9_-]+)\s+service\b/,
  /\b(?:from|for)\s+(?:the\s+)?([a-z0-9][a-z0-9_-]{2,})\b(?!\s*service)/,
]

const FILLER_RE = /\b(?:i\s+want|show\s+me|give\s+me|find|look\s+for|search\s+for|that|which|have|having|with|containing|contain|the|a\b|an\b|in|on|at|of|and|or|where|there|are|is|from|for|logs?|events?|spans?|traces?)\b/g

const SERVER_ERROR_RE = /\b(?:5xx|server[\s-]+errors?)\b/g
const CLIENT_ERROR_RE = /\b(?:4xx|client[\s-]+errors?)\b/g
const ERROR_RE = /\berrors?\b/g

export function parseNaturalQuery(input: string, mode: NlMode): NlParseResult {
  const text = input.toLowerCase().trim()
  if (!text) return { chips: [], search: '', confidence: 0 }

  const chips: NlChip[] = []
  let remaining = text
  let confidence = 0.3
  const has = (re: RegExp) => { re.lastIndex = 0; return re.test(remaining) }
  const strip = (re: RegExp) => { remaining = remaining.replace(re, ' ') }

  // Service name: "from X service", "for X", "X service" at start
  for (const pat of SERVICE_PATTERNS) {
    const m = remaining.match(pat)
    if (m?.[1] && !STOPWORDS.has(m[1])) {
      chips.push({ field: 'service_name', op: '=', value: m[1] })
      remaining = remaining.replace(pat, ' ')
      confidence += 0.3
      break
    }
  }

  if (mode === 'spans') {
    // Spans have no log level: every "error" phrase is an HTTP status filter,
    // and the whole phrase is consumed so "server"/"client" never leak into
    // the free-text search.
    const status = 'http_status_code'
    if (has(SERVER_ERROR_RE)) {
      chips.push({ field: status, op: '>=', value: 500 })
      strip(SERVER_ERROR_RE)
      confidence += 0.2
    } else if (has(CLIENT_ERROR_RE)) {
      chips.push({ field: status, op: '>=', value: 400 })
      strip(CLIENT_ERROR_RE)
      confidence += 0.2
    } else {
      const sCode = remaining.match(/\b([1-5]\d{2})\b/)
      if (sCode?.[1]) {
        chips.push({ field: status, op: '=', value: parseInt(sCode[1]) })
        remaining = remaining.replace(sCode[0], ' ')
        confidence += 0.15
      }
    }
    if (has(ERROR_RE)) {
      if (!chips.some(c => c.field === status)) {
        chips.push({ field: status, op: '>=', value: 500 })
        confidence += 0.2
      }
      strip(ERROR_RE)
    }
  } else {
    // Log level. Logs have no HTTP status column, so status phrases map to
    // severity the same way the Logs-mode Status facet does (5xx = Error,
    // 4xx = Warning; see logStatusFacets.ts). The whole phrase is consumed so
    // "server"/"client"/"5xx" never leak into the free-text search. A bare
    // 3-digit code is left as search text: log bodies carry it as a token
    // (e.g. "response status=503"), which the Body text index matches.
    if (has(SERVER_ERROR_RE)) {
      chips.push({ field: 'level', op: '=', value: 'error' })
      strip(SERVER_ERROR_RE)
      strip(ERROR_RE)
      confidence += 0.2
    } else if (has(CLIENT_ERROR_RE)) {
      chips.push({ field: 'level', op: '=', value: 'warn' })
      strip(CLIENT_ERROR_RE)
      strip(ERROR_RE)
      confidence += 0.2
    } else if (/\berrors?\b/.test(remaining)) {
      chips.push({ field: 'level', op: '=', value: 'error' })
      remaining = remaining.replace(/\berrors?\b/g, ' ')
      confidence += 0.2
    } else if (/\bwarn(?:ing)?s?\b/.test(remaining)) {
      chips.push({ field: 'level', op: '=', value: 'warn' })
      remaining = remaining.replace(/\bwarn(?:ing)?s?\b/g, ' ')
      confidence += 0.2
    } else if (/\bdebugs?\b/.test(remaining)) {
      chips.push({ field: 'level', op: '=', value: 'debug' })
      remaining = remaining.replace(/\bdebugs?\b/g, ' ')
      confidence += 0.2
    }
  }

  // Environment
  const envMatch = remaining.match(/\b(production|prod|staging|stage|dev|development)\b/)
  if (envMatch?.[1]) {
    const raw = envMatch[1]
    const envVal = raw === 'prod' ? 'production' : (raw === 'stage' ? 'staging' : (raw === 'dev' ? 'development' : raw))
    chips.push({ field: 'environment', op: '=', value: envVal })
    remaining = remaining.replace(envMatch[0], ' ')
    confidence += 0.1
  }

  // Strip filler words and clean up remaining
  const searchText = remaining.replace(FILLER_RE, ' ').replace(/\s+/g, ' ').trim()

  return { chips, search: searchText, confidence: Math.min(confidence, 1.0) }
}
