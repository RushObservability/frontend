<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useApi } from '../composables/useApi'
import TimePicker from '../components/TimePicker.vue'
import type { AuditEvent, AuditQueryParams, AuditVerifyResponse } from '../types'

const api = useApi()

const PAGE_SIZE = 100
const DEFAULT_PRESET = 1440 // last 24h

// ── Time range (shared TimePicker): preset minutes OR an explicit custom range ──
const selectedPreset = ref(DEFAULT_PRESET)
const customRange = ref<{ from: string; to: string } | null>(null)

/** Resolve the active window to ISO from/to for the API. */
function effectiveRange(): { from: string; to: string } {
  if (customRange.value) return customRange.value
  const to = new Date()
  const from = new Date(to.getTime() - selectedPreset.value * 60_000)
  return { from: from.toISOString(), to: to.toISOString() }
}

// ── Filter state ──
const filters = reactive({
  actor: '',
  action: '',
  resource_type: '',
  outcome: '',
  tenant_id: '',
  q: '',
})

// ── Results state ──
const events = ref<AuditEvent[]>([])
const loading = ref(false)
const errorMsg = ref<string | null>(null)
const offset = ref(0)
// Whether the most recent page came back full (so a next page may exist).
const hasMore = ref(false)
const expanded = ref<Set<string>>(new Set())

// ── Integrity state ──
const verify = ref<AuditVerifyResponse | null>(null)
const verifying = ref(false)
const verifyError = ref<string | null>(null)

const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)

function buildParams(): AuditQueryParams {
  const p: AuditQueryParams = { limit: PAGE_SIZE, offset: offset.value }
  const range = effectiveRange()
  p.from = range.from
  p.to = range.to
  if (filters.actor.trim()) p.actor = filters.actor.trim()
  if (filters.action.trim()) p.action = filters.action.trim()
  if (filters.resource_type.trim()) p.resource_type = filters.resource_type.trim()
  if (filters.outcome) p.outcome = filters.outcome
  if (filters.tenant_id.trim()) p.tenant_id = filters.tenant_id.trim()
  if (filters.q.trim()) p.q = filters.q.trim()
  return p
}

async function loadEvents() {
  loading.value = true
  errorMsg.value = null
  try {
    const res = await api.getAuditEvents(buildParams())
    events.value = res.events ?? []
    hasMore.value = events.value.length === PAGE_SIZE
  } catch (e: any) {
    errorMsg.value = e?.message || 'Failed to load audit events'
    events.value = []
    hasMore.value = false
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  offset.value = 0
  expanded.value = new Set()
  loadEvents()
}

function resetFilters() {
  selectedPreset.value = DEFAULT_PRESET
  customRange.value = null
  filters.actor = ''
  filters.action = ''
  filters.resource_type = ''
  filters.outcome = ''
  filters.tenant_id = ''
  filters.q = ''
  applyFilters()
}

// Changing the time range re-queries immediately (matches Explore's behavior).
watch([selectedPreset, customRange], () => applyFilters())

function nextPage() {
  if (!hasMore.value) return
  offset.value += PAGE_SIZE
  expanded.value = new Set()
  loadEvents()
}

function prevPage() {
  if (offset.value === 0) return
  offset.value = Math.max(0, offset.value - PAGE_SIZE)
  expanded.value = new Set()
  loadEvents()
}

async function runVerify() {
  verifying.value = true
  verifyError.value = null
  try {
    verify.value = await api.verifyAuditChain()
  } catch (e: any) {
    verifyError.value = e?.message || 'Verification failed'
    verify.value = null
  } finally {
    verifying.value = false
  }
}

function toggleRow(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function isExpanded(id: string): boolean {
  return expanded.value.has(id)
}

// ── Formatting helpers ──
function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  } catch {
    return ts
  }
}

