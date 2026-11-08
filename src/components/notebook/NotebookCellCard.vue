<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useApi } from '../../composables/useApi'
import { useWidgetData } from '../../composables/useWidgetData'
import { parseSearchQuery } from '../../lib/searchQuery'
import { afterPointerRelease } from '../../lib/pointer'
import { isErrorSpan } from '../../lib/spanStatus'
import { formatRange, resolveCellTime, rulerSegment } from '../../lib/notebookTime'
import type {
  Filter, LogRecord, Notebook, NotebookCell, NotebookCellTime, RushEvent, Widget, WidgetData,
  WidgetPosition, WidgetQueryConfig, WidgetType,
} from '../../types'
import WidgetWrapper from '../widgets/WidgetWrapper.vue'
import WidgetEditor from '../widgets/WidgetEditor.vue'
import NotebookTimeChip from './NotebookTimeChip.vue'
import NotebookMarkdown from './NotebookMarkdown.vue'

type CellPatch = Partial<Pick<NotebookCell, 'title' | 'body' | 'query_config' | 'time' | 'display_config'>>

const props = defineProps<{
  cell: NotebookCell
  notebook: Notebook
  /** Bumped by the notebook to re-run every query cell. */
  now: Date
  canWrite: boolean
  isFirst: boolean
  isLast: boolean
  /** Shared limiter so a long notebook doesn't fire every query at once. */
  run: <T>(task: () => Promise<T>) => Promise<T>
}>()

const emit = defineEmits<{
  update: [patch: CellPatch]
  move: [direction: -1 | 1]
  duplicate: []
  remove: []
}>()

const api = useApi()
const { fetchWidgetData } = useWidgetData()
const ROW_LIMIT = 50

const isQuery = computed(() => props.cell.cell_type !== 'note')
// Filters copied from Explore that the search text can't hold (see filtersToSearch).
const fixedFilters = computed(() => (props.cell.query_config.filters as Filter[] | undefined) ?? [])
const range = computed(() => resolveCellTime(props.notebook, props.cell.time, props.now))
const ruler = computed(() => rulerSegment(props.notebook, range.value, props.now))
const typeLabel = computed(() => ({ note: 'Note', logs: 'Logs', spans: 'Traces', panel: 'Panel', promql: 'PromQL' })[props.cell.cell_type])
const typeIcon = computed(() => ({ note: '¶', logs: '≡', spans: '⇶', panel: '◫', promql: '∿' })[props.cell.cell_type])

// ── Title and note body ──
const title = ref(props.cell.title)
const editingNote = ref(!props.cell.body && props.canWrite)
const noteDraft = ref(props.cell.body)
watch(() => props.cell.title, value => { title.value = value })
watch(() => props.cell.body, value => { if (!editingNote.value) noteDraft.value = value })

function saveTitle() {
  if (title.value !== props.cell.title) emit('update', { title: title.value.slice(0, 255) })
}

const noteInput = ref<HTMLTextAreaElement | null>(null)

async function startEditing() {
  if (!props.canWrite) return
  noteDraft.value = props.cell.body
  editingNote.value = true
  await nextTick()
  noteInput.value?.focus()
}

function saveNote() {
  if (noteDraft.value !== props.cell.body) emit('update', { body: noteDraft.value })
  // Leaving the editor shrinks the cell; let the click that caused the blur land first.
  afterPointerRelease(() => { editingNote.value = false })
}

// ── Logs and traces ──
const search = ref(String(props.cell.query_config.search ?? ''))
watch(() => props.cell.query_config.search, value => { search.value = String(value ?? '') })
const logRows = ref<LogRecord[]>([])
const spanRows = ref<RushEvent[]>([])
const expandedLog = ref<number | null>(null)

function submitSearch() {
  if (search.value !== props.cell.query_config.search) emit('update', { query_config: { ...props.cell.query_config, search: search.value } })
  else load()
}

// ── Panels ──
const panelData = ref<WidgetData | undefined>()
const editingPanel = ref(false)
const widget = computed<Widget>(() => ({
  id: props.cell.id,
  dashboard_id: '',
  title: props.cell.title,
  widget_type: (props.cell.display_config.widget_type as WidgetType) || 'timeseries',
  query_config: { time_range_minutes: 60, filters: [], ...props.cell.query_config } as WidgetQueryConfig,
  position: { col: 0, row: 0, col_span: 12, row_span: 4 } as WidgetPosition,
  display_config: props.cell.display_config,
  created_at: props.cell.created_at,
  updated_at: props.cell.updated_at,
}))
const panelConfigured = computed(() => Object.keys(props.cell.query_config).length > 0)

function savePanel(data: { title: string; widget_type: WidgetType; query_config: WidgetQueryConfig; display_config: Record<string, unknown> }) {
  editingPanel.value = false
  title.value = data.title
  emit('update', {
    title: data.title,
    query_config: data.query_config as unknown as Record<string, unknown>,
    display_config: { ...data.display_config, widget_type: data.widget_type },
  })
}

