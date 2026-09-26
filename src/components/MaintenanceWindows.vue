<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import type { MaintenanceWindow, Monitor } from '../types'
import DeleteConfirmationModal from './DeleteConfirmationModal.vue'
import {
  addMinutes,
  localInputToIso,
  scopeLabel,
  scopeReady,
  scopeValue,
  sortWindows,
  toLocalInput,
  type ScopeDraft,
} from '../lib/maintenanceWindows'

const api = useApi()
const { canWrite } = useAuth()

const windows = ref<MaintenanceWindow[]>([])
const monitors = ref<Monitor[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const editorOpen = ref(false)
const pendingDelete = ref<MaintenanceWindow | null>(null)
const deleting = ref(false)
const deleteError = ref('')

const durations = [
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '4h', minutes: 240 },
  { label: '1d', minutes: 1440 },
]

const name = ref('')
const scope = ref<ScopeDraft>({ kind: 'all', monitorId: '', tagKey: '', tagValue: '' })
const startsAt = ref('')
const endsAt = ref('')

function resetDraft() {
  const start = toLocalInput(new Date())
  name.value = ''
  scope.value = { kind: 'all', monitorId: '', tagKey: '', tagValue: '' }
  startsAt.value = start
  endsAt.value = addMinutes(start, 60)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [list, monitorList] = await Promise.all([
      api.listMaintenanceWindows(),
      api.listMonitors().catch(() => ({ monitors: [] as Monitor[] })),
    ])
    windows.value = list.windows
    monitors.value = monitorList.monitors
  } catch (cause: any) {
    error.value = cause?.message || 'Could not load maintenance windows.'
  } finally {
    loading.value = false
  }
}

const sortedWindows = computed(() => sortWindows(windows.value).slice(0, 25))
const activeCount = computed(() => windows.value.filter(w => w.status === 'active').length)

const formReady = computed(() =>
  name.value.trim() !== ''
  && scopeReady(scope.value)
  && localInputToIso(startsAt.value) !== null
  && localInputToIso(endsAt.value) !== null
  && endsAt.value > startsAt.value,
)

function monitorName(id: string): string | undefined {
  return monitors.value.find(m => m.id === id)?.name
}

function openCreate() {
  resetDraft()
  error.value = ''
  editorOpen.value = true
}

function closeEditor() {
  if (saving.value) return
  editorOpen.value = false
  error.value = ''
}

function setDuration(minutes: number) {
  endsAt.value = addMinutes(startsAt.value, minutes)
}

async function save() {
  if (!formReady.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const created = await api.createMaintenanceWindow({
      name: name.value.trim(),
      scope: scopeValue(scope.value),
      starts_at: localInputToIso(startsAt.value)!,
      ends_at: localInputToIso(endsAt.value)!,
    })
    windows.value = [created, ...windows.value]
    editorOpen.value = false
  } catch (cause: any) {
    error.value = cause?.message || 'Could not schedule this window.'
  } finally {
    saving.value = false
  }
}

function askDelete(window: MaintenanceWindow) {
  pendingDelete.value = window
  deleteError.value = ''
}

async function confirmDelete() {
  if (!pendingDelete.value || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    const id = pendingDelete.value.id
    await api.deleteMaintenanceWindow(id)
    windows.value = windows.value.filter(w => w.id !== id)
    pendingDelete.value = null
  } catch (cause: any) {
    deleteError.value = cause?.message || 'Could not remove this window.'
  } finally {
    deleting.value = false
  }
}

const deleteCopy = computed(() => {
  const w = pendingDelete.value
  if (!w) return { title: '', description: '', confirm: '' }
  if (w.status === 'active') {
    return {
      title: 'End this window now?',
      description: `Notifications resume for ${scopeLabel(w.scope, monitorName)}. Anything that changed during “${w.name}” is notified on the next evaluation.`,
      confirm: 'End window',
    }
  }
  if (w.status === 'scheduled') {
    return {
      title: 'Cancel this window?',
      description: `“${w.name}” won't silence anything.`,
      confirm: 'Cancel window',
    }
  }
  return {
    title: 'Remove this window?',
    description: `“${w.name}” has already ended. Removing it only clears it from this list.`,
    confirm: 'Remove',
  }
})

