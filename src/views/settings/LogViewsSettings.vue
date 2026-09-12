<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useApi } from '../../composables/useApi'
import { useTenant } from '../../composables/useTenant'
import { useAuth } from '../../composables/useAuth'
import { DEFAULT_LOG_COLUMNS, logViewKey, logViewScope, validateLogColumns, type LogView, type LogViewScope } from '../../lib/logViews'
import LogColumnsEditor from '../../components/LogColumnsEditor.vue'
import DataTable from '../../components/DataTable.vue'
import DetailDrawer from '../../components/DetailDrawer.vue'

const api = useApi()
const { activeTenant, activeTenantName, tenants, setTenant } = useTenant()
const { isAdmin, isAuthenticated, user } = useAuth()
const views = ref<LogView[]>([])
const draft = ref<LogView | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const deleting = ref('')
const loadFailed = ref(false)
let generation = 0
const draftIsExisting = computed(() => !!draft.value && views.value.some(view => logViewKey(view) === logViewKey(draft.value!)))
function canEdit(view: LogView) { return isAuthenticated.value && (logViewScope(view) === 'personal' || isAdmin.value) }
function scopeViews(scope: LogViewScope) { return views.value.filter(view => logViewScope(view) === scope) }

async function load() {
  const run = ++generation
  views.value = []; draft.value = null; deleting.value = ''; error.value = ''; notice.value = ''
  loading.value = true; loadFailed.value = false
  try {
    const response = await api.getLogViews()
    if (run === generation) views.value = response.views
  } catch { if (run === generation) { error.value = 'Could not load log views.'; loadFailed.value = true } }
  finally { if (run === generation) loading.value = false }
}
watch([activeTenant, () => user.value?.id], load, { immediate: true })

function edit(view?: LogView, copy = false) {
  if (!isAuthenticated.value || (view && !copy && !canEdit(view))) return
  error.value = ''; notice.value = ''; deleting.value = ''
  draft.value = view ? JSON.parse(JSON.stringify(view)) : {
    id: crypto.randomUUID(), name: '', scope: isAdmin.value ? 'tenant' : 'personal', filters: [], columns: DEFAULT_LOG_COLUMNS.map(column => ({ ...column })),
  }
  draft.value!.scope = view ? logViewScope(view) : draft.value!.scope
  if (copy) {
    draft.value!.id = crypto.randomUUID()
    draft.value!.scope = 'personal'
    draft.value!.name = `${view!.name} copy`
  }
}

function flightsExample() {
  if (!draft.value) return
  draft.value.name = 'Flights'
  draft.value.filters = [{ field: 'type', op: '=', value: 'event_data' }]
  draft.value.columns = [
    { field: 'timestamp', label: 'Time' }, { field: 'log.airline', label: 'Airline' },
    { field: 'log.flight_number', label: 'Flight number' }, { field: 'log.status', label: 'Status' },
  ]
}

function closeEditor() {
  if (saving.value) return
  draft.value = null
  error.value = ''
}

async function persist(next: LogView[], scope: LogViewScope, message: string) {
  const run = generation
  saving.value = true; error.value = ''; notice.value = ''
  try {
    const response = await api.saveLogViews(next, scope)
    if (run !== generation) return
    views.value = [...views.value.filter(view => logViewScope(view) !== scope), ...response.views.map(view => ({ ...view, scope }))]
    draft.value = null; deleting.value = ''; notice.value = message
  } catch { if (run === generation) error.value = 'Could not save log views. Your changes are still here. Try again.' }
  finally { saving.value = false }
}

function save() {
  if (!draft.value || saving.value) return
  const view: LogView = JSON.parse(JSON.stringify(draft.value))
  view.name = view.name.trim()
  view.columns = view.columns.map(column => ({ field: column.field.trim(), label: column.label.trim() }))
  view.filters = view.filters.map(filter => ({ ...filter, field: filter.field.trim() }))
  error.value = validateLogColumns(view.columns) ?? ''
  if (!view.name) error.value = 'Give this view a name.'
  const scope = logViewScope(view)
  const collection = scopeViews(scope)
  if (collection.some(item => item.id !== view.id && item.name.toLowerCase() === view.name.toLowerCase())) error.value = 'A view with this name already exists in this scope.'
  if (view.filters.some(filter => !filter.field)) error.value = 'Each base filter needs a field.'
  if (error.value) return
  const next = collection.filter(item => item.id !== view.id)
  if (next.length >= 50) { error.value = 'This scope already has 50 views in this tenant. Delete a view before adding another.'; return }
  const index = collection.findIndex(item => item.id === view.id)
  next.splice(index < 0 ? next.length : index, 0, view)
  void persist(next, scope, 'Log view saved.')
}
</script>

