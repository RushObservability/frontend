<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  KubernetesAccessDetailResponse,
  KubernetesAccessEvent,
  KubernetesAccessResultSummary,
  KubernetesSessionChunk,
} from '../types'
import {
  evidenceForSource,
  eventActor,
  actorTypeLabel,
  eventCluster,
  formatAccessTarget,
  kubectlCommand,
  requestedCommand,
  recordingLabel,
  sessionOutput,
} from '../lib/kubernetesAccess'
import KubernetesEvidenceBadge from './KubernetesEvidenceBadge.vue'
import PanelCard from './PanelCard.vue'
import KubernetesResultViewer from './KubernetesResultViewer.vue'
import TerminalSessionReplay from './TerminalSessionReplay.vue'

type DetailTab = 'request' | 'result' | 'session' | 'device' | 'network'

const props = withDefaults(defineProps<{
  event: KubernetesAccessEvent
  detail?: KubernetesAccessDetailResponse | null
  loading?: boolean
  error?: string | null
  sessionChunks?: KubernetesSessionChunk[]
  sessionLoading?: boolean
  sessionError?: string | null
  drawer?: boolean
}>(), {
  detail: null,
  loading: false,
  error: null,
  sessionChunks: () => [],
  sessionLoading: false,
  sessionError: null,
  drawer: false,
})

const emit = defineEmits<{
  close: []
  retry: []
  retrySession: []
}>()

const tabs: Array<{ id: DetailTab; label: string }> = [
  { id: 'request', label: 'Request' },
  { id: 'result', label: 'Result' },
  { id: 'session', label: 'Session' },
  { id: 'device', label: 'Device' },
  { id: 'network', label: 'Network' },
]

const activeTab = ref<DetailTab>('request')
const displayEvent = computed(() => props.detail?.event || props.event)
const session = computed(() => props.detail?.session || displayEvent.value.session || null)
const output = computed(() => sessionOutput(displayEvent.value, session.value))
const result = computed<KubernetesAccessResultSummary>(() => {
  const raw = displayEvent.value.result_summary
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as KubernetesAccessResultSummary
  return raw == null ? {} : { preview: raw }
})
const resultTruncated = computed(() => Boolean(displayEvent.value.result_truncated || result.value.truncated))
const redactionCount = computed(() => displayEvent.value.redaction_count ?? result.value.redaction_count ?? 0)
const sourceEvidence = computed(() => evidenceForSource(displayEvent.value.source_kind))
const hasSession = computed(() => Boolean(displayEvent.value.session_id || session.value || output.value))
const command = computed(() => requestedCommand(displayEvent.value))
const displayedKubectlCommand = computed(() => kubectlCommand(displayEvent.value))

watch(() => props.event.id, () => { activeTab.value = 'request' })

function formatDate(value?: string): string {
  if (!value) return 'Not reported'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatDuration(value?: number): string {
  if (value == null || !Number.isFinite(value)) return 'Not reported'
  if (value < 1_000) return `${value.toLocaleString()} ms`
  return `${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`
}

function formatBytes(value?: number): string {
  if (value == null || !Number.isFinite(value)) return 'Not reported'
  if (value < 1_024) return `${value.toLocaleString()} B`
  if (value < 1_048_576) return `${(value / 1_024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`
  return `${(value / 1_048_576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`
}

function pretty(value: unknown): string {
  if (value == null || value === '') return 'No data recorded.'
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
  }
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

const capturedResult = computed<unknown>(() => {
  if (result.value.body !== undefined) return result.value.body
  if (result.value.preview !== undefined) return result.value.preview
  if (result.value.content !== undefined) return result.value.content
  const { truncated: _truncated, redacted: _redacted, redaction_count: _count, ...rest } = result.value
  return Object.keys(rest).length ? rest : null
})

function activateTab(tab: DetailTab, event: KeyboardEvent) {
  const index = tabs.findIndex(item => item.id === tab)
  const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!direction) return
  event.preventDefault()
  const next = tabs[(index + direction + tabs.length) % tabs.length]
  if (!next) return
  activeTab.value = next.id
  document.getElementById(`kubernetes-access-tab-${next.id}`)?.focus()
}
</script>

