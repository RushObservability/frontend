<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import type { Funnel, FunnelStep, FunnelResult } from '../types'

const api = useApi()
const { canWrite } = useAuth()

// ── State ──
const funnels = ref<Funnel[]>([])
const selectedFunnel = ref<Funnel | null>(null)
const result = ref<FunnelResult | null>(null)
const running = ref(false)
const resultError = ref<string | null>(null)

// Time range — default 1h, persisted across navigations
const RANGE_KEY = 'funnels_range_minutes'
const rangeMinutes = ref<number>(Number(localStorage.getItem(RANGE_KEY)) || 60)
function setRange(v: number) {
  rangeMinutes.value = v
  localStorage.setItem(RANGE_KEY, String(v))
}
const rangeOptions = [
  { label: '1h', value: 60 },
  { label: '6h', value: 360 },
  { label: '24h', value: 1440 },
  { label: '7d', value: 10080 },
]

// New funnel form
const showForm = ref(false)
const formName = ref('')
const formSteps = ref<FunnelStep[]>([
  { label: 'Step 1', service_name: '', http_path_prefix: '', min_status_code: undefined, max_status_code: undefined },
  { label: 'Step 2', service_name: '', http_path_prefix: '', min_status_code: undefined, max_status_code: undefined },
])
const formError = ref<string | null>(null)
const deleteConfirm = ref<string | null>(null)

onMounted(loadFunnels)

async function loadFunnels() {
  try {
    const res = await api.listFunnels()
    funnels.value = res.funnels
    if (funnels.value.length > 0) selectFunnel(funnels.value[0]!)
  } catch { /* error in api.error */ }
}

function selectFunnel(f: Funnel) {
  selectedFunnel.value = f
  result.value = null
  resultError.value = null
  runFunnel()
}

async function runFunnel() {
  if (!selectedFunnel.value) return
  running.value = true
  resultError.value = null
  result.value = null
  try {
    const to = new Date().toISOString()
    const from = new Date(Date.now() - rangeMinutes.value * 60_000).toISOString()
    result.value = await api.runFunnel(selectedFunnel.value.id, from, to)
  } catch (e: any) {
    resultError.value = e.message || 'Failed to run funnel'
  } finally {
    running.value = false
  }
}

function addStep() {
  formSteps.value.push({ label: `Step ${formSteps.value.length + 1}`, service_name: '', http_path_prefix: '', min_status_code: undefined, max_status_code: undefined })
}

function removeStep(i: number) {
  if (formSteps.value.length <= 2) return
  formSteps.value.splice(i, 1)
}

async function createFunnel() {
  formError.value = null
  if (!formName.value.trim()) {
    formError.value = 'Name is required'
    return
  }
  const steps = formSteps.value.map(s => ({
    label: s.label || `Step`,
    ...(s.service_name ? { service_name: s.service_name } : {}),
    ...(s.http_path_prefix ? { http_path_prefix: s.http_path_prefix } : {}),
    ...(s.min_status_code ? { min_status_code: Number(s.min_status_code) } : {}),
    ...(s.max_status_code ? { max_status_code: Number(s.max_status_code) } : {}),
  })) as FunnelStep[]
  try {
    await api.createFunnel({ name: formName.value, steps })
    showForm.value = false
    formName.value = ''
    formSteps.value = [
      { label: 'Step 1', service_name: '', http_path_prefix: '' },
      { label: 'Step 2', service_name: '', http_path_prefix: '' },
    ]
    await loadFunnels()
  } catch (e: any) {
    formError.value = e.message || 'Failed to create funnel'
  }
}

async function deleteFunnel(id: string) {
  try {
    await api.deleteFunnel(id)
    funnels.value = funnels.value.filter(f => f.id !== id)
    if (selectedFunnel.value?.id === id) {
      selectedFunnel.value = null
      result.value = null
    }
    deleteConfirm.value = null
  } catch { /* error in api.error */ }
}


</script>

