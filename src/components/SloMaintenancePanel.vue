<script setup lang="ts">
import { computed, ref } from 'vue'
import { useApi } from '../composables/useApi'
import { parseUtcTimestamp } from '../lib/utcTimestamp'
import type { Slo, SloMaintenanceRepeat, SloMaintenanceWindow } from '../types'
import DataTable from './DataTable.vue'
import { PanelCard } from './panels'

const props = defineProps<{ slo: Slo; canWrite: boolean }>()
const emit = defineEmits<{ updated: [slo: Slo] }>()
const api = useApi()
const editing = ref(false)
const saving = ref(false)
const error = ref('')
const revision = ref(0)
const draft = ref<Array<SloMaintenanceWindow & { key: string }>>([])
const windows = computed(() => props.slo.maintenance_windows ?? [])
const evaluation = computed(() => props.slo.maintenance_evaluation)
const pending = computed(() => (evaluation.value?.revision ?? 0) !== (props.slo.maintenance_revision ?? 0))
const isGauge = computed(() => props.slo.indicator_type === 'threshold')

const repeats: Record<SloMaintenanceRepeat, string> = {
  once: 'Once',
  daily: 'Daily',
  weekly: 'Weekly',
}
const utc = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC',
})

function time(value: string) {
  return utc.format(parseUtcTimestamp(value))
}

