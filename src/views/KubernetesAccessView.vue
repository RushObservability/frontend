<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import DataTable, { type DataTableColumn } from '../components/DataTable.vue'
import DetailDrawer from '../components/DetailDrawer.vue'
import KubernetesAccessDetail from '../components/KubernetesAccessDetail.vue'
import KubernetesEvidenceBadge from '../components/KubernetesEvidenceBadge.vue'
import PanelCard from '../components/PanelCard.vue'
import TimePicker from '../components/TimePicker.vue'
import { useApi } from '../composables/useApi'
import { useTimeRangePreference } from '../composables/useTimeRangePreference'
import {
  evidenceForSource,
  eventActor,
  actorTypeLabel,
  eventCluster,
  formatAccessTarget,
  kubectlCommand,
  recordingLabel,
  statusGroup,
} from '../lib/kubernetesAccess'
import {
  decodeSessionChunks,
  sessionDurationMs,
  sessionRecordingState,
} from '../lib/kubernetesSessionReplay'
import type {
  KubernetesAccessDetailResponse,
  KubernetesAccessEvent,
  KubernetesAccessQueryParams,
  KubernetesSessionChunk,
} from '../types'

const api = useApi()
const PAGE_SIZE = 50

const selectedPreset = useTimeRangePreference()
const customRange = ref<{ from: string; to: string } | null>(null)
const filters = reactive({
  q: '',
  actor: '',
  cluster: '',
  namespace: '',
  verb: '',
  resource: '',
  status: '',
  sourceKind: '',
  recordingState: '',
})

const events = ref<KubernetesAccessEvent[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const offset = ref(0)
const total = ref<number | null>(null)
const hasMore = ref(false)
const selected = ref<KubernetesAccessEvent | null>(null)
const detail = ref<KubernetesAccessDetailResponse | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)
const sessionChunks = ref<KubernetesSessionChunk[]>([])
const sessionLoading = ref(false)
const sessionError = ref<string | null>(null)
let listRequest = 0
let detailRequest = 0

const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)
const resultCaption = computed(() => {
  if (total.value != null) return `${total.value.toLocaleString()} recorded request${total.value === 1 ? '' : 's'}`
  return `${events.value.length.toLocaleString()} request${events.value.length === 1 ? '' : 's'} on this page`
})

const columns: DataTableColumn[] = [
  { key: 'created_at', label: 'Time' },
  { key: 'actor', label: 'Actor' },
  { key: 'request', label: 'Request' },
  { key: 'context', label: 'Context' },
  { key: 'status_code', label: 'Status', align: 'right' },
  { key: 'recording_state', label: 'Recording' },
  { key: 'source_kind', label: 'Evidence' },
]

function effectiveRange(): { from: string; to: string } {
  if (customRange.value) return customRange.value
  const to = new Date()
  const from = new Date(to.getTime() - selectedPreset.value * 60_000)
  return { from: from.toISOString(), to: to.toISOString() }
}

function buildParams(): KubernetesAccessQueryParams {
  const params: KubernetesAccessQueryParams = {
    ...effectiveRange(),
    limit: PAGE_SIZE,
    offset: offset.value,
  }
  if (filters.q.trim()) params.q = filters.q.trim()
  if (filters.actor.trim()) params.actor = filters.actor.trim()
  if (filters.cluster.trim()) params.cluster = filters.cluster.trim()
  if (filters.namespace.trim()) params.namespace = filters.namespace.trim()
  if (filters.verb) params.verb = filters.verb
  if (filters.resource.trim()) params.resource = filters.resource.trim()
  if (filters.status) params.status = filters.status
  if (filters.sourceKind) params.source_kind = filters.sourceKind
  if (filters.recordingState) params.recording_state = filters.recordingState
  return params
}