<template>
  <section id="panel-log-views" aria-label="Log view settings" class="log-view-settings">
    <div class="view-section-heading">
      <div class="view-tenant-controls">
        <label class="view-tenant">Tenant
          <select aria-label="Log views tenant" :value="activeTenant" :disabled="loading || saving || !!draft" @change="setTenant(($event.target as HTMLSelectElement).value)">
            <option v-if="!tenants.some(tenant => tenant.name === activeTenant)" :value="activeTenant">{{ activeTenantName }}</option>
            <option v-for="tenant in tenants" :key="tenant.id" :value="tenant.name">{{ tenant.name }}</option>
          </select>
        </label>
        <p>Shared views are available to everyone in this tenant. Personal views are visible only to you.</p>
      </div>
      <button type="button" class="btn btn-primary" :disabled="loading || saving || loadFailed || !isAuthenticated" @click="edit()">New log view</button>
    </div>
    <p v-if="error && !draft" class="view-error" role="alert">{{ error }}</p>
    <button v-if="loadFailed" type="button" class="btn btn-sm" @click="load">Retry</button>
    <p v-if="notice" class="view-notice" role="status">{{ notice }}</p>

    <DetailDrawer :open="!!draft" :label="draftIsExisting ? 'Edit log view' : 'New log view'" size="medium" @close="closeEditor">
    <form v-if="draft" class="view-editor" :aria-busy="saving" @submit.prevent="save">
      <header class="view-editor-heading">
        <h2>{{ draftIsExisting ? 'Edit log view' : 'New log view' }}</h2>
        <button type="button" class="view-editor-close" aria-label="Close log view editor" :disabled="saving" @click="closeEditor">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>
      <div class="view-editor-body">
      <p v-if="error" class="view-error" role="alert">{{ error }}</p>
      <fieldset class="view-editor-fields" :disabled="saving">
      <div class="view-example"><span class="view-hint">Tenant: {{ activeTenantName }}</span><button type="button" class="btn btn-sm" @click="flightsExample">Use flight example</button></div>
      <label class="view-name">View name<input v-model="draft.name" maxlength="80" required placeholder="Flights"></label>
      <label class="view-name">Visibility
        <select v-model="draft.scope" aria-label="View visibility" :disabled="draftIsExisting">
          <option value="personal">Only me</option>
          <option v-if="isAdmin" value="tenant">Shared with tenant</option>
        </select>
        <span class="view-hint">{{ draft.scope === 'personal' ? `Only you can see this view in ${activeTenantName}.` : `Everyone with access to ${activeTenantName} can use this view. Only admins can edit it.` }}</span>
      </label>
      <fieldset>
        <legend>Base filters</legend>
        <p>All filters below must match. The Explore search bar adds further conditions without changing this base.</p>
        <div v-for="(filter, index) in draft.filters" :key="index" class="filter-editor-row">
          <input v-model="filter.field" :aria-label="`Base filter ${index + 1} field`" placeholder="type" maxlength="128" required>
          <select v-model="filter.op" :aria-label="`Base filter ${index + 1} operator`"><option>=</option><option>!=</option><option>LIKE</option><option>NOT LIKE</option></select>
          <input v-model="filter.value" :aria-label="`Base filter ${index + 1} value`" placeholder="event_data" maxlength="512">
          <button type="button" class="btn btn-sm" :aria-label="`Remove base filter ${index + 1}`" @click="draft.filters.splice(index, 1)">Remove</button>
        </div>
        <p v-if="!draft.filters.length" class="view-hint">No base filter. This view searches all logs with your chosen columns.</p>
        <button type="button" class="btn btn-sm" :disabled="draft.filters.length >= 20" @click="draft.filters.push({ field: '', op: '=', value: '' })">Add base filter</button>
      </fieldset>
      <fieldset><legend>Columns</legend><LogColumnsEditor v-model="draft.columns" /></fieldset>
      </fieldset>
      </div>
      <footer class="view-editor-actions"><button type="button" class="btn" :disabled="saving" @click="closeEditor">Cancel</button><button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save view' }}</button></footer>
    </form>
    </DetailDrawer>

    <DataTable :loading="loading" empty-label="No saved log views. Create one to browse a dataset with its own columns.">
      <thead><tr><th>View</th><th>Visibility</th><th>Base filters</th><th>Columns</th><th class="view-actions-cell">Actions</th></tr></thead>
      <tbody>
        <tr v-if="loading"><td colspan="5" class="view-empty">Loading log views…</td></tr>
        <tr v-for="view in views" :key="logViewKey(view)">
          <td><router-link :to="{ path: '/', query: { mode: 'logs', log_view: logViewKey(view) } }">{{ view.name }}</router-link></td>
          <td><span class="view-scope" :class="{ 'view-scope-personal': logViewScope(view) === 'personal' }">{{ logViewScope(view) === 'personal' ? 'Only me' : 'Shared with tenant' }}</span></td>
          <td><span v-if="!view.filters.length" class="view-hint">All logs</span><div v-for="(filter, index) in view.filters" :key="index"><code>{{ filter.field }} {{ filter.op }} {{ filter.value }}</code></div></td>
          <td>{{ view.columns.map(column => column.label).join(' · ') }}</td>
          <td class="view-actions-cell">
            <div v-if="deleting === logViewKey(view)" class="view-delete" role="alert">
              Delete {{ view.name }}?
              <div class="view-row-actions">
                <button type="button" class="action-btn" :disabled="saving" @click="deleting = ''">Cancel</button>
                <button type="button" class="action-btn action-btn-danger" :disabled="saving" @click="persist(scopeViews(logViewScope(view)).filter(item => item.id !== view.id), logViewScope(view), 'Log view deleted.')">Confirm delete</button>
              </div>
            </div>
            <div v-else class="view-row-actions">
              <button v-if="logViewScope(view) === 'tenant' && isAuthenticated" type="button" class="action-btn" :disabled="saving" @click="edit(view, true)">Copy to my views</button>
              <button v-if="canEdit(view)" type="button" class="action-btn" :disabled="saving" @click="edit(view)">Edit</button>
              <button v-if="canEdit(view)" type="button" class="action-btn action-btn-danger" :disabled="saving" @click="deleting = logViewKey(view)">Delete</button>
            </div>
          </td>
        </tr>
        <tr v-if="!loading && !views.length"><td colspan="5" class="view-empty">No views in {{ activeTenantName }} yet. Create a personal view{{ isAdmin ? ' or share one with this tenant' : '' }}.</td></tr>
      </tbody>
    </DataTable>
  </section>