// ── Loading ──
const loading = ref(false)
const error = ref<string | null>(null)
let controller: AbortController | null = null

async function load() {
  if (!isQuery.value) return
  if (props.cell.cell_type === 'panel' && !panelConfigured.value) return
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = null
  try {
    await props.run(async () => {
      if (current.signal.aborted) return
      const timeRange = range.value
      // The dashboard workload, like panel cells: a plain search would cancel the
      // other cells' searches on the same route (see supersedeKey in useApi).
      if (props.cell.cell_type === 'logs') {
        const { filters, text } = parseSearchQuery(search.value)
        filters.push(...fixedFilters.value)
        const res = await api.queryLogs({ slim: true, time_range: timeRange, filters, search: text.join(' ') || undefined, limit: ROW_LIMIT }, 'dashboard', current.signal)
        logRows.value = res.rows
        expandedLog.value = null
      } else if (props.cell.cell_type === 'spans') {
        const { filters, text } = parseSearchQuery(search.value)
        filters.push(...fixedFilters.value)
        const res = await api.queryEvents({ time_range: timeRange, filters, search: text.join(' ') || undefined, limit: ROW_LIMIT, columns: 'list' }, 'dashboard', current.signal)
        spanRows.value = res.rows
      } else {
        panelData.value = await fetchWidgetData(widget.value, (props.cell.display_config.variables as Record<string, string>) ?? {}, undefined, current.signal, timeRange)
      }
    })
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') error.value = (e as Error)?.message || 'Query failed'
    // Cancelled by something other than this cell re-running: don't pass off as "no results".
    else if (!current.signal.aborted) error.value = 'The search was cancelled. Run it again.'
  } finally {
    if (controller === current) loading.value = false
  }
}

watch(
  () => [range.value.from, range.value.to, JSON.stringify(props.cell.query_config), props.cell.display_config.widget_type],
  () => { void load() },
  { immediate: true },
)
onBeforeUnmount(() => controller?.abort())

function updateTime(time: NotebookCellTime) {
  emit('update', { time })
}

