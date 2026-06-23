<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import type { Slo, NotificationChannel } from '../types'
import SloForm from '../components/SloForm.vue'

const router = useRouter()
const route = useRoute()
const api = useApi()
const { canWrite } = useAuth()

const slos = ref<Slo[]>([])
// Optional service filter (deep-linked from a service page via ?service=).
const serviceFilter = ref((route.query.service as string) || '')
const visibleSlos = computed(() =>
  serviceFilter.value ? slos.value.filter(s => s.service_name === serviceFilter.value) : slos.value
)
const channels = ref<NotificationChannel[]>([])
const showForm = ref(false)
const editingSlo = ref<Slo | null>(null)
const formError = ref<string | null>(null)

let refreshTimer: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  await Promise.all([loadSlos(), loadChannels()])
  // Live refresh so error/total counts and state track the engine's evaluations.
  refreshTimer = setInterval(() => {
    if (showForm.value) return // don't disrupt an open create/edit form
    loadSlos()
  }, 20000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

async function loadSlos() {
  try {
    const res = await api.listSlos()
    slos.value = res.slos
  } catch { /* error in api.error */ }
}

async function loadChannels() {
  try {
    const res = await api.listChannels()
    channels.value = res.channels
  } catch { /* error in api.error */ }
}

async function createSlo(data: Record<string, unknown>) {
  formError.value = null
  try {
    await api.createSlo(data)
    showForm.value = false
    editingSlo.value = null
    await loadSlos()
  } catch (e: any) {
    formError.value = e.message || 'Failed to create SLO'
  }
}

async function updateSloHandler(data: Record<string, unknown>) {
  if (!editingSlo.value) return
  formError.value = null
  try {
    await api.updateSlo(editingSlo.value.id, data)
    showForm.value = false
    editingSlo.value = null
    await loadSlos()
  } catch (e: any) {
    formError.value = e.message || 'Failed to update SLO'
  }
}

function openNewSlo() {
  editingSlo.value = null
  formError.value = null
  showForm.value = true
}

function openSlo(slo: Slo) {
  router.push(`/slos/${slo.id}`)
}

// ── Derived ──

const compliantCount = computed(() => slos.value.filter(s => s.state === 'compliant').length)
const breachingCount = computed(() => slos.value.filter(s => s.state === 'breaching').length)
const noDataCount = computed(() => slos.value.filter(s => s.state === 'no_data').length)

function successRate(slo: Slo): string {
  if (slo.error_count === null || slo.total_count === null || slo.total_count === 0) return '-'
  const rate = ((slo.total_count - slo.error_count) / slo.total_count) * 100
  return rate.toFixed(2)
}

function budgetPct(slo: Slo): number {
  if (slo.error_budget_remaining === null) return 0
  const errorBudget = 1 - slo.target_percentage / 100
  if (errorBudget <= 0) return 0
  return Math.max(0, Math.min(100, (slo.error_budget_remaining / errorBudget) * 100))
}

function budgetLabel(slo: Slo): string {
  if (slo.error_budget_remaining === null) return '-'
  return `${budgetPct(slo).toFixed(1)}%`
}

function budgetSeverity(slo: Slo): string {
  const pct = budgetPct(slo)
  if (slo.error_budget_remaining === null) return 'none'
  if (pct > 50) return 'healthy'
  if (pct > 10) return 'warning'
  return 'critical'
}

function windowLabel(wt: string): string {
  switch (wt) {
    case 'rolling_1h': return '1h'
    case 'rolling_24h': return '24h'
    case 'rolling_7d': return '7d'
    case 'rolling_30d': return '30d'
    default: return wt
  }
}

// @ts-ignore reserved for template use
function formatDate(ts: string | null): string {
  if (!ts) return '-'
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return ts }
}

function stateLabel(s: string): string {
  if (s === 'breaching') return 'Breaching'
  if (s === 'compliant') return 'Compliant'
  return 'No Data'
}

function humanize(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return n.toString()
}
</script>