async function loadEvents() {
  const requestId = ++listRequest
  loading.value = true
  error.value = null
  try {
    const response = await api.getKubernetesAccessEvents(buildParams())
    if (requestId !== listRequest) return
    events.value = response.events
    total.value = response.total ?? null
    hasMore.value = response.next_cursor != null
      ? Boolean(response.next_cursor)
      : response.total != null
        ? offset.value + response.events.length < response.total
        : response.events.length === PAGE_SIZE
    if (selected.value && !response.events.some(item => item.id === selected.value?.id)) closeDetail()
  } catch (cause: unknown) {
    if (requestId !== listRequest) return
    events.value = []
    total.value = null
    hasMore.value = false
    error.value = cause instanceof Error
      ? cause.message
      : 'Kubernetes access data is unavailable.'
  } finally {
    if (requestId === listRequest) loading.value = false
  }
}

function applyFilters() {
  offset.value = 0
  closeDetail()
  void loadEvents()
}

function resetFilters() {
  filters.q = ''
  filters.actor = ''
  filters.cluster = ''
  filters.namespace = ''
  filters.verb = ''
  filters.resource = ''
  filters.status = ''
  filters.sourceKind = ''
  filters.recordingState = ''
  customRange.value = null
  applyFilters()
}

async function openDetail(event: KubernetesAccessEvent) {
  const requestId = ++detailRequest
  selected.value = event
  detail.value = null
  detailError.value = null
  sessionChunks.value = []
  sessionError.value = null
  sessionLoading.value = false
  detailLoading.value = true
  try {
    const response = await api.getKubernetesAccessEvent(event.id)
    if (requestId !== detailRequest || selected.value?.id !== event.id) return
    detail.value = response
    const sessionId = response.event.session_id || event.session_id
    if (sessionId) void loadSessionChunks(sessionId, requestId, event.id)
  } catch (cause: unknown) {
    if (requestId !== detailRequest || selected.value?.id !== event.id) return
    detailError.value = cause instanceof Error
      ? cause.message
      : 'Event details are unavailable.'
  } finally {
    if (requestId === detailRequest) detailLoading.value = false
  }
}

async function loadSessionChunks(sessionId: string, requestId: number, eventId: string) {
  sessionLoading.value = true
  sessionError.value = null
  const chunks: KubernetesSessionChunk[] = []
  let afterSequence = 0
  try {
    for (let page = 0; page < 64; page++) {
      const response = await api.getKubernetesSessionChunks(sessionId, afterSequence)
      if (requestId !== detailRequest || selected.value?.id !== eventId) return
      chunks.push(...response.chunks)
      sessionChunks.value = [...chunks]
      if (!response.has_more || response.next_sequence == null || response.next_sequence <= afterSequence) break
      afterSequence = response.next_sequence
    }
    reconcileSessionState(eventId, chunks)
  } catch (cause: unknown) {
    if (requestId !== detailRequest || selected.value?.id !== eventId) return
    sessionError.value = cause instanceof Error
      ? cause.message
      : 'Terminal recording is unavailable.'
  } finally {
    if (requestId === detailRequest && selected.value?.id === eventId) sessionLoading.value = false
  }
}

function reconcileSessionState(eventId: string, chunks: KubernetesSessionChunk[]) {
  if (!chunks.length) return
  const storedState = sessionRecordingState(chunks)
  const recordingState = storedState === 'complete' || storedState === 'failed'
    ? storedState
    : storedState.includes('partial')
      ? 'partial'
      : null
  if (!recordingState) return

  const durationMs = sessionDurationMs(decodeSessionChunks(chunks))
  const update = (event: KubernetesAccessEvent | null | undefined) => {
    if (!event || event.id !== eventId) return
    event.recording_state = recordingState
    event.duration_ms = Math.max(event.duration_ms || 0, durationMs)
  }
  update(events.value.find(event => event.id === eventId))
  update(selected.value)
  update(detail.value?.event)
}

function retryDetail() {
  if (selected.value) void openDetail(selected.value)
}

function retrySession() {
  const event = detail.value?.event || selected.value
  if (event?.session_id && selected.value) {
    void loadSessionChunks(event.session_id, detailRequest, selected.value.id)
  }
}

function closeDetail() {
  detailRequest += 1
  selected.value = null
  detail.value = null
  detailError.value = null
  detailLoading.value = false
  sessionChunks.value = []
  sessionError.value = null
  sessionLoading.value = false
}

