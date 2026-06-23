<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useApi } from '../composables/useApi'

const props = defineProps<{
  metricNames: string[]
  timePreset: number
}>()

const emit = defineEmits<{
  select: [metric: string, query: string]
}>()

const api = useApi()

// ═══ Search & filter ═══
const search = ref('')
const activePrefix = ref<string | null>(null)
const sortMode = ref<'az' | 'type'>('az')
const pageSize = 24
const visibleCount = ref(pageSize)

const counterSuffixes = ['_total', '_count', '_bucket', '_sum']

function looksLikeCounter(name: string): boolean {
  return counterSuffixes.some(s => name.endsWith(s))
}

function metricType(name: string): 'counter' | 'gauge' {
  return looksLikeCounter(name) ? 'counter' : 'gauge'
}

function suggestedQuery(name: string): string {
  return looksLikeCounter(name) ? `rate(${name}[5m])` : name
}

// ═══ Prefix extraction ═══
const prefixChips = computed(() => {
  const freq = new Map<string, number>()
  for (const name of props.metricNames) {
    const idx = name.indexOf('_')
    if (idx > 0) {
      const prefix = name.slice(0, idx + 1)
      freq.set(prefix, (freq.get(prefix) || 0) + 1)
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([prefix, count]) => ({ prefix, count }))
})

// ═══ Filtered + sorted metrics ═══
const filteredMetrics = computed(() => {
  let list = props.metricNames

  if (activePrefix.value) {
    list = list.filter(m => m.startsWith(activePrefix.value!))
  }

  if (search.value) {
    const lower = search.value.toLowerCase()
    list = list.filter(m => m.toLowerCase().includes(lower))
  }

  if (sortMode.value === 'type') {
    list = [...list].sort((a, b) => {
      const ta = metricType(a)
      const tb = metricType(b)
      if (ta === tb) return a.localeCompare(b)
      return ta === 'gauge' ? -1 : 1
    })
  } else {
    list = [...list].sort((a, b) => a.localeCompare(b))
  }

  return list
})

const visibleMetrics = computed(() => filteredMetrics.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filteredMetrics.value.length)

function loadMore() {
  visibleCount.value += pageSize
}

function togglePrefix(prefix: string) {
  activePrefix.value = activePrefix.value === prefix ? null : prefix
  visibleCount.value = pageSize
}

function clearPrefix() {
  activePrefix.value = null
  visibleCount.value = pageSize
}

// Reset pagination on search/filter change
watch([search, activePrefix, sortMode], () => {
  visibleCount.value = pageSize
})

// ═══ Sparkline cache & lazy loading ═══
interface SparkData {
  values: number[]
  timestamps: number[]
}
const sparklineCache = new Map<string, SparkData>()
const sparklineLoading = new Set<string>()
const cardRefs = ref<Map<string, HTMLElement>>(new Map())
let observer: IntersectionObserver | null = null

// Reactive trigger for sparkline updates
const sparklineVersion = ref(0)

// ═══ Shared hover state ═══
const sharedHoverRatio = ref<number | null>(null) // 0-1 across x range

async function fetchSparkline(metricName: string) {
  if (sparklineCache.has(metricName) || sparklineLoading.has(metricName)) return
  sparklineLoading.add(metricName)

  try {
    const now = Math.floor(Date.now() / 1000)
    const start = now - props.timePreset * 60
    const points = 60
    const step = Math.max(1, Math.floor((now - start) / points))
    const q = suggestedQuery(metricName)
    const data = await api.promQueryRange(q, start, now, step)
    if (data.resultType === 'matrix' && data.result.length > 0) {
      const values = data.result[0]!.values.map(([, v]) => parseFloat(v))
      const timestamps = data.result[0]!.values.map(([t]) => t)
      sparklineCache.set(metricName, { values, timestamps })
    } else {
      sparklineCache.set(metricName, { values: [], timestamps: [] })
    }
  } catch {
    sparklineCache.set(metricName, { values: [], timestamps: [] })
  } finally {
    sparklineLoading.delete(metricName)
    sparklineVersion.value++
  }
}

// Sparkline SVG dimensions
const sparkW = 200
const sparkH = 48
const sparkPad = { top: 2, right: 2, bottom: 2, left: 2 }
const sparkInnerW = sparkW - sparkPad.left - sparkPad.right
const sparkInnerH = sparkH - sparkPad.top - sparkPad.bottom

function sparklinePath(metricName: string): string {
  void sparklineVersion.value
  const data = sparklineCache.get(metricName)
  if (!data || data.values.length < 2) return ''

  const { values } = data
  let min = Infinity, max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const range = max - min || 1

  let d = ''
  for (let i = 0; i < values.length; i++) {
    const x = sparkPad.left + (i / (values.length - 1)) * sparkInnerW
    const y = sparkPad.top + (1 - (values[i]! - min) / range) * sparkInnerH
    d += i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`
  }
  return d
}

function sparkYRange(metricName: string): { min: string; max: string } | null {
  void sparklineVersion.value
  const data = sparklineCache.get(metricName)
  if (!data || data.values.length < 2) return null
  let min = Infinity, max = -Infinity
  for (const v of data.values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min: formatAxisVal(min), max: formatAxisVal(max) }
}

function sparkTimeRange(metricName: string): { start: string; end: string } | null {
  void sparklineVersion.value
  const data = sparklineCache.get(metricName)
  if (!data || data.timestamps.length < 2) return null
  return {
    start: formatAxisTime(data.timestamps[0]!),
    end: formatAxisTime(data.timestamps[data.timestamps.length - 1]!),
  }
}

function formatAxisVal(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  if (n === Math.floor(n)) return String(n)
  if (n >= 1) return n.toFixed(1)
  if (n > 0) return n.toFixed(3)
  return '0'
}

function formatAxisTime(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function sparkCrosshairX(): number | null {
  if (sharedHoverRatio.value == null) return null
  return sparkPad.left + sharedHoverRatio.value * sparkInnerW
}

function sparkHoverValue(metricName: string): string | null {
  void sparklineVersion.value
  if (sharedHoverRatio.value == null) return null
  const data = sparklineCache.get(metricName)
  if (!data || data.values.length < 2) return null
  const idx = Math.round(sharedHoverRatio.value * (data.values.length - 1))
  return formatAxisVal(data.values[idx]!)
}

function handleSparkMouseMove(e: MouseEvent) {
  const target = (e.currentTarget as HTMLElement).querySelector('.sparkline-svg') as SVGSVGElement | null
  if (!target) return
  const rect = target.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  sharedHoverRatio.value = Math.max(0, Math.min(1, ratio))
}

function handleSparkMouseLeave() {
  sharedHoverRatio.value = null
}

function hasSparkline(metricName: string): boolean {
  void sparklineVersion.value
  const data = sparklineCache.get(metricName)
  return !!data
}

function hasSparklineData(metricName: string): boolean {
  void sparklineVersion.value
  const data = sparklineCache.get(metricName)
  return !!data && data.values.length >= 2
}

function isLoadingSparkline(metricName: string): boolean {
  void sparklineVersion.value
  return sparklineLoading.has(metricName) && !sparklineCache.has(metricName)
}

function setCardRef(el: any, metric: string) {
  if (el) {
    cardRefs.value.set(metric, el as HTMLElement)
  }
}

function setupObserver() {
  if (observer) observer.disconnect()

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const metric = (entry.target as HTMLElement).dataset.metric
          if (metric) fetchSparkline(metric)
        }
      }
    },
    { rootMargin: '100px' }
  )

  nextTick(() => {
    for (const [, el] of cardRefs.value) {
      observer!.observe(el)
    }
  })
}

// Re-observe when visible metrics change
watch(visibleMetrics, () => {
  nextTick(() => {
    if (!observer) return
    observer.disconnect()
    for (const [, el] of cardRefs.value) {
      observer.observe(el)
    }
  })
}, { flush: 'post' })

function handleSelect(metric: string) {
  emit('select', metric, suggestedQuery(metric))
}

onMounted(() => {
  setupObserver()
})

onUnmounted(() => {
  if (observer) observer.disconnect()
})
</script>

<template>
  <div class="explore-container">
    <!-- ═══ Search bar ═══ -->
    <div class="explore-toolbar">
      <div class="search-wrapper">
        <input
          v-model="search"
          class="search-input mono"
          placeholder="Search metrics..."
          type="text"
        />
        <span class="search-count">
          {{ filteredMetrics.length }}/{{ metricNames.length }} metrics
        </span>
      </div>
      <div class="sort-toggle">
        <button
          class="sort-btn"
          :class="{ active: sortMode === 'az' }"
          @click="sortMode = 'az'"
        >
          A-Z
        </button>
        <button
          class="sort-btn"
          :class="{ active: sortMode === 'type' }"
          @click="sortMode = 'type'"
        >
          Type
        </button>
      </div>
    </div>

    <!-- ═══ Prefix chips ═══ -->
    <div v-if="prefixChips.length" class="prefix-bar">
      <button
        class="prefix-chip"
        :class="{ active: !activePrefix }"
        @click="clearPrefix"
      >
        All
      </button>
      <button
        v-for="chip in prefixChips"
        :key="chip.prefix"
        class="prefix-chip mono"
        :class="{ active: activePrefix === chip.prefix }"
        @click="togglePrefix(chip.prefix)"
      >
        {{ chip.prefix }}*
        <span class="prefix-count">{{ chip.count }}</span>
      </button>
    </div>

    <!-- ═══ Card grid ═══ -->
    <div v-if="filteredMetrics.length" class="card-grid">
      <div
        v-for="metric in visibleMetrics"
        :key="metric"
        :ref="(el) => setCardRef(el, metric)"
        :data-metric="metric"
        class="metric-card"
      >
        <div class="card-header">
          <span class="card-name mono">{{ metric }}</span>
          <span
            class="type-badge"
            :class="metricType(metric)"
          >
            {{ metricType(metric) }}
          </span>
        </div>
        <div
          class="card-sparkline"
          @mousemove="handleSparkMouseMove"
          @mouseleave="handleSparkMouseLeave"
        >
          <div v-if="isLoadingSparkline(metric)" class="sparkline-loading">
            <div class="sparkline-pulse"></div>
          </div>
          <template v-else-if="hasSparklineData(metric)">
            <!-- Y-axis labels -->
            <div class="spark-y-axis" v-if="sparkYRange(metric)">
              <span class="spark-y-label mono">{{ sparkYRange(metric)!.max }}</span>
              <span class="spark-y-label mono">{{ sparkYRange(metric)!.min }}</span>
            </div>
            <!-- Chart area -->
            <div class="spark-chart-area">
              <svg
                :viewBox="`0 0 ${sparkW} ${sparkH}`"
                class="sparkline-svg"
                preserveAspectRatio="none"
              >
                <path
                  :d="sparklinePath(metric)"
                  fill="none"
                  :stroke="metricType(metric) === 'counter' ? 'var(--amber)' : 'var(--ok)'"
                  stroke-width="1"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
                <!-- Shared crosshair -->
                <template v-if="sparkCrosshairX() != null">
                  <line
                    :x1="sparkCrosshairX()!" :y1="0"
                    :x2="sparkCrosshairX()!" :y2="sparkH"
                    stroke="var(--text-muted)" stroke-width="0.5" stroke-dasharray="2 1"
                  />
                </template>
              </svg>
              <!-- Hover value badge -->
              <div
                v-if="sparkHoverValue(metric) != null"
                class="spark-hover-value mono"
                :style="{ left: (sharedHoverRatio! * 100) + '%' }"
              >
                {{ sparkHoverValue(metric) }}
              </div>
              <!-- X-axis labels -->
              <div class="spark-x-axis" v-if="sparkTimeRange(metric)">
                <span class="spark-x-label mono">{{ sparkTimeRange(metric)!.start }}</span>
                <span class="spark-x-label mono">{{ sparkTimeRange(metric)!.end }}</span>
              </div>
            </div>
          </template>
          <div v-else-if="hasSparkline(metric)" class="sparkline-empty">
            No data
          </div>
        </div>
        <div class="card-footer">
          <span class="card-query mono">{{ suggestedQuery(metric) }}</span>
          <button class="select-btn" @click="handleSelect(metric)">
            Select
          </button>
        </div>
      </div>
    </div>

    <!-- ═══ Empty state ═══ -->
    <div v-else class="explore-empty">
      <div class="empty-icon">&#9707;</div>
      <div>No metrics match your filter</div>
    </div>

    <!-- ═══ Load more ═══ -->
    <div v-if="hasMore" class="load-more-row">
      <button class="load-more-btn" @click="loadMore">
        Load more ({{ filteredMetrics.length - visibleCount }} remaining)
      </button>
    </div>
  </div>
</template>

<style scoped src="../styles/components/MetricsExplore.css"></style>