function actionLabel(window: MaintenanceWindow): string {
  if (window.status === 'active') return 'End now'
  if (window.status === 'scheduled') return 'Cancel'
  return 'Remove'
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function when(window: MaintenanceWindow): string {
  return `${timeFormat.format(new Date(window.starts_at))} → ${timeFormat.format(new Date(window.ends_at))}`
}

onMounted(load)
</script>

<template>
  <section class="maint-section" aria-labelledby="maintenance-title">
    <div class="maint-head">
      <div>
        <div class="maint-eyebrow">
          Planned work
          <span v-if="activeCount" class="maint-live">{{ activeCount }} active</span>
        </div>
        <h2 id="maintenance-title">Maintenance windows</h2>
        <p>
          Silence alert notifications during planned work. Alerts keep evaluating and record their
          changes. When a window ends, anything that differs from its last notification is sent once.
        </p>
      </div>
      <button v-if="canWrite && !editorOpen" type="button" class="maint-add" @click="openCreate">
        Schedule window
      </button>
    </div>

    <form v-if="editorOpen" class="maint-editor" @submit.prevent="save">
      <label class="maint-field maint-wide">
        <span>Name</span>
        <input v-model="name" type="text" maxlength="255" placeholder="Database upgrade" autofocus />
      </label>

      <fieldset class="maint-field maint-wide">
        <legend>Silences</legend>
        <div class="scope-picker" role="radiogroup">
          <label :class="{ selected: scope.kind === 'all' }">
            <input v-model="scope.kind" type="radio" value="all" />
            <strong>All alerts</strong>
            <small>Every alert in this tenant</small>
          </label>
          <label :class="{ selected: scope.kind === 'monitor' }">
            <input v-model="scope.kind" type="radio" value="monitor" />
            <strong>One alert</strong>
            <small>Pick it below</small>
          </label>
          <label :class="{ selected: scope.kind === 'tag' }">
            <input v-model="scope.kind" type="radio" value="tag" />
            <strong>Alerts with a tag</strong>
            <small>Such as <code>service:checkout</code></small>
          </label>
        </div>
        <select v-if="scope.kind === 'monitor'" v-model="scope.monitorId" aria-label="Alert">
          <option value="" disabled>Choose an alert…</option>
          <option v-for="m in monitors" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
        <div v-if="scope.kind === 'tag'" class="tag-row">
          <input v-model="scope.tagKey" aria-label="Tag key" placeholder="service" />
          <span>:</span>
          <input v-model="scope.tagValue" aria-label="Tag value" placeholder="checkout" />
        </div>
      </fieldset>

      <label class="maint-field">
        <span>Starts</span>
        <input v-model="startsAt" type="datetime-local" />
      </label>
      <label class="maint-field">
        <span>Ends</span>
        <input v-model="endsAt" type="datetime-local" />
      </label>
      <div class="duration-row maint-wide">
        <span>Length</span>
        <button v-for="d in durations" :key="d.label" type="button" @click="setDuration(d.minutes)">{{ d.label }}</button>
        <small>Times are in your local time zone. Windows can last up to 90 days.</small>
      </div>

      <p v-if="error" class="maint-error maint-wide" role="alert">{{ error }}</p>
      <div class="maint-actions maint-wide">
        <button type="button" class="maint-cancel" :disabled="saving" @click="closeEditor">Cancel</button>
        <button type="submit" class="maint-save" :disabled="!formReady || saving">
          {{ saving ? 'Scheduling…' : 'Schedule window' }}
        </button>
      </div>
    </form>

    <p v-if="error && !editorOpen" class="maint-error standalone" role="alert">{{ error }}</p>
    <div v-if="loading" class="maint-empty">Loading maintenance windows…</div>
    <div v-else-if="windows.length === 0 && !editorOpen" class="maint-empty">
      <strong>No maintenance windows</strong>
      <span>Schedule one before a deploy or migration so on-call isn't paged for expected alerts.</span>
    </div>
    <div v-else-if="windows.length" class="maint-table">
      <div class="maint-table-head">
        <span>Window</span><span>Silences</span><span>When</span><span>Status</span><span></span>
      </div>
      <div v-for="w in sortedWindows" :key="w.id" class="maint-row" :class="{ ended: w.status === 'ended' }">
        <div class="maint-identity">
          <strong>{{ w.name }}</strong>
          <small v-if="w.created_by">by {{ w.created_by }}</small>
        </div>
        <div class="maint-scope"><span>{{ scopeLabel(w.scope, monitorName) }}</span></div>
        <div class="maint-when">{{ when(w) }}</div>
        <div><span class="maint-status" :class="w.status">{{ w.status }}</span></div>
        <div v-if="canWrite" class="maint-row-actions">
          <button type="button" :class="{ danger: w.status === 'active' }" @click="askDelete(w)">{{ actionLabel(w) }}</button>
        </div>
      </div>
    </div>

    <DeleteConfirmationModal
      :open="!!pendingDelete"
      :title="deleteCopy.title"
      :description="deleteCopy.description"
      :confirm-label="deleteCopy.confirm"
      cancel-label="Keep it"
      :busy="deleting"
      :error="deleteError"
      @cancel="pendingDelete = null"
      @confirm="confirmDelete"
    />
  </section>
</template>

<style scoped>
.maint-section { padding: 28px 24px 24px; border-top: 1px solid var(--border-subtle); }
.maint-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.maint-eyebrow { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; color: var(--accent); font-size: 10px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
.maint-live { padding: 2px 6px; color: var(--warning); background: var(--warning-dim); border-radius: 999px; letter-spacing: .04em; }
.maint-head h2 { margin: 0; color: var(--text-primary); font: 650 17px/1.25 var(--font-ui); }
.maint-head p { max-width: 650px; margin: 6px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.55; }
.maint-add, .maint-save { min-height: 34px; padding: 0 14px; white-space: nowrap; flex-shrink: 0; color: var(--text-inverse); background: var(--accent); border: 1px solid var(--accent); border-radius: 6px; font: 650 12px var(--font-ui); }
.maint-add:hover, .maint-save:hover:not(:disabled) { filter: brightness(1.06); }
.maint-editor { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 24px; margin-top: 18px; padding: 22px; background: var(--bg-subtle); border: 1px solid var(--border-default); border-radius: 8px; }
.maint-wide { grid-column: 1 / -1; }
.maint-field { display: grid; align-content: start; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
.maint-field > span, .maint-field legend, .duration-row > span { padding: 0; color: var(--text-primary); font-size: 11px; font-weight: 700; letter-spacing: .03em; }
.maint-field input, .maint-field select, .tag-row input { width: 100%; min-height: 36px; padding: 0 10px; color: var(--text-primary); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 5px; font: 12px var(--font-ui); }
.maint-field input:focus, .maint-field select:focus, .tag-row input:focus { border-color: var(--accent); outline: 2px solid var(--focus-ring); outline-offset: 1px; }
.scope-picker { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
.scope-picker label { display: grid; gap: 2px; padding: 9px 11px; background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 6px; cursor: pointer; }
.scope-picker label.selected { background: var(--accent-soft); border-color: var(--accent); }
.scope-picker input { position: absolute; opacity: 0; pointer-events: none; }
.scope-picker strong { color: var(--text-primary); font-size: 12px; font-weight: 650; }
.scope-picker small { color: var(--text-muted); font-size: 10px; }
.tag-row { display: grid; grid-template-columns: minmax(0, 1fr) 12px minmax(0, 1fr); align-items: center; gap: 6px; }
.tag-row > span { color: var(--text-muted); text-align: center; }
.duration-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.duration-row > span { margin-right: 4px; }
.duration-row button { min-height: 28px; padding: 0 10px; color: var(--text-secondary); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 5px; font: 650 11px var(--font-ui); }
.duration-row button:hover { color: var(--accent); border-color: var(--accent); }
.duration-row small { flex-basis: 100%; color: var(--text-muted); font-size: 10px; }
.maint-actions { display: flex; justify-content: flex-end; gap: 8px; }
.maint-cancel { min-height: 34px; padding: 0 14px; color: var(--text-secondary); background: transparent; border: 1px solid var(--border-default); border-radius: 6px; font: 600 12px var(--font-ui); }
.maint-save:disabled, .maint-cancel:disabled { cursor: not-allowed; opacity: .5; }
.maint-error { margin: 0; color: var(--error); font-size: 11px; }
.maint-error.standalone { margin-top: 14px; }
.maint-empty { display: grid; gap: 5px; margin-top: 18px; padding: 28px 16px; color: var(--text-muted); border: 1px dashed var(--border-default); border-radius: 7px; font-size: 11px; text-align: center; }
.maint-empty strong { color: var(--text-primary); font-size: 12px; }
.maint-table { margin-top: 18px; border: 1px solid var(--border-subtle); border-radius: 7px; overflow: hidden; }
.maint-table-head, .maint-row { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1.4fr) 78px 64px; align-items: center; column-gap: 12px; }
.maint-table-head { min-height: 32px; padding: 0 12px; color: var(--text-muted); background: var(--bg-subtle); border-bottom: 1px solid var(--border-subtle); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.maint-row { min-height: 56px; padding: 9px 12px; background: var(--bg-surface); border-bottom: 1px solid var(--border-subtle); font-size: 12px; }
.maint-row:last-child { border-bottom: 0; }
.maint-row.ended > div:not(.maint-row-actions) { opacity: .55; }
.maint-identity strong, .maint-identity small { display: block; }
.maint-identity strong { color: var(--text-primary); font-weight: 650; }
.maint-identity small { margin-top: 3px; color: var(--text-muted); font-size: 10px; }
.maint-scope span { padding: 3px 6px; color: var(--text-secondary); background: var(--bg-subtle); border: 1px solid var(--border-subtle); border-radius: 4px; font: 10px/1.2 var(--font-mono); }
.maint-when { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.maint-status { padding: 3px 7px; border-radius: 999px; font-size: 10px; font-weight: 650; text-transform: capitalize; }
.maint-status.active { color: var(--warning); background: var(--warning-dim); }
.maint-status.scheduled { color: var(--accent); background: var(--accent-soft); }
.maint-status.ended { color: var(--text-muted); background: var(--bg-subtle); }
.maint-row-actions { display: flex; justify-content: flex-end; }
.maint-row-actions button { padding: 5px 7px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 4px; font: 600 10px var(--font-ui); }
.maint-row-actions button:hover { color: var(--text-primary); background: var(--bg-hover); }
.maint-row-actions button.danger:hover { color: var(--error); }
code { font-family: var(--font-mono); }

@media (max-width: 980px) {
  .maint-table-head { display: none; }
  .maint-row { grid-template-columns: 1fr auto; gap: 8px 16px; }
  .maint-scope, .maint-when { grid-column: 1 / -1; }
  .maint-row-actions { grid-column: 2; grid-row: 1; }
}

@media (max-width: 620px) {
  .maint-section { padding: 22px 16px; }
  .maint-head { align-items: stretch; flex-direction: column; }
  .maint-add { align-self: flex-start; }
  .maint-editor { grid-template-columns: 1fr; padding: 16px; }
  .scope-picker { grid-template-columns: 1fr; }
}
</style>
