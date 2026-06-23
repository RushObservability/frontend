<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useApi } from '../composables/useApi'
import type { UsageResponse, UsageEntry, UnusedMetric, CardinalityEntry, LabelBreakdownResponse, LabelCardinality } from '../types'

const api = useApi()

const usage = ref<UsageResponse | null>(null)
const loadingUsage = ref(false)

const filterType = ref<string>('')
const daysBack = ref(30)

const dayPresets = [7, 14, 30, 60, 90]

// Cardinality drill-down state
const expandedMetric = ref<string | null>(null)
const labelBreakdown = ref<LabelBreakdownResponse | null>(null)
const loadingBreakdown = ref(false)

onMounted(() => loadUsage())

async function loadUsage() {
  loadingUsage.value = true
  try {
    usage.value = await api.getUsage({
      signal_type: filterType.value || undefined,
      days: daysBack.value,
      limit: 200,
    })
  } catch {
    /* error in api.error */
  } finally {
    loadingUsage.value = false
  }
}

function selectType(t: string) {
  filterType.value = t
  loadUsage()
}

function selectDays(d: number) {
  daysBack.value = d
  loadUsage()
}

async function toggleMetric(metric: string) {
  if (expandedMetric.value === metric) {
    expandedMetric.value = null
    labelBreakdown.value = null
    return
  }
  expandedMetric.value = metric
  loadingBreakdown.value = true
  try {
    labelBreakdown.value = await api.getLabelBreakdown(metric)
  } catch {
    labelBreakdown.value = null
  } finally {
    loadingBreakdown.value = false
  }
}

const usageList = computed<UsageEntry[]>(() => usage.value?.usage ?? [])
const unusedList = computed<UnusedMetric[]>(() => usage.value?.unused ?? [])
const cardinalityList = computed<CardinalityEntry[]>(() => usage.value?.cardinality ?? [])
const totalTracked = computed(() => usage.value?.total ?? 0)
const totalSeries = computed(() => cardinalityList.value.reduce((sum, c) => sum + c.series_count, 0))

const breakdownTotal = computed(() => {
  if (!labelBreakdown.value) return 0
  return labelBreakdown.value.labels.reduce((s, l) => s + l.unique_values, 0)
})

function formatDate(ts: string): string {
  const ms = parseInt(ts, 10)
  if (isNaN(ms)) return ts
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago'
  return Math.floor(diff / 86_400_000) + 'd ago'
}

function typeColor(t: string): string {
  switch (t) {
    case 'metric': return 'var(--ok)'
    case 'span': return 'var(--amber)'
    case 'log': return '#5b8dd9'
    default: return 'var(--text-secondary)'
  }
}

function cardinalityPct(count: number): number {
  const max = cardinalityList.value[0]?.series_count || 1
  return Math.max(2, (count / max) * 100)
}

function cardinalityLevel(count: number): string {
  if (count >= 1000) return 'card-high'
  if (count >= 100) return 'card-medium'
  return 'card-low'
}

// Treemap colors
const treemapColors = [
  '#e2884d', '#5b8dd9', '#4caf7c', '#d4605a', '#9c6ade',
  '#e0a030', '#47a3a3', '#c45ea0', '#7c8ea0', '#6bbf6b',
]

function treemapPct(label: LabelCardinality): number {
  if (!breakdownTotal.value) return 0
  return (label.unique_values / breakdownTotal.value) * 100
}
</script>