<template>
  <PanelCard
    class="access-detail"
    :class="{ 'access-detail--drawer': drawer }"
    :title="`${displayEvent.verb || 'request'} ${formatAccessTarget(displayEvent)}`"
    description="Recorded Kubernetes request evidence and session output."
    :source-label="displayEvent.source_kind"
    :loading="loading"
    :error="error"
  >
    <template #actions>
      <button type="button" class="detail-close" aria-label="Close event details" @click="emit('close')">Close</button>
    </template>

    <template v-if="error" #footer>
      <button type="button" class="detail-retry" @click="emit('retry')">Retry details</button>
    </template>

    <div v-if="!loading && !error" class="detail-content">
      <div class="detail-identity">
        <div>
          <span class="detail-eyebrow">{{ eventActor(displayEvent) }}</span>
          <strong>{{ eventCluster(displayEvent) }}</strong>
          <span>{{ displayEvent.namespace || 'Cluster scoped' }}</span>
        </div>
        <div class="detail-state">
          <span class="recording-state" :class="`recording-state--${displayEvent.recording_state}`">
            {{ recordingLabel(displayEvent.recording_state) }}
          </span>
          <KubernetesEvidenceBadge :kind="sourceEvidence" />
        </div>
      </div>

      <div class="detail-tabs" role="tablist" aria-label="Access event details">
        <button
          v-for="tab in tabs"
          :id="`kubernetes-access-tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`kubernetes-access-panel-${tab.id}`"
          :tabindex="activeTab === tab.id ? 0 : -1"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
          @keydown="activateTab(tab.id, $event)"
        >
          {{ tab.label }}
          <span v-if="tab.id === 'session' && !hasSession" class="tab-optional">none</span>
        </button>
      </div>

      <section
        v-if="activeTab === 'request'"
        id="kubernetes-access-panel-request"
        role="tabpanel"
        aria-labelledby="kubernetes-access-tab-request"
        class="detail-tab-panel"
      >
        <dl class="evidence-fields">
          <div><dt>Actor</dt><dd>{{ eventActor(displayEvent) }} <KubernetesEvidenceBadge :kind="sourceEvidence" compact /></dd></div>
          <div><dt>Credential</dt><dd>{{ actorTypeLabel(displayEvent) }} <KubernetesEvidenceBadge :kind="sourceEvidence" compact /></dd></div>
          <div><dt>Kubernetes user</dt><dd>{{ displayEvent.kube_username || 'Not reported' }} <KubernetesEvidenceBadge :kind="sourceEvidence" compact /></dd></div>
          <div><dt>Cluster</dt><dd>{{ eventCluster(displayEvent) }} <KubernetesEvidenceBadge :kind="sourceEvidence" compact /></dd></div>
          <div><dt>Namespace</dt><dd>{{ displayEvent.namespace || 'Cluster scoped' }} <KubernetesEvidenceBadge :kind="sourceEvidence" compact /></dd></div>
          <div class="field-wide">
            <dt>{{ displayedKubectlCommand.source === 'reported' ? 'Reported kubectl command' : 'Likely kubectl command' }}</dt>
            <dd class="command-field">
              <code>{{ displayedKubectlCommand.command }}</code>
              <KubernetesEvidenceBadge :kind="displayedKubectlCommand.source === 'reported' ? 'rush_cli' : sourceEvidence" compact />
              <span>{{ displayedKubectlCommand.source === 'reported' ? 'Captured from client argv.' : 'Reconstructed from the API request. Unrecorded flags may be missing.' }}</span>
            </dd>
          </div>
          <div><dt>Raw API request</dt><dd><code>{{ displayEvent.verb }} {{ formatAccessTarget(displayEvent) }}</code> <KubernetesEvidenceBadge :kind="sourceEvidence" compact /></dd></div>
          <div><dt>HTTP status</dt><dd>{{ displayEvent.status_code ?? 'Not reported' }} <KubernetesEvidenceBadge :kind="sourceEvidence" compact /></dd></div>
          <div><dt>Started</dt><dd>{{ formatDate(displayEvent.created_at) }} <KubernetesEvidenceBadge :kind="sourceEvidence" compact /></dd></div>
          <div><dt>Duration</dt><dd>{{ formatDuration(displayEvent.duration_ms) }} <KubernetesEvidenceBadge :kind="sourceEvidence" compact /></dd></div>
          <div><dt>Request ID</dt><dd><code>{{ displayEvent.id }}</code></dd></div>
          <div><dt>Session ID</dt><dd><code>{{ displayEvent.session_id || 'No session' }}</code></dd></div>
        </dl>
        <div v-if="command.length" class="detail-block">
          <div class="detail-block-head">
            <span>Exec program and arguments</span>
            <KubernetesEvidenceBadge :kind="sourceEvidence" compact />
          </div>
          <pre>{{ command.join(' ') }}</pre>
          <p>This is the command passed to the Kubernetes exec request. Commands typed later inside a shell may not appear here.</p>
        </div>
        <div v-if="displayEvent.request_query && Object.keys(displayEvent.request_query).length" class="detail-block">
          <div class="detail-block-head"><span>Allowed query parameters</span><KubernetesEvidenceBadge :kind="sourceEvidence" compact /></div>
          <pre>{{ pretty(displayEvent.request_query) }}</pre>
        </div>
      </section>

      <section
        v-else-if="activeTab === 'result'"
        id="kubernetes-access-panel-result"
        role="tabpanel"
        aria-labelledby="kubernetes-access-tab-result"
        class="detail-tab-panel"
      >
        <div v-if="resultTruncated || result.redacted || redactionCount" class="capture-warning" role="note">
          <strong>This result is incomplete.</strong>
          <span v-if="resultTruncated">Rush stopped storing output at the configured size limit.</span>
          <span v-if="result.redacted || redactionCount">Rush removed {{ redactionCount || 'one or more' }} sensitive value{{ redactionCount === 1 ? '' : 's' }}.</span>
        </div>
        <dl class="result-stats">
          <div><dt>Response</dt><dd>{{ formatBytes(displayEvent.response_bytes) }}</dd></div>
          <div><dt>Stored</dt><dd>{{ formatBytes(result.stored_bytes) }}</dd></div>
          <div><dt>Original</dt><dd>{{ formatBytes(result.original_bytes) }}</dd></div>
        </dl>
        <KubernetesResultViewer
          :key="displayEvent.id"
          :value="capturedResult"
          :resource="displayEvent.resource"
          :namespace="displayEvent.namespace"
        >
          <template #meta><KubernetesEvidenceBadge :kind="sourceEvidence" compact /></template>
        </KubernetesResultViewer>
      </section>

      <section
        v-else-if="activeTab === 'session'"
        id="kubernetes-access-panel-session"
        role="tabpanel"
        aria-labelledby="kubernetes-access-tab-session"
        class="detail-tab-panel"
      >
        <div v-if="displayEvent.recording_state !== 'complete'" class="capture-warning" role="note">
          <strong>{{ recordingLabel(displayEvent.recording_state) }} recording.</strong>
          <span>{{ displayEvent.recording_error || 'The output below may be incomplete or unavailable.' }}</span>
        </div>
        <div v-if="session" class="session-meta">
          <span>{{ session.pod || displayEvent.pod || displayEvent.name || 'Unknown pod' }}</span>
          <span>{{ session.container || displayEvent.container || 'Default container' }}</span>
          <span>{{ formatDuration(session.duration_ms || displayEvent.duration_ms) }}</span>
          <span>{{ formatBytes(session.byte_count ?? session.total_bytes) }}</span>
        </div>
        <TerminalSessionReplay
          v-if="displayEvent.session_id"
          :chunks="sessionChunks"
          :loading="sessionLoading"
          :error="sessionError"
          @retry="emit('retrySession')"
        />
        <div v-else-if="output" class="terminal-recording">
          <div class="terminal-head">
            <span>Recorded stdout and stderr</span>
            <KubernetesEvidenceBadge kind="gateway" compact />
          </div>
          <pre>{{ output }}</pre>
        </div>
        <div v-else class="detail-empty">
          <strong>No terminal output</strong>
          <span>This request did not open a recorded terminal session, or output storage is disabled.</span>
        </div>
        <p class="session-note">Interactive input is hidden by default because shell sessions may contain credentials. Reveal it only when incident review requires it.</p>
      </section>

      <section
        v-else-if="activeTab === 'device'"
        id="kubernetes-access-panel-device"
        role="tabpanel"
        aria-labelledby="kubernetes-access-tab-device"
        class="detail-tab-panel"
      >
        <div v-if="displayEvent.client_reported" class="capture-warning capture-warning--neutral" role="note">
          <strong>Reported by optional Rush CLI enrichment.</strong>
          <span>The gateway did not verify these device fields. Do not use them to make access decisions.</span>
        </div>
        <dl v-if="displayEvent.client_reported" class="evidence-fields">
          <div><dt>Operating system</dt><dd>{{ displayEvent.client_reported.os || 'Not reported' }} <KubernetesEvidenceBadge kind="rush_cli" compact /></dd></div>
          <div><dt>Architecture</dt><dd>{{ displayEvent.client_reported.arch || displayEvent.client_reported.architecture || 'Not reported' }} <KubernetesEvidenceBadge kind="rush_cli" compact /></dd></div>
          <div><dt>Hostname label</dt><dd>{{ displayEvent.client_reported.hostname || 'Not reported' }} <KubernetesEvidenceBadge kind="rush_cli" compact /></dd></div>
          <div><dt>CLI version</dt><dd>{{ displayEvent.client_reported.cli_version || 'Not reported' }} <KubernetesEvidenceBadge kind="rush_cli" compact /></dd></div>
          <div class="field-wide"><dt>Original command</dt><dd><code>{{ displayEvent.client_reported.argv?.join(' ') || 'Not reported' }}</code> <KubernetesEvidenceBadge kind="rush_cli" compact /></dd></div>
          <div class="field-wide"><dt>Private IPs</dt><dd><code>{{ displayEvent.client_reported.private_ips?.join(', ') || 'Not collected' }}</code> <KubernetesEvidenceBadge kind="rush_cli" compact /></dd></div>
        </dl>
        <div v-else class="detail-empty">
          <strong>No device report</strong>
          <span>No optional client enrichment was submitted for this request.</span>
        </div>
      </section>

      <section
        v-else
        id="kubernetes-access-panel-network"
        role="tabpanel"
        aria-labelledby="kubernetes-access-tab-network"
        class="detail-tab-panel"
      >
        <div class="capture-warning capture-warning--neutral" role="note">
          <strong>Network location is approximate.</strong>
          <span>Public IP data may identify a VPN, office gateway, mobile carrier, or privacy relay.</span>
        </div>
        <dl v-if="displayEvent.observed_network" class="evidence-fields">
          <div><dt>Observed address</dt><dd><code>{{ displayEvent.observed_network.observed_source_ip || displayEvent.observed_network.source_ip || displayEvent.observed_network.ip_prefix || 'Restricted' }}</code> <KubernetesEvidenceBadge kind="gateway" compact /></dd></div>
          <div><dt>Network owner</dt><dd>{{ displayEvent.observed_network.organization || displayEvent.observed_network.asn || 'Not reported' }} <KubernetesEvidenceBadge kind="ip_derived" compact /></dd></div>
          <div><dt>Country</dt><dd>{{ displayEvent.observed_network.country || 'Not reported' }} <KubernetesEvidenceBadge kind="ip_derived" compact /></dd></div>
          <div><dt>Region</dt><dd>{{ displayEvent.observed_network.region || 'Not reported' }} <KubernetesEvidenceBadge kind="ip_derived" compact /></dd></div>
          <div><dt>City estimate</dt><dd>{{ displayEvent.observed_network.city || 'Not reported' }} <KubernetesEvidenceBadge kind="ip_derived" compact /></dd></div>
          <div><dt>Accuracy radius</dt><dd>{{ displayEvent.observed_network.accuracy_radius_km != null ? `${displayEvent.observed_network.accuracy_radius_km} km` : 'Not reported' }} <KubernetesEvidenceBadge kind="ip_derived" compact /></dd></div>
          <div class="field-wide"><dt>Trusted proxy chain</dt><dd><code>{{ displayEvent.observed_network.proxy_chain?.join(' → ') || 'None reported' }}</code> <KubernetesEvidenceBadge kind="gateway" compact /></dd></div>
          <div class="field-wide"><dt>Client-reported private IPs</dt><dd><code>{{ displayEvent.observed_network.client_reported_private_ips?.join(', ') || 'Not collected' }}</code> <KubernetesEvidenceBadge kind="rush_cli" compact /></dd></div>
        </dl>
        <div v-else class="detail-empty">
          <strong>No network context</strong>
          <span>The gateway did not return network enrichment for this event.</span>
        </div>
      </section>
    </div>
  </PanelCard>
