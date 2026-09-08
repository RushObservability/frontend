import type { SpanNode } from '../types'

/** One rendered line of the waterfall: a span, its indent, and its child count. */
export interface WaterfallRow {
  span: SpanNode
  depth: number
  childCount: number
}

/** Grid lines and time labels, as percentages across the bar column. */
export const WATERFALL_TICKS = [0, 25, 50, 75, 100]

/** Service line colours, indexed by the trace's service order. */
export const SERVICE_COLORS = [
  '#3b82f6', '#47b881', '#5b8dd9', '#9b7dd4',
  '#e5584f', '#06b6d4', '#84cc16', '#f97316',
]

export function serviceColor(name: string, services: readonly string[] | undefined): string {
  if (!services) return SERVICE_COLORS[0]!
  const index = services.indexOf(name)
  return SERVICE_COLORS[(index >= 0 ? index : 0) % SERVICE_COLORS.length]!
}

/**
 * Parse "YYYY-MM-DD HH:MM:SS.nnnnnnnnn" into microseconds since the epoch.
 *
 * Microseconds rather than nanoseconds: nanoseconds since 1970 exceed JS's safe
 * integer range, microseconds stay exact for roughly another 285 years.
 */
export function parseTraceTimestamp(ts: string): number {
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})\.?(\d*)/)
  if (!m) return 0
  const epochMs = new Date(`${m[1]}T${m[2]}Z`).getTime()
  if (Number.isNaN(epochMs)) return 0
  const frac = (m[3] || '0').padEnd(6, '0').slice(0, 6)
  return epochMs * 1000 + parseInt(frac, 10)
}

/** Depth-first span list in start order, ignoring collapse state. */
export function flattenSpans(spans: readonly SpanNode[]): SpanNode[] {
  const flat: SpanNode[] = []
  function walk(nodes: readonly SpanNode[]) {
    for (const node of nodes) {
      flat.push(node)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(spans)
  return flat.sort((a, b) => parseTraceTimestamp(a.timestamp) - parseTraceTimestamp(b.timestamp))
}

/** Visible rows, honouring collapsed branches. Children sort by start time. */
export function buildWaterfallRows(
  roots: readonly SpanNode[],
  collapsed: ReadonlySet<string>,
): WaterfallRow[] {
  const rows: WaterfallRow[] = []
  function walk(spans: readonly SpanNode[], depth: number) {
    const ordered = [...spans].sort(
      (a, b) => parseTraceTimestamp(a.timestamp) - parseTraceTimestamp(b.timestamp),
    )
    for (const span of ordered) {
      const children = span.children ?? []
      rows.push({ span, depth, childCount: children.length })
      if (children.length && !collapsed.has(span.span_id)) walk(children, depth + 1)
    }
  }
  walk(roots, 0)
  return rows
}

/** Left edge of a span's bar, as a percentage of the trace duration. */
export function barOffsetPercent(
  span: SpanNode,
  orderedSpans: readonly SpanNode[],
  traceDurationNs: number,
): string {
  if (orderedSpans.length === 0 || traceDurationNs <= 0) return '0%'
  const firstUs = parseTraceTimestamp(orderedSpans[0]!.timestamp)
  const spanUs = parseTraceTimestamp(span.timestamp)
  const diffNs = (spanUs - firstUs) * 1000
  const pct = Math.max((diffNs / traceDurationNs) * 100, 0)
  // Capped so a span starting at the very end still shows a sliver of bar.
  return `${Math.min(pct, 95)}%`
}

/** Width of a span's bar, floored so sub-millisecond spans stay visible. */
export function barWidthPercent(span: SpanNode, traceDurationNs: number): string {
  if (traceDurationNs <= 0) return '1%'
  return `${Math.max(0.5, (span.duration_ns / traceDurationNs) * 100)}%`
}

export function isSpanError(span: SpanNode): boolean {
  return span.status.toUpperCase() === 'ERROR' || span.http_status_code >= 400
}

/** Human label for a span: HTTP route, else its name attribute, else a short id. */
export function spanOperation(span: SpanNode): string {
  if (span.http_method || span.http_path) return `${span.http_method} ${span.http_path}`.trim()
  const name = span.attributes?.['name']
  return typeof name === 'string' && name ? name : span.span_id.slice(0, 8)
}

export function formatSpanDuration(ns: number): string {
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(0)}µs`
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(1)}ms`
  return `${(ns / 1_000_000_000).toFixed(2)}s`
}

export function durationClass(ns: number): string {
  if (ns >= 1_000_000_000) return 'dur-slow'
  if (ns >= 500_000_000) return 'dur-warn'
  if (ns >= 100_000_000) return 'dur-med'
  return 'dur-fast'
}

export function spanStatusClass(status: string, code: number): string {
  if (status === 'ERROR' || code >= 500) return 'status-error'
  if (code >= 400) return 'status-warning'
  return 'status-ok'
}

const NOISE_ATTR_KEYS = new Set(['name', 'http.method', 'http.route', 'http.target', 'http.url'])

/** Span attributes worth showing, minus values already rendered in the row. */
export function displayableSpanAttrs(span: SpanNode): Record<string, unknown> {
  const attrs = (span.attributes && typeof span.attributes === 'object')
    ? span.attributes as Record<string, unknown>
    : {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (!NOISE_ATTR_KEYS.has(key) && value !== '' && value !== undefined) out[key] = value
  }
  return out
}
