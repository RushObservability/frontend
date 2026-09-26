// Metric names from OpenTelemetry and Datadog often contain dots, such as
// `http.server.request.duration`. PromQL only accepts `[a-zA-Z_:][a-zA-Z0-9_:]*`
// as a bare metric name, so anything else has to be selected by name:
// `{__name__="http.server.request.duration"}`.

const BARE_METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/
const QUOTED = String.raw`"(?:[^"\\]|\\.)*"`

/** True when PromQL accepts `name` without quoting. */
export function isBareMetricName(name: string): boolean {
  return BARE_METRIC_NAME.test(name)
}

/**
 * A selector for `name` with optional extra matchers (`job="api", env="prod"`):
 * `up{job="api"}` for names PromQL accepts bare, otherwise
 * `{__name__="http.server.request.duration", job="api"}`.
 */
export function metricSelector(name: string, matchers = ''): string {
  const extra = matchers.trim()
  if (isBareMetricName(name)) return extra ? `${name}{${extra}}` : name
  const byName = `__name__=${JSON.stringify(name)}`
  return `{${extra ? `${byName}, ${extra}` : byName}}`
}

function unquote(literal: string): string | null {
  try {
    return JSON.parse(literal) as string
  } catch {
    return null
  }
}

/**
 * The metric name when `query` is nothing but one metric: `up`,
 * `{__name__="http.server.request.duration"}`, or `{"http.server.request.duration"}`.
 * Returns null for anything else, including selectors with other matchers.
 */
export function loneMetricName(query: string): string | null {
  const trimmed = query.trim()
  if (isBareMetricName(trimmed)) return trimmed
  const match = trimmed.match(new RegExp(String.raw`^\{\s*(?:__name__\s*=\s*)?(${QUOTED})\s*\}$`))
  return match ? unquote(match[1]!) : null
}

/**
 * The metric a selector's braces pick by name, for label completion inside
 * `{__name__="a.b", …}` or `{"a.b", …}`. `braceContent` is the text after `{`.
 */
export function metricNameInBraces(braceContent: string): string | null {
  const match = braceContent.match(new RegExp(String.raw`^\s*(?:__name__\s*=\s*)?(${QUOTED})`))
  if (match) return unquote(match[1]!)
  const anywhere = braceContent.match(new RegExp(String.raw`(?:^|,)\s*__name__\s*=\s*(${QUOTED})`))
  return anywhere ? unquote(anywhere[1]!) : null
}
