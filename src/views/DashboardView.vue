<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useWidgetData } from '../composables/useWidgetData'
import { substitute } from '../composables/useVarSubst'
import { provideChartHover } from '../composables/useChartHover'
import type { DashboardWithWidgets, Widget, WidgetData, DeployMarker, DashboardVariable } from '../types'
import { VAR_ALL } from '../types'
import WidgetWrapper from '../components/widgets/WidgetWrapper.vue'
import CounterWidget from '../components/widgets/CounterWidget.vue'
import BarWidget from '../components/widgets/BarWidget.vue'
import TableWidget from '../components/widgets/TableWidget.vue'
import TimeseriesWidget from '../components/widgets/TimeseriesWidget.vue'
import WidgetEditor from '../components/widgets/WidgetEditor.vue'
import VariableEditor from '../components/widgets/VariableEditor.vue'
import TimePicker from '../components/TimePicker.vue'

const props = defineProps<{ id: string }>()

const api = useApi()
const router = useRouter()
const route = useRoute()
const { fetchWidgetData } = useWidgetData()

// Share a single crosshair time across every widget on this dashboard, so
// hovering one chart draws an aligned vertical line on all the others.
provideChartHover()

const dashboard = ref<DashboardWithWidgets | null>(null)
const widgetDataMap = ref<Record<string, WidgetData>>({})
const widgetLoadingMap = ref<Record<string, boolean>>({})
const widgetErrorMap = ref<Record<string, string | null>>({})
const editMode = ref(false)
// Dashboard-level time range (drives every widget); seeded from ?t= or 1h.
const initT = Number(route.query.t)
const dashMinutes = ref(initT > 0 ? initT : 60)
const showAddWidget = ref(false)
const showVarEditor = ref(false)
const editingWidget = ref<Widget | null>(null)
const deploys = ref<DeployMarker[]>([])

// ── Template variables ──
const variables = computed<DashboardVariable[]>(() => dashboard.value?.variables || [])
const varValues = ref<Record<string, string>>({})       // name → selected value (VAR_ALL = "All")
const varOptions = ref<Record<string, string[]>>({})     // name → dropdown options (query/static)

function varLabel(v: DashboardVariable): string { return v.label || v.name }
function titleFor(w: Widget): string { return substitute(w.title, varValues.value) }

// Initialise selected values from the URL (?var-<name>=) or the variable's default.
function initVarValues() {
  const next: Record<string, string> = {}
  for (const v of variables.value) {
    const fromUrl = route.query[`var-${v.name}`]
    if (typeof fromUrl === 'string' && fromUrl.length) {
      next[v.name] = fromUrl
    } else if (v.default) {
      next[v.name] = v.default
    } else if (v.include_all) {
      next[v.name] = VAR_ALL
    } else {
      next[v.name] = (varOptions.value[v.name] || [])[0] || ''
    }
  }
  varValues.value = next
}

// Load dropdown options for query/static variables.
async function loadVarOptions() {
  const opts: Record<string, string[]> = {}
  for (const v of variables.value) {
    if (v.type === 'static') {
      opts[v.name] = v.options || []
    } else if (v.type === 'query' && v.field) {
      try { opts[v.name] = await api.suggestValues(v.field) } catch { opts[v.name] = [] }
    }
  }
  varOptions.value = opts
}

// Dashboard time range → reload every widget, and reflect in the URL.
watch(dashMinutes, (m) => {
  router.replace({ query: { ...route.query, t: String(m) } })
  loadAllWidgetData()
})

function onVarChange(name: string, value: string) {
  varValues.value = { ...varValues.value, [name]: value }
  // Reflect in the URL for shareable links.
  const q = { ...route.query, [`var-${name}`]: value }
  router.replace({ query: q })
  loadAllWidgetData()
}

