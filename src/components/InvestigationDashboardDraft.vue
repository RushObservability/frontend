<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiRequest, useApi } from '../composables/useApi'
import { useTenant } from '../composables/useTenant'
import { useAuth } from '../composables/useAuth'
import { useWidgetData } from '../composables/useWidgetData'
import { draftWidgets, previewHasData, type DashboardDraftResponse } from '../lib/dashboardDraft'
import type { DashboardExport, Widget, WidgetData } from '../types'
import WidgetWrapper from './widgets/WidgetWrapper.vue'

const props = defineProps<{ sessionId: string }>()
const api = useApi()
const router = useRouter()
const { activeTenant } = useTenant()
const { canWrite } = useAuth()
const { fetchWidgetData } = useWidgetData()
const open = ref(false)
const instructions = ref('')
const minutes = ref(60)
const busy = ref(false)
const saving = ref(false)
const error = ref('')
const draft = ref<DashboardExport | null>(null)
const widgets = ref<Widget[]>([])
const previews = ref<Record<string, WidgetData>>({})
const failures = ref<Record<string, string>>({})
const excluded = ref<string[]>([])
const retained = computed(() => widgets.value.filter(widget => !excluded.value.includes(widget.id)))
const canSave = computed(() => !busy.value && !saving.value && !!draft.value?.dashboard.name.trim()
  && retained.value.length > 0 && retained.value.every(widget => !failures.value[widget.id] && previewHasData(previews.value[widget.id])))
let controller: AbortController | null = null

function reset() {
  controller?.abort()
  controller = null
  busy.value = false
  saving.value = false
  draft.value = null
  widgets.value = []
  previews.value = {}
  failures.value = {}
  excluded.value = []
  error.value = ''
}
watch(() => [props.sessionId, activeTenant.value], () => { reset(); open.value = false; instructions.value = '' })
watch(minutes, reset)
onBeforeUnmount(reset)

async function generate() {
  reset()
  const current = new AbortController()
  controller = current
  busy.value = true
  try {
    const response = await apiRequest<DashboardDraftResponse>(`/sessions/${encodeURIComponent(props.sessionId)}/dashboard-draft`, {
      method: 'POST', body: JSON.stringify({ instructions: instructions.value, time_range_minutes: minutes.value }),
      signal: current.signal, invalidatesAnalytics: false,
    })
    if (controller !== current || current.signal.aborted) return
    const panels = draftWidgets(response.draft)
    draft.value = response.draft
    widgets.value = panels
    await Promise.all(panels.map(async widget => {
      try {
        const data = await fetchWidgetData(widget, {}, minutes.value, current.signal, response.time_range)
        if (controller !== current || current.signal.aborted) return
        previews.value[widget.id] = data
        if (!previewHasData(data)) failures.value[widget.id] = 'No samples in the preview range. Exclude this panel or try a wider range.'
      } catch {
        if (controller === current && !current.signal.aborted) failures.value[widget.id] = 'This panel query failed. Exclude it or generate another draft.'
      }
    }))
  } catch (cause) {
    if (controller === current && !current.signal.aborted) {
      error.value = cause instanceof Error ? cause.message : 'Could not generate a dashboard draft.'
    }
  } finally {
    if (controller === current) busy.value = false
  }
}

async function save() {
  if (!canSave.value || !draft.value) return
  saving.value = true
  error.value = ''
  const current = controller
  try {
    const selected = new Set(retained.value.map(widget => widget.id))
    const payload: DashboardExport = { ...draft.value, widgets: draft.value.widgets.filter((_, index) => selected.has(`draft-${index}`)) }
    const dashboard = await api.importDashboard(payload)
    if (controller === current) await router.push(`/dashboards/${dashboard.id}`)
  } catch (cause) {
    if (controller === current) error.value = cause instanceof Error ? cause.message : 'Could not save this dashboard.'
  } finally {
    if (controller === current) saving.value = false
  }
}
</script>