</template>

<style scoped>
.access-detail { position: sticky; top: var(--sp-4); max-height: calc(100vh - 116px); }
.access-detail :deep(.panel-body) { min-height: 340px; overflow: auto; }
.access-detail--drawer {
  position: static;
  height: 100%;
  max-height: none;
  overflow: hidden;
  background: transparent;
  border: 0;
  border-radius: 0;
}
.access-detail--drawer:hover { border-color: transparent; }
.access-detail--drawer :deep(.panel-body) { min-height: 0; overflow: auto; }
.detail-content { display: grid; min-width: 0; gap: var(--sp-3); }
.detail-close,
.detail-retry {
  padding: 4px 7px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  font: 600 9px var(--font-mono);
  cursor: pointer;
}
.detail-close:hover,
.detail-close:focus-visible,
.detail-retry:hover,
.detail-retry:focus-visible { color: var(--text-primary); border-color: var(--border-strong); }
.detail-identity { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); }
.detail-identity > div:first-child { display: grid; min-width: 0; gap: 2px; }
.detail-identity strong { overflow-wrap: anywhere; font-size: 13px; }
.detail-identity span:not(.evidence-badge):not(.evidence-dot) { color: var(--text-muted); font-size: 10px; }
.detail-eyebrow { color: var(--text-secondary) !important; font: 600 9px var(--font-mono) !important; text-transform: uppercase; letter-spacing: .06em; }
.detail-state { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
.recording-state { padding: 3px 7px; color: var(--text-muted); background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: 999px; font-size: 10px; font-weight: 650; }
.recording-state--complete { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 36%, var(--border-subtle)); }
.recording-state--partial { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 36%, var(--border-subtle)); }
.recording-state--failed { color: var(--error); border-color: color-mix(in srgb, var(--error) 36%, var(--border-subtle)); }
.detail-tabs { display: flex; overflow-x: auto; border-bottom: 1px solid var(--border-subtle); scrollbar-width: thin; }
.detail-tabs button { display: inline-flex; align-items: center; gap: 4px; padding: 8px 9px; color: var(--text-muted); background: transparent; border: 0; border-bottom: 2px solid transparent; font-size: 10px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.detail-tabs button:hover,
.detail-tabs button:focus-visible { color: var(--text-primary); }
.detail-tabs button.active { color: var(--amber); border-bottom-color: var(--amber); }
.tab-optional { padding: 1px 3px; background: var(--bg-raised); border-radius: 2px; font: 7px var(--font-mono); }
.detail-tab-panel { display: grid; min-width: 0; gap: var(--sp-3); }
.evidence-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; margin: 0; background: var(--border-subtle); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; }
.evidence-fields > div { display: grid; min-width: 0; align-content: start; gap: 5px; padding: 9px; background: var(--bg-surface); }
.evidence-fields .field-wide { grid-column: 1 / -1; }
.evidence-fields dt,
.result-stats dt { color: var(--text-muted); font: 600 8px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; }
.evidence-fields dd { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 5px; margin: 0; overflow-wrap: anywhere; color: var(--text-secondary); font-size: 10px; line-height: 1.45; }
.evidence-fields .command-field { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.command-field code { min-width: 0; padding: 7px 8px; color: var(--text-primary); background: var(--bg-void); border: 1px solid var(--border-subtle); border-radius: 4px; }
.command-field > span:last-child { grid-column: 1 / -1; color: var(--text-muted); font-size: 10px; }
code { max-width: 100%; overflow-wrap: anywhere; color: var(--text-primary); font: 9px/1.5 var(--font-mono); }
.detail-block { min-width: 0; border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; }
.detail-block-head,
.terminal-head { display: flex; min-height: 32px; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 9px; color: var(--text-secondary); background: var(--bg-raised); border-bottom: 1px solid var(--border-subtle); font-size: 10px; font-weight: 650; }
.detail-block pre,
.terminal-recording pre { max-height: 360px; margin: 0; overflow: auto; padding: 10px; color: var(--text-primary); background: var(--bg-void); font: 9px/1.55 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.detail-block p,
.session-note { margin: 0; padding: 7px 9px; color: var(--text-muted); border-top: 1px solid var(--border-subtle); font-size: 10px; line-height: 1.5; }
.capture-warning { display: grid; gap: 2px; padding: 9px 10px; color: var(--warning); background: color-mix(in srgb, var(--warning) 9%, var(--bg-surface)); border: 1px solid color-mix(in srgb, var(--warning) 30%, var(--border-subtle)); border-radius: var(--r-sm); font-size: 10px; line-height: 1.45; }
.capture-warning strong { font-size: 10px; }
.capture-warning--neutral { color: var(--text-secondary); background: var(--bg-raised); border-color: var(--border-subtle); }
.result-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin: 0; background: var(--border-subtle); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; }
.result-stats div { display: grid; gap: 3px; padding: 8px; background: var(--bg-surface); }
.result-stats dd { margin: 0; color: var(--text-secondary); font: 10px var(--font-mono); }
.session-meta { display: flex; flex-wrap: wrap; gap: 5px; }
.session-meta span { padding: 3px 6px; color: var(--text-secondary); background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: 2px; font: 8px var(--font-mono); }
.terminal-recording { min-width: 0; border: 1px solid var(--border-default); border-radius: var(--r-sm); overflow: hidden; }
.terminal-recording pre { min-height: 180px; color: color-mix(in srgb, var(--ok) 82%, var(--text-primary)); background: color-mix(in srgb, var(--bg-void) 92%, #07150f); }
.detail-empty { display: grid; min-height: 150px; place-content: center; justify-items: center; gap: 4px; padding: var(--sp-5); color: var(--text-muted); text-align: center; }
.detail-empty strong { color: var(--text-secondary); font-size: 11px; }
.detail-empty span { max-width: 280px; font-size: 10px; line-height: 1.5; }

@media (max-width: 900px) {
  .access-detail { position: static; max-height: none; }
  .access-detail :deep(.panel-body) { overflow: visible; }
}

@container (max-width: 430px) {
  .detail-identity { align-items: stretch; flex-direction: column; }
  .detail-state { justify-content: flex-start; }
  .evidence-fields { grid-template-columns: 1fr; }
  .evidence-fields .field-wide { grid-column: auto; }
}
</style>