</template>

<style scoped src="../../styles/settingsRowActions.css"></style>
<style scoped>
.log-view-settings { min-width: 0; }
.view-section-heading > p { margin: 0; max-width: 640px; }
.view-section-heading { margin-bottom: var(--sp-4, 16px); }
.view-tenant-controls { display: flex; flex-direction: column; gap: var(--sp-2); }
.view-tenant-controls p { margin: 0; max-width: 640px; }
.view-tenant { display: flex; align-items: center; gap: var(--sp-2); font-size: 12px; }
.view-scope { font-size: 11px; color: var(--text-secondary); white-space: nowrap; }
.view-scope-personal { color: var(--accent); }
.view-section-heading, .view-editor-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
h2 { margin: 0; color: var(--text-primary); font-size: 14px; font-weight: 600; }
p { color: var(--text-secondary); line-height: 1.6; font-size: 12px; }
.view-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.view-editor-heading { align-items: center; padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
.view-editor-close { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--r-sm); color: var(--text-secondary); }
.view-editor-close:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.view-editor-close:disabled { opacity: .4; cursor: not-allowed; }
.view-editor-body { flex: 1; min-height: 0; overflow-y: auto; padding: var(--sp-5); }
.view-editor-fields { display: flex; flex-direction: column; gap: var(--sp-6); padding: 0; border: 0; }
.view-example { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); font-size: 12px; }
.view-name { display: grid; gap: 8px; max-width: 420px; font-size: 12px; }
input, select { min-width: 0; padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: 4px; color: var(--text-primary); background: var(--bg-surface); font: inherit; font-size: 12px; }
fieldset { min-width: 0; padding: 20px 0 0; margin: 0; border: 0; border-top: 1px solid var(--border-subtle); }
legend { font-size: 13px; font-weight: 600; padding-right: 12px; }
.filter-editor-row { display: grid; grid-template-columns: 1fr 100px 1fr auto; gap: 8px; margin-bottom: 8px; }
.view-editor-actions { display: flex; gap: 8px; align-items: center; }
.view-row-actions { display: flex; gap: var(--sp-1); align-items: center; justify-content: flex-end; white-space: nowrap; }
.log-view-settings .view-actions-cell { width: 1%; text-align: right; }
.view-editor-actions { justify-content: flex-end; flex-shrink: 0; border-top: 1px solid var(--border-subtle); padding: var(--sp-4) var(--sp-5); }
.view-error { color: var(--error); }.view-notice { color: var(--ok); }.view-hint { color: var(--text-muted); }
.view-delete { color: var(--error); font-size: 12px; }.view-delete .view-row-actions { margin-top: 8px; }
.view-empty { padding: 32px 16px; color: var(--text-secondary); }
.btn { padding: 7px 12px; border: 1px solid var(--border-default); border-radius: var(--r-sm, 4px); background: var(--bg-raised); color: var(--text-secondary); font-size: 12px; font-weight: 500; white-space: nowrap; }
.btn:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-primary); }
.btn-primary { background: var(--amber); border-color: var(--amber); color: var(--text-inverse); }
.btn-primary:hover:not(:disabled) { background: var(--amber-hover); color: var(--text-inverse); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
@media (max-width: 650px) { .view-section-heading { flex-direction: column; }.filter-editor-row { grid-template-columns: 1fr 100px; } }
</style>