function formatNs(ns: number): string {
  const d = new Date(ns / 1_000_000)
  if (Number.isNaN(d.getTime())) return String(ns)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function severityClass(sev: string): string {
  const s = (sev || '').toLowerCase()
  if (s.startsWith('err') || s.startsWith('fatal') || s.startsWith('crit')) return 'sev-error'
  if (s.startsWith('warn')) return 'sev-warn'
  return 'sev-info'
}
</script>

<template>
  <article class="nb-cell" :class="`nb-cell--${cell.cell_type}`">
    <header class="nb-cell-head">
      <span class="nb-cell-type mono" :title="typeLabel">{{ typeIcon }} {{ typeLabel }}</span>
      <input
        v-model="title"
        class="nb-cell-title"
        :placeholder="cell.cell_type === 'note' ? 'Untitled note' : 'Untitled ' + typeLabel.toLowerCase()"
        :readonly="!canWrite"
        maxlength="255"
        :aria-label="`${typeLabel} title`"
        @blur="saveTitle"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <NotebookTimeChip v-if="isQuery" :time="cell.time" :resolved="range" :readonly="!canWrite" @update:time="updateTime" />
      <span v-else class="nb-cell-author mono">{{ cell.author_name }}</span>
      <div v-if="canWrite" class="nb-cell-actions">
        <button type="button" class="nb-icon-btn" :disabled="isFirst" aria-label="Move cell up" title="Move up" @click="emit('move', -1)">↑</button>
        <button type="button" class="nb-icon-btn" :disabled="isLast" aria-label="Move cell down" title="Move down" @click="emit('move', 1)">↓</button>
        <button type="button" class="nb-icon-btn" aria-label="Duplicate cell" title="Duplicate" @click="emit('duplicate')">⧉</button>
        <button type="button" class="nb-icon-btn nb-icon-btn--danger" aria-label="Delete cell" title="Delete" @click="emit('remove')">×</button>
      </div>
    </header>

    <!-- Note -->
    <div v-if="cell.cell_type === 'note'" class="nb-note">
      <textarea
        v-if="editingNote"
        ref="noteInput"
        v-model="noteDraft"
        class="nb-note-input"
        rows="4"
        maxlength="65536"
        placeholder="What happened, what you tried, what you found. Markdown works."
        aria-label="Note text"
        @blur="saveNote"
      ></textarea>
      <div
        v-else
        class="nb-note-body"
        :class="{ editable: canWrite }"
        :tabindex="canWrite ? 0 : -1"
        :role="canWrite ? 'button' : undefined"
        :aria-label="canWrite ? 'Edit note' : undefined"
        @click="startEditing"
        @keydown.enter.prevent="startEditing"
      >
        <NotebookMarkdown v-if="cell.body" :source="cell.body" />
        <p v-else class="nb-muted">Empty note.</p>
      </div>
    </div>

    <!-- Logs and traces -->
    <template v-else-if="cell.cell_type === 'logs' || cell.cell_type === 'spans'">
      <form class="nb-search" @submit.prevent="submitSearch">
        <input
          v-model="search"
          class="nb-search-input mono"
          :placeholder="cell.cell_type === 'logs' ? 'service_name=checkout severity_text=ERROR card declined' : 'service_name=payments duration_ns>2000000000'"
          :aria-label="`${typeLabel} search`"
        />
        <button type="submit" class="nb-btn">Run</button>
      </form>
      <p v-if="fixedFilters.length" class="nb-muted mono">Also filtered by {{ fixedFilters.map(f => `${f.field} ${f.op} ${f.value === '' ? '(empty)' : f.value}`).join(', ') }}</p>
      <p v-if="error" class="nb-error" role="alert">{{ error }}</p>
      <p v-else-if="loading && !(logRows.length || spanRows.length)" class="nb-muted">Searching…</p>
      <template v-else-if="cell.cell_type === 'logs'">
        <p v-if="!logRows.length" class="nb-muted">No logs match this search in {{ formatRange(range) }}.</p>
        <ul v-else class="nb-rows" :class="{ stale: loading }">
          <li v-for="(row, i) in logRows" :key="i">
            <button type="button" class="nb-row" :aria-expanded="expandedLog === i" @click="expandedLog = expandedLog === i ? null : i">
              <span class="mono nb-row-time">{{ formatNs(row.Timestamp) }}</span>
              <span class="nb-sev mono" :class="severityClass(row.SeverityText)">{{ row.SeverityText || '—' }}</span>
              <span class="nb-row-svc">{{ row.ServiceName }}</span>
              <span class="nb-row-body mono">{{ row.Body }}</span>
            </button>
            <pre v-if="expandedLog === i" class="nb-row-detail mono">{{ row.Body }}</pre>
          </li>
        </ul>
        <p v-if="logRows.length >= ROW_LIMIT" class="nb-muted">Showing the newest {{ ROW_LIMIT }}.</p>
      </template>
      <template v-else>
        <p v-if="!spanRows.length" class="nb-muted">No spans match this search in {{ formatRange(range) }}.</p>
        <ul v-else class="nb-rows" :class="{ stale: loading }">
          <li v-for="row in spanRows" :key="`${row.trace_id}:${row.span_id}`">
            <router-link class="nb-row" :to="`/trace/${encodeURIComponent(row.trace_id)}`">
              <span class="mono nb-row-time">{{ formatNs(row.timestamp) }}</span>
              <span class="nb-row-svc">{{ row.service_name }}</span>
              <span class="nb-row-body mono">{{ row.http_method }} {{ row.http_path || '—' }}</span>
              <span class="mono nb-status" :class="{ bad: isErrorSpan(row) }">{{ row.http_status_code || (isErrorSpan(row) ? 'error' : '') }}</span>
              <span class="mono nb-row-dur">{{ (row.duration_ns / 1e6).toFixed(1) }} ms</span>
            </router-link>
          </li>
        </ul>
        <p v-if="spanRows.length >= ROW_LIMIT" class="nb-muted">Showing the newest {{ ROW_LIMIT }}.</p>
      </template>
    </template>

    <!-- Panel -->
    <template v-else>
      <div v-if="panelConfigured" class="nb-panel">
        <WidgetWrapper
          :title="cell.title || 'Panel'"
          :type="widget.widget_type"
          :display-config="cell.display_config"
          :range-label="formatRange(range)"
          :unit="(cell.display_config.unit as string) || ''"
          :data="panelData"
          :loading="loading"
          :error="error"
        />
      </div>
      <div v-else class="nb-muted nb-panel-empty">
        <p>Pick what this panel charts.</p>
      </div>
      <div v-if="canWrite" class="nb-panel-actions">
        <button type="button" class="nb-btn" @click="editingPanel = true">{{ panelConfigured ? 'Edit query' : 'Choose query' }}</button>
      </div>
      <WidgetEditor
        v-if="editingPanel"
        :widget="panelConfigured ? widget : null"
        dashboard-id=""
        context="notebook"
        @save="savePanel"
        @cancel="editingPanel = false"
      />
    </template>

    <div v-if="isQuery" class="nb-ruler" :title="`${formatRange(range)} within the incident window`" aria-hidden="true">
      <span
        class="nb-ruler-seg"
        :class="{ 'clip-start': ruler.clippedStart, 'clip-end': ruler.clippedEnd }"
        :style="{ left: `${ruler.left}%`, width: `${ruler.width}%` }"
      ></span>
    </div>
  </article>
</template>

<style scoped src="../../styles/views/NotebookView.css"></style>