const refreshOptions = [
  { label: 'Off', value: 0 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
]
const refreshInterval = ref(0)
let refreshTimer: ReturnType<typeof setInterval> | null = null

const isAutoRefreshing = computed(() => refreshInterval.value > 0)

// ═══ Share link ═══
const shareCopied = ref(false)

async function shareLink() {
  const url = window.location.href
  try {
    await navigator.clipboard.writeText(url)
    shareCopied.value = true
    setTimeout(() => { shareCopied.value = false }, 2000)
  } catch { /* fallback: ignore */ }
}

// ═══ Drag-and-drop ═══
const gridRef = ref<HTMLElement | null>(null)
const draggingWidgetId = ref<string | null>(null)
const dragGhost = ref<{ col: number; row: number; colSpan: number; rowSpan: number } | null>(null)
const resizingWidgetId = ref<string | null>(null)
const resizeGhost = ref<{ col: number; row: number; colSpan: number; rowSpan: number } | null>(null)

function getGridMetrics() {
  const el = gridRef.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const gap = 12 // var(--sp-3) = 12px
  const cols = 12
  const colWidth = (rect.width - gap * (cols - 1)) / cols
  const rowHeight = 80
  return { rect, gap, cols, colWidth, rowHeight }
}

function onDragStart(widget: Widget, e: PointerEvent) {
  const metrics = getGridMetrics()
  if (!metrics) return
  draggingWidgetId.value = widget.id
  const pos = widget.position
  dragGhost.value = { col: pos.col, row: pos.row, colSpan: pos.col_span, rowSpan: pos.row_span }
  const startX = e.clientX
  const startY = e.clientY
  const startCol = pos.col
  const startRow = pos.row

  function onMove(ev: PointerEvent) {
    const m = getGridMetrics()
    if (!m || !dragGhost.value) return
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    const dCol = Math.round(dx / (m.colWidth + m.gap))
    const dRow = Math.round(dy / (m.rowHeight + m.gap))
    const newCol = Math.max(1, Math.min(m.cols - pos.col_span + 1, startCol + dCol))
    const newRow = Math.max(1, startRow + dRow)
    dragGhost.value.col = newCol
    dragGhost.value.row = newRow
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (dragGhost.value && dashboard.value) {
      const w = dashboard.value.widgets.find(w => w.id === widget.id)
      if (w && (w.position.col !== dragGhost.value.col || w.position.row !== dragGhost.value.row)) {
        w.position.col = dragGhost.value.col
        w.position.row = dragGhost.value.row
        api.updateWidget(props.id, widget.id, {
          title: w.title,
          widget_type: w.widget_type,
          query_config: w.query_config,
          position: w.position,
        })
      }
    }
    draggingWidgetId.value = null
    dragGhost.value = null
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onResizeStart(widget: Widget, e: PointerEvent) {
  const metrics = getGridMetrics()
  if (!metrics) return
  resizingWidgetId.value = widget.id
  const pos = widget.position
  resizeGhost.value = { col: pos.col, row: pos.row, colSpan: pos.col_span, rowSpan: pos.row_span }
  const startX = e.clientX
  const startY = e.clientY
  const startColSpan = pos.col_span
  const startRowSpan = pos.row_span

  function onMove(ev: PointerEvent) {
    const m = getGridMetrics()
    if (!m || !resizeGhost.value) return
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    const dCol = Math.round(dx / (m.colWidth + m.gap))
    const dRow = Math.round(dy / (m.rowHeight + m.gap))
    const newColSpan = Math.max(1, Math.min(m.cols - pos.col + 1, startColSpan + dCol))
    const newRowSpan = Math.max(1, startRowSpan + dRow)
    resizeGhost.value.colSpan = newColSpan
    resizeGhost.value.rowSpan = newRowSpan
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (resizeGhost.value && dashboard.value) {
      const w = dashboard.value.widgets.find(w => w.id === widget.id)
      if (w && (w.position.col_span !== resizeGhost.value.colSpan || w.position.row_span !== resizeGhost.value.rowSpan)) {
        w.position.col_span = resizeGhost.value.colSpan
        w.position.row_span = resizeGhost.value.rowSpan
        api.updateWidget(props.id, widget.id, {
          title: w.title,
          widget_type: w.widget_type,
          query_config: w.query_config,
          position: w.position,
        })
      }
    }
    resizingWidgetId.value = null
    resizeGhost.value = null
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function ghostStyle(g: { col: number; row: number; colSpan: number; rowSpan: number }) {
  return {
    gridColumn: `${g.col} / span ${g.colSpan}`,
    gridRow: `${g.row} / span ${g.rowSpan}`,
  }
}

onMounted(async () => {
  await loadDashboard()
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

async function loadDashboard() {
  try {
    dashboard.value = await api.getDashboard(props.id)
    await loadVarOptions()
    initVarValues()
    await loadAllWidgetData()
    await loadDeploys()
  } catch {
    // error in api.error
  }
}

async function loadDeploys() {
  try {
    const res = await api.listDeploys()
    deploys.value = res.deploys
  } catch {
    // non-critical
  }
}

async function loadAllWidgetData() {
  if (!dashboard.value) return
  for (const widget of dashboard.value.widgets) {
    loadSingleWidget(widget)
  }
}

async function loadSingleWidget(widget: Widget) {
  widgetLoadingMap.value[widget.id] = true
  widgetErrorMap.value[widget.id] = null
  try {
    widgetDataMap.value[widget.id] = await fetchWidgetData(widget, varValues.value, dashMinutes.value)
  } catch (e: any) {
    widgetErrorMap.value[widget.id] = e.message
  } finally {
    widgetLoadingMap.value[widget.id] = false
  }
}

function setRefresh(secs: number) {
  refreshInterval.value = secs
  if (refreshTimer) clearInterval(refreshTimer)
  if (secs > 0) {
    refreshTimer = setInterval(() => loadAllWidgetData(), secs * 1000)
  }
}

async function handleSaveWidget(data: any) {
  if (!dashboard.value) return
  try {
    if (editingWidget.value) {
      const updated = await api.updateWidget(props.id, editingWidget.value.id, data)
      const idx = dashboard.value.widgets.findIndex(w => w.id === editingWidget.value!.id)
      if (idx >= 0) dashboard.value.widgets[idx] = updated
      loadSingleWidget(updated)
    } else {
      // Append new widgets below existing ones rather than stacking at (1,1).
      const bottom = dashboard.value.widgets.reduce((m, w) => Math.max(m, w.position.row + w.position.row_span), 1)
      const placed = { ...data, position: { ...data.position, col: 1, row: bottom } }
      const widget = await api.createWidget(props.id, placed)
      dashboard.value.widgets.push(widget)
      loadSingleWidget(widget)
    }
  } catch {
    // error in api.error
  }
  showAddWidget.value = false
  editingWidget.value = null
}

async function removeWidget(wid: string) {
  if (!dashboard.value) return
  try {
    await api.deleteWidget(props.id, wid)
    dashboard.value.widgets = dashboard.value.widgets.filter(w => w.id !== wid)
    delete widgetDataMap.value[wid]
  } catch {
    // error in api.error
  }
}

async function duplicateWidget(widget: Widget) {
  if (!dashboard.value) return
  try {
    const created = await api.createWidget(props.id, {
      title: `${widget.title} (copy)`,
      widget_type: widget.widget_type,
      query_config: widget.query_config,
      position: { ...widget.position, row: widget.position.row + widget.position.row_span },
      display_config: widget.display_config || {},
    })
    dashboard.value.widgets.push(created)
    loadSingleWidget(created)
  } catch { /* error in api.error */ }
}

async function saveVariables(vars: DashboardVariable[]) {
  if (!dashboard.value) return
  try {
    await api.updateDashboard(props.id, {
      name: dashboard.value.name,
      description: dashboard.value.description,
      visibility: dashboard.value.visibility,
      tags: dashboard.value.tags,
      variables: vars,
    })
    dashboard.value.variables = vars
    showVarEditor.value = false
    await loadVarOptions()
    initVarValues()
    loadAllWidgetData()
  } catch { /* error in api.error */ }
}

function editWidget(widget: Widget) {
  editingWidget.value = widget
  showAddWidget.value = true
}

function openAddWidget() {
  editingWidget.value = null
  showAddWidget.value = true
}

function widgetStyle(widget: Widget) {
  const pos = widget.position
  return {
    gridColumn: `${pos.col} / span ${pos.col_span}`,
    gridRow: `${pos.row} / span ${pos.row_span}`,
  }
}
</script>

<template>
  <div class="dashboard-page">
    <div class="page-header">
      <div class="page-header-left">
        <router-link to="/dashboards" class="back-link">&larr;</router-link>
        <h1 class="page-title">{{ dashboard?.name || 'Loading...' }}</h1>
        <span v-if="dashboard?.description" class="page-desc text-secondary">{{ dashboard.description }}</span>
      </div>
      <div class="page-header-right">
        <TimePicker v-model="dashMinutes" />
        <div v-if="isAutoRefreshing" class="refresh-dot" title="Auto-refreshing"></div>
        <select
          class="refresh-select mono"
          :value="refreshInterval"
          @change="setRefresh(Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="opt in refreshOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <button class="share-btn" @click="shareLink" :title="shareCopied ? 'Copied!' : 'Copy shareable link'">
          {{ shareCopied ? '&#10003; Copied' : '&#128279; Share' }}
        </button>
        <button class="btn-edit" @click="editMode = !editMode">
          {{ editMode ? 'Done' : 'Edit' }}
        </button>
        <button v-if="editMode" class="btn-edit" @click="showVarEditor = true">Variables</button>
        <button v-if="editMode" class="btn-add" @click="openAddWidget">+ Widget</button>
      </div>
    </div>

    <!-- ── Template variable bar ── -->
    <div v-if="variables.length" class="dash-var-bar">
      <div v-for="v in variables" :key="v.name" class="dash-var">
        <label class="dash-var-label">{{ varLabel(v) }}</label>
        <select
          v-if="v.type !== 'textbox'"
          class="dash-var-select mono"
          :value="varValues[v.name]"
          @change="onVarChange(v.name, ($event.target as HTMLSelectElement).value)"
        >
          <option v-if="v.include_all" :value="VAR_ALL">All</option>
          <option v-for="opt in (varOptions[v.name] || [])" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <input
          v-else
          class="dash-var-select mono"
          :value="varValues[v.name]"
          @change="onVarChange(v.name, ($event.target as HTMLInputElement).value)"
          :placeholder="v.name"
        />
      </div>
    </div>

    <div v-if="api.error.value" class="empty-state card">
      <div class="empty-state-icon" style="color: var(--error)">!</div>
      <div>{{ api.error.value }}</div>
    </div>

    <div v-else-if="dashboard && dashboard.widgets.length === 0" class="empty-state card">
      <div class="empty-state-icon">&#9632;</div>
      <div>No widgets yet</div>
      <div class="text-secondary" style="font-size: 11px">
        <button class="btn-inline" @click="editMode = true; openAddWidget()">Add a widget</button> to start
      </div>
    </div>

    <div v-else ref="gridRef" class="widget-grid">
      <div
        v-for="widget in dashboard?.widgets || []"
        :key="widget.id"
        class="widget-cell"
        :style="widgetStyle(widget)"
        :class="{ 'widget-dragging': draggingWidgetId === widget.id || resizingWidgetId === widget.id }"
      >
        <WidgetWrapper
          :title="titleFor(widget)"
          :description="(widget.display_config?.description as string) || ''"
          :unit="(widget.display_config?.unit as string) || ''"
          :loading="widgetLoadingMap[widget.id]"
          :error="widgetErrorMap[widget.id]"
          :edit-mode="editMode"
          @edit="editWidget(widget)"
          @duplicate="duplicateWidget(widget)"
          @remove="removeWidget(widget.id)"
          @dragstart="onDragStart(widget, $event)"
          @resizestart="onResizeStart(widget, $event)"
        >
          <CounterWidget
            v-if="widget.widget_type === 'counter' && widgetDataMap[widget.id]"
            :value="widgetDataMap[widget.id]!.count || 0"
            :label="widget.title"
          />
          <BarWidget
            v-else-if="widget.widget_type === 'bar' && widgetDataMap[widget.id]"
            :groups="widgetDataMap[widget.id]!.groups || []"
          />
          <TableWidget
            v-else-if="widget.widget_type === 'table' && widgetDataMap[widget.id]"
            :rows="(widgetDataMap[widget.id]!.rows || []) as Record<string, unknown>[]"
          />
          <TimeseriesWidget
            v-else-if="widget.widget_type === 'timeseries' && widgetDataMap[widget.id]"
            :buckets="widgetDataMap[widget.id]!.buckets || []"
            :series="widgetDataMap[widget.id]!.series"
            :deploys="deploys"
            :unit="(widget.display_config?.unit as string) || ''"
          />
        </WidgetWrapper>
      </div>
      <!-- Drag ghost -->
      <div v-if="dragGhost" class="widget-ghost" :style="ghostStyle(dragGhost)"></div>
      <!-- Resize ghost -->
      <div v-if="resizeGhost" class="widget-ghost widget-ghost-resize" :style="ghostStyle(resizeGhost)"></div>
    </div>

    <WidgetEditor
      v-if="showAddWidget"
      :widget="editingWidget"
      :dashboard-id="id"
      :variables="variables"
      :var-values="varValues"
      @save="handleSaveWidget"
      @cancel="showAddWidget = false; editingWidget = null"
    />

    <VariableEditor
      v-if="showVarEditor"
      :variables="variables"
      @save="saveVariables"
      @cancel="showVarEditor = false"
    />
  </div>
</template>

<style scoped src="../styles/views/DashboardView.css"></style>