<template>
  <div class="sv-page">
    <!-- Header -->
    <div class="sv-header">
      <div class="sv-header-left">
        <h2 class="sv-title">Service Level Objectives</h2>
        <div class="sv-summary" v-if="slos.length > 0">
          <span class="sv-pill sv-pill-ok" v-if="compliantCount">{{ compliantCount }} compliant</span>
          <span class="sv-pill sv-pill-err" v-if="breachingCount">{{ breachingCount }} breaching</span>
          <span class="sv-pill sv-pill-muted" v-if="noDataCount">{{ noDataCount }} no data</span>
        </div>
      </div>
      <button v-if="canWrite" class="sv-btn-create" @click="openNewSlo">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        New SLO
      </button>
    </div>

    <div v-if="serviceFilter" class="svc-scope-chip">
      Filtered to service <span class="mono">{{ serviceFilter }}</span>
      <button @click="serviceFilter = ''" title="Clear filter" aria-label="Clear service filter">&times;</button>
    </div>

    <!-- Create/Edit Form -->
    <div v-if="showForm" class="sv-form-wrap fade-in">
      <div v-if="formError" class="sv-form-error">{{ formError }}</div>
      <SloForm
        :slo="editingSlo"
        :channels="channels"
        @save="editingSlo ? updateSloHandler($event) : createSlo($event)"
        @cancel="showForm = false; editingSlo = null"
      />
    </div>

    <!-- Empty State -->
    <div v-if="slos.length === 0 && !showForm" class="sv-empty card">
      <div class="sv-empty-diamond">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <path d="M14 2L26 14L14 26L2 14Z" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <path d="M14 8L20 14L14 20L8 14Z" stroke="currentColor" stroke-width="1" fill="none" opacity="0.4"/>
        </svg>
      </div>
      <div class="sv-empty-title">No SLOs defined</div>
      <div class="sv-empty-sub">Create one to track reliability targets across your system</div>
    </div>

    <!-- SLO Table -->
    <div class="sv-table card" v-if="slos.length > 0">
      <!-- Column headers -->
      <div class="sv-thead">
        <div class="sv-th sv-col-state">Status</div>
        <div class="sv-th sv-col-name">Name</div>
        <div class="sv-th sv-col-type">Type</div>
        <div class="sv-th sv-col-indicator">Indicator</div>
        <div class="sv-th sv-col-window">Window</div>
        <div class="sv-th sv-col-sli">Current SLO</div>
        <div class="sv-th sv-col-target">Target</div>
        <div class="sv-th sv-col-budget">Error Budget</div>
        <div class="sv-th sv-col-counts">Errors / Total</div>
        <div class="sv-th sv-col-arrow"></div>
      </div>

      <!-- Rows -->
      <div
        v-for="(slo, idx) in visibleSlos"
        :key="slo.id"
        class="sv-row"
        :class="{ 'sv-row-breaching': slo.state === 'breaching' }"
        :style="{ animationDelay: idx * 30 + 'ms' }"
        @click="openSlo(slo)"
      >
        <!-- State rail -->
        <div class="sv-row-rail" :class="'sv-rail-' + slo.state"></div>

        <!-- Status -->
        <div class="sv-cell sv-col-state">
          <div class="sv-state-indicator" :class="'sv-state-' + slo.state">
            <div class="sv-state-dot"></div>
            <span>{{ stateLabel(slo.state) }}</span>
          </div>
        </div>

        <!-- Name + desc + meta -->
        <div class="sv-cell sv-col-name">
          <div class="sv-name-primary">{{ slo.name }}</div>
          <div class="sv-name-secondary" v-if="slo.description">{{ slo.description }}</div>
          <div class="sv-name-meta mono" v-if="slo.slo_type === 'metric' && slo.metric_name">
            {{ slo.metric_name }}
          </div>
        </div>

        <!-- Type -->
        <div class="sv-cell sv-col-type">
          <span class="sv-type-badge" :class="slo.slo_type === 'metric' ? 'sv-type-metric' : 'sv-type-trace'">
            {{ slo.slo_type || 'trace' }}
          </span>
        </div>

        <!-- Indicator -->
        <div class="sv-cell sv-col-indicator">
          <span class="sv-type-badge sv-type-indicator">{{ slo.indicator_type || 'availability' }}</span>
        </div>

        <!-- Window -->
        <div class="sv-cell sv-col-window">
          <span class="sv-window-tag mono">{{ windowLabel(slo.window_type) }}</span>
        </div>

        <!-- SLI -->
        <div class="sv-cell sv-col-sli">
          <span class="sv-sli-value mono" :class="'sv-sli-' + slo.state">
            {{ successRate(slo) }}<span class="sv-sli-pct" v-if="successRate(slo) !== '-'">%</span>
          </span>
        </div>

        <!-- Target -->
        <div class="sv-cell sv-col-target">
          <span class="sv-target-value mono">{{ slo.target_percentage }}%</span>
        </div>

        <!-- Error Budget -->
        <div class="sv-cell sv-col-budget">
          <div class="sv-budget-inline">
            <div class="sv-budget-track">
              <div
                class="sv-budget-fill"
                :class="'sv-fill-' + budgetSeverity(slo)"
                :style="{ width: budgetPct(slo) + '%' }"
              ></div>
            </div>
            <span class="sv-budget-value mono" :class="'sv-bval-' + budgetSeverity(slo)">{{ budgetLabel(slo) }}</span>
          </div>
        </div>

        <!-- Counts -->
        <div class="sv-cell sv-col-counts">
          <span class="sv-counts mono" v-if="slo.error_count !== null && slo.total_count !== null">
            <span class="sv-count-err">{{ humanize(slo.error_count) }}</span>
            <span class="sv-count-sep">/</span>
            <span>{{ humanize(slo.total_count) }}</span>
          </span>
          <span v-else class="sv-counts mono">-</span>
        </div>

        <!-- Row arrow -->
        <div class="sv-cell sv-col-arrow">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" class="sv-arrow-icon"><path d="M3.5 2l4 3-4 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../styles/views/SlosView.css"></style>