<template>
  <div class="funnels-page">
    <div class="funnels-layout">
      <!-- Left panel: funnel list -->
      <div class="funnels-sidebar">
        <div class="sidebar-header">
          <h2 class="sidebar-title">Trace Funnels</h2>
          <button v-if="canWrite" class="btn-create-sm" @click="showForm = !showForm">+ New</button>
        </div>

        <!-- Create form -->
        <div v-if="showForm && canWrite" class="funnel-form card">
          <div class="form-field">
            <label class="field-label">Funnel Name</label>
            <input class="field-input" v-model="formName" placeholder="e.g. Checkout flow" />
          </div>

          <div class="steps-list">
            <div v-for="(step, i) in formSteps" :key="i" class="step-card">
              <div class="step-header">
                <span class="step-num">Step {{ i + 1 }}</span>
                <button v-if="formSteps.length > 2" class="step-remove" @click="removeStep(i)">&times;</button>
              </div>
              <div class="form-field">
                <label class="field-label">Label</label>
                <input class="field-input" v-model="step.label" placeholder="e.g. Product page view" />
              </div>
              <div class="form-field">
                <label class="field-label">Service (optional)</label>
                <input class="field-input" v-model="step.service_name" placeholder="e.g. checkout-service" />
              </div>
              <div class="form-field">
                <label class="field-label">Path prefix (optional)</label>
                <input class="field-input" v-model="step.http_path_prefix" placeholder="e.g. /api/cart" />
              </div>
              <div class="form-row-2">
                <div class="form-field">
                  <label class="field-label">Min status</label>
                  <input class="field-input" type="number" v-model.number="step.min_status_code" placeholder="200" />
                </div>
                <div class="form-field">
                  <label class="field-label">Max status</label>
                  <input class="field-input" type="number" v-model.number="step.max_status_code" placeholder="299" />
                </div>
              </div>
            </div>
          </div>

          <button class="btn-add-step" @click="addStep" :disabled="formSteps.length >= 10">+ Add Step</button>

          <div v-if="formError" class="form-error">{{ formError }}</div>
          <div class="form-actions">
            <button class="btn-sm" @click="showForm = false">Cancel</button>
            <button class="btn-sm btn-primary" @click="createFunnel">Create</button>
          </div>
        </div>

        <!-- Funnel list -->
        <div v-if="funnels.length === 0 && !showForm" class="empty-state card" style="padding:var(--sp-4)">
          <div class="empty-state-icon">&#9654;</div>
          <div>No funnels yet</div>
          <div class="text-secondary" style="font-size:11px">Create a funnel to analyze trace drop-off rates</div>
        </div>

        <div
          v-for="f in funnels"
          :key="f.id"
          class="funnel-item"
          :class="{ selected: selectedFunnel?.id === f.id }"
          @click="selectFunnel(f)"
        >
          <div class="funnel-item-info">
            <div class="funnel-item-name">{{ f.name }}</div>
            <div class="funnel-item-meta text-muted">{{ f.steps.length }} steps</div>
          </div>
          <template v-if="canWrite">
            <button
              v-if="deleteConfirm !== f.id"
              class="action-btn action-btn-danger"
              @click.stop="deleteConfirm = f.id"
              title="Delete"
            >&times;</button>
            <span v-else class="delete-confirm" @click.stop>
              <button class="confirm-yes" @click="deleteFunnel(f.id)">Delete</button>
              <button class="confirm-no" @click="deleteConfirm = null">Cancel</button>
            </span>
          </template>
        </div>
      </div>

      <!-- Right panel: funnel result -->
      <div class="funnels-main">
        <div v-if="!selectedFunnel" class="empty-state card" style="height:200px">
          <div class="empty-state-icon">&#9654;</div>
          <div>Select a funnel to analyze</div>
        </div>

        <template v-else>
          <div class="run-header">
            <h3 class="run-title">{{ selectedFunnel.name }}</h3>
            <div class="run-controls">
              <div class="range-picker">
                <button
                  v-for="opt in rangeOptions"
                  :key="opt.value"
                  class="range-btn"
                  :class="{ active: rangeMinutes === opt.value }"
                  @click="setRange(opt.value)"
                >{{ opt.label }}</button>
              </div>
              <button class="btn-run" @click="runFunnel" :disabled="running">
                <span v-if="running">Running...</span>
                <span v-else>&#9654; Run Funnel</span>
              </button>
            </div>
          </div>

          <!-- Steps definition preview -->
          <div class="steps-preview card">
            <div class="steps-preview-title">Steps</div>
            <div class="steps-flow">
              <div v-for="(step, i) in selectedFunnel.steps" :key="i" class="steps-flow-item">
                <div class="step-pill">
                  <div class="step-pill-num">{{ i + 1 }}</div>
                  <div class="step-pill-info">
                    <div class="step-pill-label">{{ step.label }}</div>
                    <div class="step-pill-meta text-muted mono">
                      <span v-if="step.service_name">{{ step.service_name }}</span>
                      <span v-if="step.http_path_prefix"> {{ step.http_path_prefix }}</span>
                      <span v-if="step.min_status_code"> {{ step.min_status_code }}-{{ step.max_status_code ?? '∞' }}</span>
                    </div>
                  </div>
                </div>
                <div v-if="i < selectedFunnel.steps.length - 1" class="step-arrow">→</div>
              </div>
            </div>
          </div>

          <!-- Error -->
          <div v-if="resultError" class="empty-state card">
            <div class="empty-state-icon" style="color:var(--error)">!</div>
            <div>{{ resultError }}</div>
          </div>

          <!-- Results -->
          <div v-if="result" class="funnel-result card">
            <div class="funnel-steps">
              <div v-for="(step, i) in result.steps" :key="i" class="funnel-step">
                <div class="funnel-step-label">{{ step.label }}</div>
                <div class="funnel-bar-wrap">
                  <div
                    class="funnel-bar"
                    :style="{ width: Math.max(step.pct_of_first, 0.5).toFixed(1) + '%' }"
                    :class="i === 0 ? 'funnel-bar-first' : 'funnel-bar-rest'"
                  ></div>
                  <span class="funnel-bar-count mono">{{ step.count.toLocaleString() }}</span>
                </div>
                <div class="funnel-step-pct text-muted">
                  <span v-if="i === 0">100% (baseline)</span>
                  <span v-else>
                    {{ step.pct_of_prev.toFixed(1) }}% from prev
                    <span v-if="step.drop_off > 0" class="funnel-dropoff">
                      &minus;{{ step.drop_off.toLocaleString() }} dropped
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.funnels-page { display: flex; flex-direction: column; height: 100%; }