function prettyJson(raw: string): string {
  if (!raw) return '—'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

// Tenants for the filter dropdown.
const tenants = ref<{ id: string; name: string }[]>([])
async function loadTenants() {
  try {
    const res = await api.listTenants()
    tenants.value = res.tenants ?? []
  } catch { /* leave empty — filter just shows "All tenants" */ }
}

onMounted(() => {
  loadEvents()
  runVerify()
  loadTenants()
})
</script>

<template>
  <div class="audit-page">
    <div class="section-header">
      <h2 class="section-title">
        <svg class="section-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="M9 12l2 2 4-4"/>
        </svg>
        Audit Log
      </h2>
    </div>

    <!-- Integrity badge -->
    <div
      class="integrity-banner"
      :class="{
        'is-ok': verify?.intact === true,
        'is-broken': verify?.intact === false,
        'is-unknown': !verify && !verifying,
        'is-error': !!verifyError,
      }"
    >
      <div class="integrity-main">
        <span v-if="verifying" class="integrity-label">
          <span class="spinner-sm"></span> Verifying hash chain…
        </span>
        <span v-else-if="verifyError" class="integrity-label">
          ✗ Chain verification failed: {{ verifyError }}
        </span>
        <span v-else-if="verify?.intact" class="integrity-label">
          ✓ Chain verified
        </span>
        <span v-else-if="verify && !verify.intact" class="integrity-label">
          ✗ Chain BROKEN at seq {{ verify.first_broken_seq }}
        </span>
        <span v-else class="integrity-label">Hash chain not yet verified</span>
        <span v-if="verify" class="integrity-meta mono">{{ verify.checked }} events checked</span>
      </div>
      <button class="btn-reverify" :disabled="verifying" @click="runVerify">
        Re-verify
      </button>
    </div>

    <!-- Filter bar -->
    <div class="filter-bar card">
      <div class="filter-grid">
        <label class="filter-field">
          <span class="filter-label">Time range</span>
          <TimePicker v-model="selectedPreset" v-model:custom-range="customRange" />
        </label>
        <label class="filter-field">
          <span class="filter-label">Action</span>
          <input v-model="filters.action" type="text" class="filter-input" placeholder="user.create or user.*" @keyup.enter="applyFilters" />
        </label>
        <label class="filter-field">
          <span class="filter-label">Actor</span>
          <input v-model="filters.actor" type="text" class="filter-input" placeholder="id or name" @keyup.enter="applyFilters" />
        </label>
        <label class="filter-field">
          <span class="filter-label">Resource type</span>
          <input v-model="filters.resource_type" type="text" class="filter-input" placeholder="user, tenant…" @keyup.enter="applyFilters" />
        </label>
        <label class="filter-field">
          <span class="filter-label">Outcome</span>
          <select v-model="filters.outcome" class="filter-input">
            <option value="">Any</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>
        </label>
        <label class="filter-field">
          <span class="filter-label">Tenant</span>
          <select v-model="filters.tenant_id" class="filter-input" @change="applyFilters">
            <option value="">All tenants</option>
            <option v-for="t in tenants" :key="t.id" :value="t.name">{{ t.name }}</option>
          </select>
        </label>
        <label class="filter-field filter-field-wide">
          <span class="filter-label">Search</span>
          <input v-model="filters.q" type="text" class="filter-input" placeholder="action / description / actor" @keyup.enter="applyFilters" />
        </label>
      </div>
      <div class="filter-actions">
        <button class="btn-apply" :disabled="loading" @click="applyFilters">Apply</button>
        <button class="btn-reset" :disabled="loading" @click="resetFilters">Reset</button>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="empty-state card">
      <div class="text-muted">Loading audit events…</div>
    </div>

    <!-- Error state -->
    <div v-else-if="errorMsg" class="empty-state card error-state">
      <div class="empty-state-icon">✗</div>
      <div>{{ errorMsg }}</div>
      <button class="btn-reset" style="margin-top: 12px" @click="loadEvents">Retry</button>
    </div>

    <!-- Empty state -->
    <div v-else-if="events.length === 0" class="empty-state card">
      <div class="empty-state-icon">∅</div>
      <div>No audit events</div>
      <div class="text-secondary" style="font-size: 11px">Try widening the filters or time range</div>
    </div>

    <!-- Results table -->
    <div v-else class="audit-table card">
      <div class="audit-head">
        <span class="col-expand"></span>
        <span class="col-time">Time</span>
        <span class="col-actor">Actor</span>
        <span class="col-action">Action</span>
        <span class="col-resource">Resource</span>
        <span class="col-outcome">Outcome</span>
        <span class="col-tenant">Tenant</span>
        <span class="col-ip">IP</span>
      </div>

      <template v-for="ev in events" :key="ev.id">
        <div class="audit-row" :class="{ expanded: isExpanded(ev.id) }" @click="toggleRow(ev.id)">
          <span class="col-expand">
            <svg class="audit-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
          <span class="col-time mono text-muted">{{ formatTime(ev.timestamp) }}</span>
          <span class="col-actor">
            <span class="actor-name">{{ ev.actor_name || ev.actor_id || '—' }}</span>
            <span class="actor-type-badge" :class="'actor-' + ev.actor_type">{{ ev.actor_type }}</span>
          </span>
          <span class="col-action mono">{{ ev.action }}</span>
          <span class="col-resource mono text-secondary">
            <template v-if="ev.resource_type || ev.resource_id">
              {{ ev.resource_type }}<template v-if="ev.resource_id">/{{ ev.resource_id }}</template>
            </template>
            <template v-else>—</template>
          </span>
          <span class="col-outcome">
            <span class="outcome-pill" :class="'outcome-' + ev.outcome">{{ ev.outcome }}</span>
          </span>
          <span class="col-tenant mono text-muted">{{ ev.tenant_id || '—' }}</span>
          <span class="col-ip mono text-muted">{{ ev.ip_address || '—' }}</span>
        </div>

        <!-- Detail panel — SIEM-style flat field/value table (Splunk "Fields") -->
        <div v-if="isExpanded(ev.id)" class="audit-detail">
          <table class="field-table">
            <tbody>
              <tr class="field-row"><td class="field-key">seq</td><td class="field-val mono">{{ ev.seq }}</td></tr>
              <tr class="field-row"><td class="field-key">event_id</td><td class="field-val mono">{{ ev.id }}</td></tr>
              <tr class="field-row"><td class="field-key">timestamp</td><td class="field-val mono">{{ formatTime(ev.timestamp) }}</td></tr>
              <tr class="field-row"><td class="field-key">action</td><td class="field-val mono">{{ ev.action }}</td></tr>
              <tr class="field-row"><td class="field-key">outcome</td><td class="field-val mono">{{ ev.outcome }}</td></tr>
              <tr class="field-row"><td class="field-key">actor_name</td><td class="field-val">{{ ev.actor_name || '—' }}</td></tr>
              <tr class="field-row"><td class="field-key">actor_id</td><td class="field-val mono">{{ ev.actor_id || '—' }}</td></tr>
              <tr class="field-row"><td class="field-key">actor_type</td><td class="field-val mono">{{ ev.actor_type }}</td></tr>
              <tr class="field-row"><td class="field-key">resource_type</td><td class="field-val mono">{{ ev.resource_type || '—' }}</td></tr>
              <tr class="field-row"><td class="field-key">resource_id</td><td class="field-val mono">{{ ev.resource_id || '—' }}</td></tr>
              <tr class="field-row"><td class="field-key">tenant_id</td><td class="field-val mono">{{ ev.tenant_id || '—' }}</td></tr>
              <tr class="field-row"><td class="field-key">ip_address</td><td class="field-val mono">{{ ev.ip_address || '—' }}</td></tr>
              <tr class="field-row"><td class="field-key">request_id</td><td class="field-val mono">{{ ev.request_id || '—' }}</td></tr>
              <tr class="field-row"><td class="field-key">user_agent</td><td class="field-val mono">{{ ev.user_agent || '—' }}</td></tr>
              <tr class="field-row"><td class="field-key">description</td><td class="field-val">{{ ev.description || '—' }}</td></tr>
              <tr class="field-row"><td class="field-key">hash</td><td class="field-val mono field-hash">{{ ev.hash || '—' }}</td></tr>
              <tr class="field-row"><td class="field-key">prev_hash</td><td class="field-val mono field-hash">{{ ev.prev_hash || '—' }}</td></tr>
            </tbody>
          </table>

          <div class="raw-block">
            <div class="raw-head">changes</div>
            <pre class="raw-json mono">{{ prettyJson(ev.changes) }}</pre>
          </div>

          <div v-if="ev.metadata && ev.metadata !== '{}'" class="raw-block">
            <div class="raw-head">metadata</div>
            <pre class="raw-json mono">{{ prettyJson(ev.metadata) }}</pre>
          </div>
        </div>
      </template>
    </div>

    <!-- Pagination -->
    <div v-if="events.length > 0 || offset > 0" class="pagination">
      <button class="btn-page" :disabled="offset === 0 || loading" @click="prevPage">‹ Prev</button>
      <span class="page-indicator mono text-muted">Page {{ page }}</span>
      <button class="btn-page" :disabled="!hasMore || loading" @click="nextPage">Next ›</button>
    </div>
  </div>
</template>

<style scoped src="../styles/views/AuditView.css"></style>