<template>
  <div class="usage-view">
    <header class="usage-header">
      <h1>Signal Usage</h1>
      <p class="subtitle">Track which metrics, spans, and logs are being queried</p>
    </header>

    <!-- Controls -->
    <div class="usage-controls">
      <div class="control-group">
        <label>Signal type</label>
        <div class="btn-group">
          <button :class="{ active: filterType === '' }" @click="selectType('')">All</button>
          <button :class="{ active: filterType === 'metric' }" @click="selectType('metric')">Metrics</button>
          <button :class="{ active: filterType === 'span' }" @click="selectType('span')">Spans</button>
          <button :class="{ active: filterType === 'log' }" @click="selectType('log')">Logs</button>
        </div>
      </div>
      <div class="control-group">
        <label>Lookback</label>
        <div class="btn-group">
          <button v-for="d in dayPresets" :key="d" :class="{ active: daysBack === d }" @click="selectDays(d)">
            {{ d }}d
          </button>
        </div>
      </div>
    </div>

    <div v-if="loadingUsage" class="loading-state">Loading usage data...</div>

    <template v-else-if="usage">
      <!-- Summary row -->
      <div class="summary-row">
        <div class="summary-card">
          <div class="summary-value">{{ totalTracked }}</div>
          <div class="summary-label">Tracked signals</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ totalSeries.toLocaleString() }}</div>
          <div class="summary-label">Total series</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ cardinalityList.length }}</div>
          <div class="summary-label">Unique metrics</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ unusedList.length }}</div>
          <div class="summary-label">Unused metrics</div>
        </div>
      </div>

      <!-- Usage table -->
      <section class="usage-section">
        <h2>Queried Signals</h2>
        <div class="usage-table-wrap">
          <table class="usage-table" v-if="usageList.length > 0">
            <thead>
              <tr>
                <th>Signal Name</th>
                <th>Type</th>
                <th>Source</th>
                <th>Last Queried</th>
                <th class="num">Queries</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in usageList" :key="i">
                <td class="signal-name">{{ row.signal_name }}</td>
                <td><span class="type-badge" :style="{ background: typeColor(row.signal_type) }">{{ row.signal_type }}</span></td>
                <td class="source-cell">{{ row.source }}</td>
                <td class="date-cell">{{ formatDate(row.last_queried_at) }}</td>
                <td class="num">{{ row.query_count }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-state">No usage data yet. Queries will be tracked as they happen.</div>
        </div>
      </section>

      <!-- Cardinality explorer -->
      <section class="usage-section" v-if="cardinalityList.length > 0">
        <h2>Cardinality Explorer <span class="badge-count">{{ totalSeries.toLocaleString() }} series</span></h2>
        <p class="section-desc">Click a metric to see which labels drive its cardinality.</p>
        <div class="usage-table-wrap">
          <table class="usage-table cardinality-table">
            <thead>
              <tr>
                <th>Metric Name</th>
                <th class="num">Series</th>
                <th class="num">Labels</th>
                <th>Cardinality</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(row, i) in cardinalityList" :key="i">
                <tr class="card-row" :class="{ expanded: expandedMetric === row.metric_name }" @click="toggleMetric(row.metric_name)">
                  <td class="signal-name">
                    <span class="expand-icon">{{ expandedMetric === row.metric_name ? '▾' : '▸' }}</span>
                    {{ row.metric_name }}
                  </td>
                  <td class="num">{{ row.series_count.toLocaleString() }}</td>
                  <td class="num">{{ row.label_count }}</td>
                  <td class="bar-cell">
                    <div class="cardinality-bar" :style="{ width: cardinalityPct(row.series_count) + '%' }" :class="cardinalityLevel(row.series_count)"></div>
                  </td>
                </tr>
                <!-- Expanded label breakdown -->
                <tr v-if="expandedMetric === row.metric_name" class="breakdown-row">
                  <td colspan="4">
                    <div v-if="loadingBreakdown" class="breakdown-loading">Loading label breakdown...</div>
                    <div v-else-if="labelBreakdown && labelBreakdown.labels.length > 0" class="breakdown-panel">
                      <div class="breakdown-header">
                        <span class="breakdown-title">Label Cardinality for {{ row.metric_name }}</span>
                        <span class="breakdown-total">{{ labelBreakdown.total_series.toLocaleString() }} total series</span>
                      </div>

                      <!-- Treemap visualization -->
                      <div class="treemap">
                        <div
                          v-for="(label, j) in labelBreakdown.labels"
                          :key="label.label_key"
                          class="treemap-block"
                          :style="{
                            flexBasis: Math.max(treemapPct(label), 8) + '%',
                            flexGrow: treemapPct(label),
                            background: treemapColors[j % treemapColors.length],
                          }"
                        >
                          <div class="treemap-label">{{ label.label_key }}</div>
                          <div class="treemap-value">{{ label.unique_values }} values</div>
                          <div class="treemap-pct">{{ treemapPct(label).toFixed(0) }}%</div>
                        </div>
                      </div>

                      <!-- Label table -->
                      <table class="breakdown-table">
                        <thead>
                          <tr>
                            <th>Label</th>
                            <th class="num">Unique Values</th>
                            <th>Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(label, j) in labelBreakdown.labels" :key="label.label_key">
                            <td class="label-key">
                              <span class="label-dot" :style="{ background: treemapColors[j % treemapColors.length] }"></span>
                              {{ label.label_key }}
                            </td>
                            <td class="num">{{ label.unique_values }}</td>
                            <td>
                              <div class="share-bar-wrap">
                                <div class="share-bar" :style="{ width: treemapPct(label) + '%', background: treemapColors[j % treemapColors.length] }"></div>
                                <span class="share-text">{{ treemapPct(label).toFixed(1) }}%</span>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div v-else class="breakdown-empty">No label data available.</div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Unused metrics -->
      <section class="usage-section" v-if="unusedList.length > 0">
        <h2>Unused Metrics <span class="badge-count">{{ unusedList.length }}</span></h2>
        <p class="section-desc">These metrics are being collected but haven't been queried in the last {{ daysBack }} days.</p>
        <div class="usage-table-wrap">
          <table class="usage-table">
            <thead>
              <tr>
                <th>Metric Name</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in unusedList" :key="i">
                <td class="signal-name">{{ row.metric_name }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped src="../styles/views/UsageView.css"></style>