.funnels-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: var(--sp-4);
  align-items: start;
}

/* ── Sidebar ── */
.funnels-sidebar { display: flex; flex-direction: column; gap: var(--sp-2); }
.sidebar-header { display: flex; align-items: center; justify-content: space-between; }
.sidebar-title { font-size: 14px; font-weight: 600; margin: 0; }

.funnel-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all 0.15s;
}
.funnel-item:hover { background: var(--bg-hover); border-color: var(--border-default); }
.funnel-item.selected { border-color: var(--accent); background: var(--accent-dim, rgba(99,102,241,0.1)); }
.funnel-item-name { font-size: 13px; font-weight: 500; }
.funnel-item-meta { font-size: 11px; }

/* ── Form ── */
.funnel-form { padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-3); }
.field-label { font-size: 11px; font-weight: 500; color: var(--text-secondary); margin-bottom: 3px; display: block; }
.field-input {
  width: 100%;
  padding: 5px 8px;
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  color: var(--text-primary);
  font-size: 12px;
  box-sizing: border-box;
}
.field-input:focus { outline: none; border-color: var(--accent); }
.form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2); }
.step-card {
  padding: var(--sp-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.step-header { display: flex; align-items: center; justify-content: space-between; }
.step-num { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.step-remove { background: none; border: none; color: var(--error); cursor: pointer; font-size: 14px; padding: 0 2px; }
.steps-list { display: flex; flex-direction: column; gap: var(--sp-2); }
.btn-add-step {
  width: 100%;
  padding: 5px;
  font-size: 11px;
  background: var(--bg-raised);
  border: 1px dashed var(--border-default);
  border-radius: var(--r-sm);
  color: var(--text-secondary);
  cursor: pointer;
}
.btn-add-step:hover { background: var(--bg-hover); }
.form-error { font-size: 11px; color: var(--error); }
.form-actions { display: flex; gap: var(--sp-2); justify-content: flex-end; }

/* ── Actions ── */
.action-btn {
  padding: 3px 7px;
  font-size: 12px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  cursor: pointer;
  color: var(--text-secondary);
}
.action-btn:hover { background: var(--bg-hover); }
.action-btn-danger { color: var(--error); border-color: var(--error-dim); }
.action-btn-danger:hover { background: var(--error-dim); }
.delete-confirm { display: flex; gap: 4px; align-items: center; }
.confirm-yes { padding: 3px 7px; font-size: 11px; background: var(--error); color: #fff; border: none; border-radius: var(--r-sm); cursor: pointer; }
.confirm-no { padding: 3px 7px; font-size: 11px; background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--r-sm); cursor: pointer; color: var(--text-secondary); }

/* ── Main panel ── */
.funnels-main { display: flex; flex-direction: column; gap: var(--sp-4); }
.run-header { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
.run-title { font-size: 16px; font-weight: 600; margin: 0; }
.run-controls { display: flex; align-items: center; gap: var(--sp-2); }
.range-picker { display: flex; gap: 2px; }
.range-btn {
  padding: 4px 10px;
  font-size: 11px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  cursor: pointer;
  color: var(--text-secondary);
}
.range-btn:hover { background: var(--bg-hover); }
.range-btn.active { background: var(--accent-dim, rgba(99,102,241,0.15)); color: var(--accent); border-color: var(--accent); }
.btn-run {
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 600;
  background: var(--accent-dim, rgba(99,102,241,0.15));
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: all 0.15s;
}
.btn-run:hover { background: var(--accent); color: #fff; }
.btn-run:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Steps preview ── */
.steps-preview { padding: var(--sp-3); }
.steps-preview-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: var(--sp-2); }
.steps-flow { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-1); }
.steps-flow-item { display: flex; align-items: center; gap: var(--sp-1); }
.step-pill {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 4px 10px 4px 6px;
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-pill);
}
.step-pill-num {
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--accent-dim, rgba(99,102,241,0.2));
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.step-pill-label { font-size: 12px; font-weight: 500; }
.step-pill-meta { font-size: 10px; }
.step-arrow { color: var(--text-muted); font-size: 14px; }

/* ── Funnel result ── */
.funnel-result { padding: var(--sp-4); }
.funnel-steps { display: flex; flex-direction: column; gap: var(--sp-4); }
.funnel-step { display: flex; flex-direction: column; gap: var(--sp-1); }
.funnel-step-label { font-size: 13px; font-weight: 500; }
.funnel-bar-wrap { display: flex; align-items: center; gap: var(--sp-2); }
.funnel-bar {
  height: 28px;
  border-radius: var(--r-sm);
  min-width: 4px;
  transition: width 0.4s ease;
}
.funnel-bar-first { background: var(--accent, #6366f1); }
.funnel-bar-rest { background: var(--accent-dim, rgba(99,102,241,0.5)); }
.funnel-bar-count { font-size: 12px; color: var(--text-secondary); }
.funnel-step-pct { font-size: 11px; }
.funnel-dropoff { color: var(--error); margin-left: 6px; }

/* ── Shared buttons ── */
.btn-create-sm {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  color: var(--text-secondary);
  cursor: pointer;
}
.btn-create-sm:hover { background: var(--bg-hover); color: var(--text-primary); }
.btn-sm { padding: 4px 10px; font-size: 11px; font-weight: 500; border-radius: var(--r-sm); border: 1px solid var(--border-default); background: var(--bg-surface); color: var(--text-secondary); cursor: pointer; }
.btn-sm:hover { background: var(--bg-hover); color: var(--text-primary); }
.btn-primary { background: var(--accent-dim, rgba(99,102,241,0.1)) !important; color: var(--accent) !important; border-color: var(--accent) !important; }
.btn-primary:hover { background: var(--accent) !important; color: #fff !important; }
</style>
