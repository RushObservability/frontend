import { describe, expect, it } from 'vitest'
import source from './ExploreView.vue?raw'

function between(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `missing ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('Explore query plan', () => {
  it('shows the latency chart by default for trace results', () => {
    expect(source).toContain('const scatterExpanded = ref(true)')
    expect(source).toContain('<div v-if="scatterExpanded" id="latency-over-time-chart"')
  })

  it('keeps the latency chart legible and gives percentiles plain-language context', () => {
    expect(source).toContain('preserveAspectRatio="xMidYMid meet"')
    expect(source).toContain('<b>P50</b> typical')
    expect(source).toContain('<b>P95</b> slow boundary')
    expect(source).toContain('<b>P99</b> tail')
    expect(source).toContain('LATENCY · LOG SCALE')
    expect(source).toContain('scatterHoverPosition')
  })

  it('anchors the latency x-axis to the selected Explore time range', () => {
    const scale = between('const scatterScale = computed(', 'function scatterX(')
    expect(scale).toContain('new Date(timeRange.value.from).getTime()')
    expect(scale).toContain('new Date(timeRange.value.to).getTime()')
    expect(scale).not.toContain('const minT = Math.min(...times')
  })

  it('loads a full-range latency heatmap with a percentile trend fallback', () => {
    const search = between('async function search(', 'async function loadMore(')
    expect(search).toContain('settleLatencyTimeseries({')
    expect(search).toContain('time_range: timeRange.value')
    expect(search).toContain('interval: intervalBucket')
    expect(search).toContain('include_heatmap: true')
    expect(source).toContain("const scatterMode = ref<'heatmap' | 'trend' | 'dots'>('heatmap')")
    expect(source).toContain('latencyHeatmap.value = latencyResult.response.heatmap ?? []')
    expect(source).toContain('const scatterHeatmapCells = computed<ScatterHeatmapCell[]>')
    expect(source).toContain('const robustCeiling = Math.max(4, percentile(counts, .95))')
    expect(source).toContain('width: Math.max(1, right - left - .7)')
    expect(source).toContain('height: Math.max(1, bottom - top - .7)')
    expect(source).toContain('class="scatter-heatmap-cell"')
    expect(source).toContain('scatterHoverHeatmap = heatmapCell')
    expect(source).toContain("scatterTrendLinePath('p50_ms')")
    expect(source).toContain("scatterTrendLinePath('p95_ms')")
    expect(source).toContain("scatterTrendLinePath('p99_ms')")
  })

  it('loads chart selections into the span table with matching time and duration bounds', () => {
    const cohortLoader = between('async function loadScatterCohortRows(', 'function setScatterSelection(')
    expect(cohortLoader).toContain("time_range: { from: selection.startTime, to: selection.endTime }")
    expect(cohortLoader).toContain("cohortFilters.push({ field: 'duration_ns', op: '>=', value: selection.minDurationNs })")
    expect(cohortLoader).toContain("cohortFilters.push({ field: 'duration_ns', op: '<=', value: selection.maxDurationNs })")
    expect(cohortLoader).toContain('await api.queryEvents({')
    expect(cohortLoader).toContain('scatterCohortController !== controller')
    expect(cohortLoader).not.toContain('scatterPendingSelection.value !== selection')
    expect(cohortLoader).toContain('scatterCohortRows.value = response.rows')

    const spanTable = between('<!-- ═══ Event Table (Spans mode) ═══ -->', '<!-- /event-table (spans) -->')
    expect(spanTable).toContain(':count="visibleSpanResults.length"')
    expect(spanTable).toContain('spans in the selected cohort')
    expect(source).toContain('return visibleSpanResults.value[index]!')
    expect(source).toContain('resetScatterCohortRows()')
  })

  it('round-trips a selected latency cohort through the Explore URL', () => {
    const queryParams = between('function buildQueryParams()', 'function buildShareUrl()')
    expect(queryParams).toContain("p.cohort = 'latency'")
    expect(queryParams).toContain('p.cohort_from = cohort.startTime')
    expect(queryParams).toContain('p.cohort_to = cohort.endTime')
    expect(queryParams).toContain('p.cohort_min_ns = String(cohort.minDurationNs)')
    expect(queryParams).toContain('p.cohort_max_ns = String(cohort.maxDurationNs)')
    expect(queryParams).toContain("p.cohort_compare = '1'")

    const restore = between('function restoreFromUrl()', '// ── Export')
    expect(restore).toContain("q.cohort === 'latency'")
    expect(restore).toContain('pendingLatencyDeepLink.value = {')
    expect(restore).toContain('validOrder')

    const mounted = between('onMounted(async () => {', '// Deep-link: scroll to + highlight')
    expect(mounted).toContain('scatterBrush.value = {')
    expect(mounted).toContain('setScatterSelection(selection)')
    expect(mounted).toContain('if (pending.compare) analyzeScatterSelection()')

    const selectionSetter = between('function setScatterSelection(', 'const scatterPendingSelection')
    expect(selectionSetter).toContain('syncUrlState()')
  })

  it('does not rewrite a shared cohort URL while startup searches are still running', () => {
    const sync = between('function syncUrlState()', 'async function shareLink()')
    expect(sync).toContain('if (restoringUrlState) return')
    expect(sync).toContain('function finishUrlRestore()')
    expect(source).not.toContain('skipNextUrlSync')

    const mounted = between('onMounted(async () => {', '// Deep-link: scroll to + highlight')
    expect(mounted.indexOf('setScatterSelection(selection)')).toBeLessThan(mounted.indexOf('finishUrlRestore()'))
  })

  it('does not render a duplicate logs-only histogram', () => {
    expect(source).not.toContain('Matches over time')
    expect(source).not.toContain('matchHisto')
  })

  it('uses the reusable signal timeline for both logs and traces', () => {
    expect(source).toContain("import SignalTimelinePanel from '../components/panels/SignalTimelinePanel.vue'")
    expect(source).toContain('<SignalTimelinePanel')
    expect(source).toContain(":signal=\"viewMode === 'logs' ? 'logs' : 'spans'\"")
    expect(source).toContain('@range-select="onTimelineRangeSelect"')
    expect(source).not.toContain('class="histo-bars"')
  })

  it('loads rows and summaries independently for an initial search', () => {
    const search = between('async function search(', 'async function loadMore(')
    expect(search.match(/api\.queryExplore\(/g)).toHaveLength(1)
    expect(search).toContain('settleExploreRequest({')
    expect(search).toContain('include_rows: true')
    expect(search).toContain('include_summary: false')
    expect(search).toContain('include_rows: false')
    expect(search).toContain('include_summary: true')
    for (const legacyCall of [
      'api.queryEvents(',
      'api.queryLogs(',
      'api.queryCount(',
      'api.countLogs(',
      'api.queryGroup(',
      'api.getLogHistogram(',
    ]) {
      expect(search).not.toContain(legacyCall)
    }
  })

  it('loads rows and summaries independently for each live refresh', () => {
    const livePoll = between('async function livePoll(', 'const liveLoop =')
    expect(livePoll.match(/api\.queryExplore\(/g)).toHaveLength(1)
    expect(livePoll).toContain('settleExploreRequest({')
    expect(livePoll).toContain('include_rows: true')
    expect(livePoll).toContain('include_summary: false')
    expect(livePoll).toContain('settleLatencyTimeseries({')
    expect(livePoll).not.toContain('api.queryEvents(')
    expect(livePoll).not.toContain('api.queryCount(')
    expect(livePoll).not.toContain('api.countLogs(')
  })
})