function nextPage() {
  if (!hasMore.value || loading.value) return
  offset.value += PAGE_SIZE
  closeDetail()
  void loadEvents()
}

function previousPage() {
  if (offset.value === 0 || loading.value) return
  offset.value = Math.max(0, offset.value - PAGE_SIZE)
  closeDetail()
  void loadEvents()
}

function eventRow(row: Record<string, unknown>): KubernetesAccessEvent {
  return row as KubernetesAccessEvent
}

function statusCode(event: KubernetesAccessEvent): number | undefined {
  const value = event.status_code ?? event.status
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || 'Unknown time'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function rowClass(row: Record<string, unknown>): string | undefined {
  return selected.value?.id === eventRow(row).id ? 'is-selected' : undefined
}

watch([selectedPreset, customRange], () => applyFilters())
onMounted(() => { void loadEvents() })
</script>

<template>
  <div class="kubernetes-access-page">
    <header class="access-page-header">
      <div>
        <span class="page-eyebrow">Admin evidence</span>
        <h1>Kubernetes access</h1>
        <p>Find Kubernetes API requests and inspect the evidence Rush recorded.</p>
      </div>
      <div class="evidence-legend" aria-label="Evidence sources">
        <KubernetesEvidenceBadge kind="gateway" />
        <KubernetesEvidenceBadge kind="kubernetes_audit" />
        <KubernetesEvidenceBadge kind="rush_cli" />
        <KubernetesEvidenceBadge kind="ip_derived" />
      </div>
    </header>

    <form class="access-filters" aria-label="Kubernetes access filters" @submit.prevent="applyFilters">
      <label class="filter-field filter-field--time">
        <span>Time range</span>
        <TimePicker v-model="selectedPreset" v-model:custom-range="customRange" />
      </label>
      <label class="filter-field filter-field--search">
        <span>Search</span>
        <input v-model="filters.q" type="search" placeholder="User, pod, command, or request ID" />
      </label>
      <label class="filter-field">
        <span>Actor</span>
        <input v-model="filters.actor" type="text" placeholder="User or Kubernetes identity" />
      </label>
      <label class="filter-field">
        <span>Cluster</span>
        <input v-model="filters.cluster" type="text" placeholder="Any cluster" />
      </label>
      <label class="filter-field">
        <span>Namespace</span>
        <input v-model="filters.namespace" type="text" placeholder="Any namespace" />
      </label>

      <details class="advanced-filters">
        <summary>More filters</summary>
        <div class="advanced-filter-grid">
          <label class="filter-field">
            <span>Verb</span>
            <select v-model="filters.verb">
              <option value="">Any verb</option>
              <option value="get">get</option>
              <option value="list">list</option>
              <option value="watch">watch</option>
              <option value="create">create</option>
              <option value="update">update</option>
              <option value="patch">patch</option>
              <option value="delete">delete</option>
              <option value="exec">exec</option>
            </select>
          </label>
          <label class="filter-field">
            <span>Resource</span>
            <input v-model="filters.resource" type="text" placeholder="pods, secrets, deployments" />
          </label>
          <label class="filter-field">
            <span>Status</span>
            <select v-model="filters.status">
              <option value="">Any status</option>
              <option value="2xx">2xx success</option>
              <option value="4xx">4xx denied or invalid</option>
              <option value="5xx">5xx server error</option>
            </select>
          </label>
          <label class="filter-field">
            <span>Evidence source</span>
            <select v-model="filters.sourceKind">
              <option value="">Any source</option>
              <option value="gateway">Gateway</option>
              <option value="kubernetes_audit_webhook">Kubernetes audit</option>
              <option value="rush_cli">Rush CLI</option>
            </select>
          </label>
          <label class="filter-field">
            <span>Recording</span>
            <select v-model="filters.recordingState">
              <option value="">Any state</option>
              <option value="complete">Complete</option>
              <option value="partial">Partial</option>
              <option value="failed">Failed</option>
              <option value="not_recorded">Not recorded</option>
            </select>
          </label>
        </div>
      </details>

      <div class="filter-actions">
        <button type="submit" class="filter-apply" :disabled="loading">Search</button>
        <button type="button" class="filter-reset" :disabled="loading" @click="resetFilters">Reset</button>
      </div>
    </form>

    <div class="access-workspace">
      <PanelCard
        title="Access events"
        description="Requests observed by the gateway or Kubernetes audit webhook, with optional Rush CLI context."
        variant="table"
        :loading="loading"
        :error="error"
        :empty="!loading && !error && events.length === 0"
        empty-title="No matching access events"
        empty-message="Widen the time range or remove a filter. If the addon is disabled, no events will appear."
        :caption="resultCaption"
        source-label="Kubernetes access"
      >
        <template #actions>
          <button type="button" class="table-refresh" :disabled="loading" @click="loadEvents">Refresh</button>
        </template>

        <DataTable
          v-if="events.length"
          :columns="columns"
          :rows="events"
          row-key="id"
          bare
          clickable-rows
          :row-class="rowClass"
          @row-click="row => openDetail(eventRow(row))"
        >
          <template #cell-created_at="{ row }">
            <span class="time-cell">{{ formatTime(eventRow(row).created_at) }}</span>
          </template>
          <template #cell-actor="{ row }">
            <span class="stacked-cell">
              <strong>{{ eventActor(eventRow(row)) }}</strong>
              <small>{{ actorTypeLabel(eventRow(row)) }} · {{ eventRow(row).kube_username || 'No Kubernetes identity' }}</small>
            </span>
          </template>
          <template #cell-request="{ row }">
            <span class="request-cell">
              <code :title="kubectlCommand(eventRow(row)).command">{{ kubectlCommand(eventRow(row)).command }}</code>
              <small>
                <span class="verb-badge">{{ eventRow(row).verb || 'request' }}</span>
                <span>{{ formatAccessTarget(eventRow(row)) }}</span>
              </small>
            </span>
          </template>
          <template #cell-context="{ row }">
            <span class="stacked-cell">
              <strong>{{ eventCluster(eventRow(row)) }}</strong>
              <small>{{ eventRow(row).namespace || 'Cluster scoped' }}</small>
            </span>
          </template>
          <template #cell-status_code="{ row }">
            <span class="status-badge" :class="`status-badge--${statusGroup(statusCode(eventRow(row)))}`">
              {{ statusCode(eventRow(row)) ?? 'Unknown' }}
            </span>
          </template>
          <template #cell-recording_state="{ row }">
            <span class="recording-badge" :class="`recording-badge--${eventRow(row).recording_state}`">
              {{ recordingLabel(eventRow(row).recording_state) }}
            </span>
          </template>
          <template #cell-source_kind="{ row }">
            <KubernetesEvidenceBadge :kind="evidenceForSource(eventRow(row).source_kind)" compact />
          </template>
        </DataTable>

        <template #footer>
          <div class="table-pagination" aria-label="Result pages">
            <button type="button" :disabled="offset === 0 || loading" @click="previousPage">Previous</button>
            <span>Page {{ page }}</span>
            <button type="button" :disabled="!hasMore || loading" @click="nextPage">Next</button>
          </div>
        </template>
      </PanelCard>
    </div>

    <DetailDrawer
      :open="Boolean(selected)"
      label="Kubernetes access event details"
      size="wide"
      @close="closeDetail"
    >
      <KubernetesAccessDetail
        v-if="selected"
        drawer
        :event="selected"
        :detail="detail"
        :loading="detailLoading"
        :error="detailError"
        :session-chunks="sessionChunks"
        :session-loading="sessionLoading"
        :session-error="sessionError"
        @close="closeDetail"
        @retry="retryDetail"
        @retry-session="retrySession"
      />
    </DetailDrawer>

    <p v-if="error" class="addon-note" role="status">
      If this addon is not installed, enable Kubernetes access recording before retrying.
    </p>
  </div>
</template>

<style scoped src="../styles/views/KubernetesAccessView.css"></style>