<template>
  <section v-if="canWrite && sessionId" class="investigation-draft" aria-label="Dashboard draft">
    <button v-if="!open" type="button" class="btn btn-sm" @click="open = true">Build dashboard from investigation</button>
    <template v-else>
      <div class="draft-heading"><div><h3>Build a dashboard</h3><p>Describe what to keep watching. Review the queries and live previews before saving a private dashboard.</p></div><button type="button" class="btn btn-sm" :disabled="saving" @click="reset(); open = false">Close</button></div>
      <div class="draft-controls">
        <label>What should it show?<textarea v-model="instructions" maxlength="2048" rows="2" placeholder="Payments latency, request volume, error logs, and relevant database metrics" :disabled="busy || saving" /></label>
        <label>Preview lookback<select v-model.number="minutes" :disabled="busy || saving"><option :value="15">15 minutes</option><option :value="60">1 hour</option><option :value="360">6 hours</option><option :value="1440">24 hours</option><option :value="10080">7 days</option></select></label>
      </div>
      <div class="draft-toolbar"><span>Uses one model request and queries your tenant's available telemetry.</span><button type="button" class="btn btn-sm" :disabled="busy || saving" @click="generate">{{ busy ? 'Building and checking panels…' : draft ? 'Generate another draft' : 'Generate draft' }}</button></div>
      <p v-if="error" class="draft-error" role="alert">{{ error }}</p>
      <template v-if="draft">
        <label class="draft-name">Dashboard name<input v-model="draft.dashboard.name" maxlength="120" :disabled="saving" /></label>
        <div class="draft-panels">
          <article v-for="widget in widgets" :key="widget.id" class="draft-panel" :class="{ excluded: excluded.includes(widget.id) }">
            <WidgetWrapper :title="widget.title" :type="widget.widget_type" :data="previews[widget.id]" :unit="String(widget.display_config?.unit || '')" :loading="busy && !previews[widget.id] && !failures[widget.id]" :error="failures[widget.id]" />
            <div class="draft-panel-tools"><details><summary>View query</summary><pre>{{ JSON.stringify(widget.query_config, null, 2) }}</pre></details><button type="button" class="btn btn-sm" :disabled="busy || saving" @click="excluded.includes(widget.id) ? excluded = excluded.filter(id => id !== widget.id) : excluded.push(widget.id)">{{ excluded.includes(widget.id) ? 'Include panel' : 'Exclude panel' }}</button></div>
          </article>
        </div>
        <div class="draft-save"><span>{{ retained.length }} {{ retained.length === 1 ? 'panel' : 'panels' }} selected. Only panels with successful previews can be saved.</span><button type="button" class="btn btn-primary" :disabled="!canSave" @click="save">{{ saving ? 'Saving…' : 'Save private dashboard' }}</button></div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.investigation-draft { flex: 0 0 auto; margin: 20px 0; padding-top: 18px; border-top: 1px solid var(--border-default); font-size: 12px; }
.btn { padding: 6px 10px; border: 1px solid var(--border-default); border-radius: var(--r-sm); background: var(--bg-raised); color: var(--text-primary); font: inherit; cursor: pointer; white-space: nowrap; }
.btn:hover:not(:disabled) { border-color: var(--accent); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--text-inverse); }
.draft-heading, .draft-toolbar, .draft-save, .draft-panel-tools { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.draft-heading { align-items: flex-start; }
.draft-heading h3 { margin: 0 0 6px; font-size: 15px; color: var(--text-primary); }
.draft-heading p, .draft-toolbar, .draft-save { color: var(--text-secondary); line-height: 1.5; }
.draft-heading p { margin: 0; }
.draft-controls { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 16px; margin: 16px 0 10px; }
label { display: flex; flex-direction: column; gap: 6px; color: var(--text-secondary); }
input, textarea, select { width: 100%; border: 1px solid var(--border-default); border-radius: var(--r-sm); background: var(--bg-raised); color: var(--text-primary); font: inherit; padding: 8px 10px; }
textarea { resize: vertical; }
input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.draft-name { margin: 18px 0 12px; }
.draft-panels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.draft-panel { min-width: 0; }
.draft-panel > .widget-wrap { height: 260px; }
.draft-panel.excluded { opacity: .55; }
.draft-panel-tools { padding: 8px 0 12px; align-items: flex-start; }
details { min-width: 0; flex: 1; }
summary { cursor: pointer; color: var(--text-secondary); }
pre { margin: 8px 0; padding: 10px; max-height: 220px; overflow: auto; color: var(--text-primary); background: var(--bg-raised); font-size: 11px; }
.draft-error { color: var(--red); }
.draft-save { padding-top: 14px; border-top: 1px solid var(--border-default); }
@media (max-width: 760px) { .draft-panels, .draft-controls { grid-template-columns: 1fr; } .draft-toolbar, .draft-save { align-items: stretch; flex-direction: column; } }
</style>