function duration(seconds: number) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor(seconds / 3_600) % 24
  const minutes = Math.floor(seconds / 60) % 60
  const remaining = seconds % 60
  return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`, remaining && `${remaining}s`].filter(Boolean).join(' ') || '0s'
}

function utcInput(value: string | number) {
  return new Date(value).toISOString().slice(0, 19)
}

function edit() {
  error.value = ''
  revision.value = props.slo.maintenance_revision ?? 0
  draft.value = windows.value.map(window => ({
    ...window, key: crypto.randomUUID(),
    starts_at: utcInput(window.starts_at), ends_at: utcInput(window.ends_at),
  }))
  editing.value = true
  if (!draft.value.length) add()
}

function add() {
  const now = Math.floor(Date.now() / 60_000) * 60_000
  draft.value.push({
    key: crypto.randomUUID(), name: '', repeat: 'once',
    starts_at: utcInput(now), ends_at: utcInput(now + 3_600_000),
  })
}

async function save() {
  if (saving.value) return
  error.value = ''
  const windows: SloMaintenanceWindow[] = []
  for (const row of draft.value) {
    const start = Date.parse(`${row.starts_at}Z`)
    const end = Date.parse(`${row.ends_at}Z`)
    if (!row.name.trim() || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      error.value = 'Give each window a name and an end time after its start.'
      return
    }
    windows.push({
      name: row.name.trim(), repeat: row.repeat,
      starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(),
    })
  }
  saving.value = true
  try {
    const updated = await api.replaceSloMaintenanceExclusions(props.slo.id, revision.value, windows)
    emit('updated', updated)
    editing.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save the maintenance exclusions.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <PanelCard
    title="Maintenance exclusions"
    description="Remove approved maintenance from this SLO’s rolling budget."
    class="slo-maintenance"
  >
    <template v-if="canWrite && slo.maintenance_supported && !editing" #actions>
      <button class="btn btn-sm" type="button" @click="edit">{{ windows.length ? 'Edit exclusions' : 'Add exclusion' }}</button>
    </template>

    <p v-if="!slo.maintenance_supported" class="text-muted maintenance-note">
      Exclusions are available for SLOs calculated from request or sample counts. This SLO uses PromQL expressions.
    </p>

    <form v-else-if="editing" class="maintenance-editor" @submit.prevent="save">
      <p class="text-secondary maintenance-note">Saving applies this schedule to the rolling budget at the next evaluation. Recurring times stay fixed in UTC.</p>
      <fieldset v-for="(window, index) in draft" :key="window.key" class="maintenance-fieldset" :disabled="saving">
        <legend>Window {{ index + 1 }}</legend>
        <div class="maintenance-fields">
          <label>Name<input v-model="window.name" required maxlength="255" placeholder="Database maintenance" /></label>
          <label>First start (UTC)<input v-model="window.starts_at" type="datetime-local" step="1" required /></label>
          <label>First end (UTC)<input v-model="window.ends_at" type="datetime-local" step="1" required /></label>
          <label>Repeat
            <select v-model="window.repeat" aria-label="Repeat">
              <option v-for="(label, value) in repeats" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <button class="btn btn-sm" type="button" :aria-label="`Remove window ${index + 1}`" @click="draft.splice(index, 1)">Remove</button>
        </div>
      </fieldset>
      <p v-if="error" class="text-error maintenance-note" role="alert">{{ error }}</p>
      <div class="maintenance-actions">
        <button class="btn btn-sm" type="button" :disabled="saving || draft.length >= 16" @click="add">Add window</button>
        <button class="btn btn-sm" type="button" :disabled="saving" @click="editing = false">Cancel</button>
        <button class="btn btn-primary btn-sm" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save exclusions' }}</button>
      </div>
    </form>

    <template v-else>
      <p v-if="pending" class="text-muted maintenance-note" role="status">
        {{ slo.enabled ? 'Waiting for the next budget evaluation to apply the saved schedule.' : 'Evaluation is disabled. Enable this SLO to apply the saved schedule.' }}
      </p>
      <dl v-if="evaluation && (windows.length || evaluation.periods.length)" class="maintenance-totals">
        <div><dt>Excluded time</dt><dd>{{ duration(evaluation.excluded_seconds) }}</dd></div>
        <div><dt>{{ isGauge ? 'Excluded samples' : 'Excluded requests' }}</dt><dd>{{ evaluation.excluded_total.toLocaleString() }}</dd></div>
        <div><dt>{{ isGauge ? 'Excluded threshold violations' : slo.indicator_type === 'latency' ? 'Excluded slow requests' : 'Excluded errors' }}</dt><dd>{{ evaluation.excluded_bad.toLocaleString() }}</dd></div>
      </dl>
      <details v-if="evaluation?.periods.length" class="maintenance-periods">
        <summary>Applied periods ({{ evaluation.periods.length }})</summary>
        <DataTable bare class="maintenance-table">
          <thead><tr><th>Start (UTC)</th><th>End (UTC)</th></tr></thead>
          <tbody>
            <tr v-for="period in evaluation.periods" :key="period.starts_at">
              <td>{{ time(period.starts_at) }}</td>
              <td>{{ time(period.ends_at) }}</td>
            </tr>
          </tbody>
        </DataTable>
      </details>
      <DataTable v-if="windows.length" bare class="maintenance-table">
        <thead><tr><th>Scheduled window</th><th>First start (UTC)</th><th>First end (UTC)</th><th>Repeats</th></tr></thead>
        <tbody>
          <tr v-for="(window, index) in windows" :key="index">
            <td>{{ window.name }}</td><td>{{ time(window.starts_at) }}</td><td>{{ time(window.ends_at) }}</td><td>{{ repeats[window.repeat] }}</td>
          </tr>
        </tbody>
      </DataTable>
      <p v-else class="text-muted maintenance-note">No maintenance windows scheduled.</p>
    </template>
  </PanelCard>
</template>

<style scoped>
.maintenance-note { margin: 0; }
.maintenance-totals {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--sp-6, 24px);
  row-gap: var(--sp-2, 8px);
  margin: 0;
}
.maintenance-note + .maintenance-totals,
.maintenance-table,
.maintenance-periods { margin-top: var(--sp-3, 12px); }
.maintenance-totals dt { color: var(--text-muted); font-size: 11px; }
.maintenance-totals dd { margin: 4px 0 0; font: 600 18px var(--font-mono); }
.maintenance-periods summary { color: var(--accent); cursor: pointer; width: fit-content; }
.maintenance-periods .maintenance-table { margin-top: var(--sp-2, 8px); }
.maintenance-table { overflow-x: auto; }
.maintenance-editor { display: grid; row-gap: var(--sp-3, 12px); }
.maintenance-fieldset { min-width: 0; margin: 0; padding: var(--sp-2, 8px) var(--sp-3, 12px); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); }
.maintenance-fieldset legend { padding-inline: 4px; font-size: 12px; font-weight: 600; }
.maintenance-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
  align-items: end;
  gap: var(--sp-2, 8px);
}
.maintenance-fields label { display: grid; gap: 4px; color: var(--text-secondary); font-size: 12px; }
.maintenance-fields input, .maintenance-fields select {
  min-width: 0;
  width: 100%;
  min-height: 32px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  background: var(--bg-root);
  color: var(--text-primary);
  padding: 3px 7px;
}
.maintenance-fields button { justify-self: start; }
.maintenance-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2, 8px); }
.maintenance-actions button:first-child { margin-right: auto; }
</style>
