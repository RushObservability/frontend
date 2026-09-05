<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import type { AlertRoute, AlertRouteInput, NotificationChannel } from '../types'
import DeleteConfirmationModal from './DeleteConfirmationModal.vue'

const props = defineProps<{
  channels: NotificationChannel[]
}>()

interface MatcherDraft {
  key: string
  value: string
}

interface RouteDraft {
  name: string
  enabled: boolean
  priorities: number[]
  matchers: MatcherDraft[]
  channelIds: string[]
}

const api = useApi()
const { canWrite } = useAuth()
const routes = ref<AlertRoute[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const editorOpen = ref(false)
const editingId = ref<string | null>(null)
const pendingDelete = ref<AlertRoute | null>(null)
const deleting = ref(false)
const deleteError = ref('')
const draft = ref<RouteDraft>(newDraft())

function newDraft(): RouteDraft {
  return {
    name: '',
    enabled: true,
    priorities: [],
    matchers: [],
    channelIds: [],
  }
}

async function loadRoutes() {
  loading.value = true
  error.value = ''
  try {
    routes.value = (await api.listAlertRoutes()).routes
  } catch (cause: any) {
    error.value = cause?.message || 'Could not load alert routes.'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  draft.value = newDraft()
  error.value = ''
  editorOpen.value = true
}

function openEdit(route: AlertRoute) {
  editingId.value = route.id
  draft.value = {
    name: route.name,
    enabled: route.enabled,
    priorities: [...route.priorities],
    matchers: Object.entries(route.tag_matchers).map(([key, value]) => ({ key, value })),
    channelIds: [...route.channel_ids],
  }
  error.value = ''
  editorOpen.value = true
}

function closeEditor() {
  if (saving.value) return
  editorOpen.value = false
  editingId.value = null
  draft.value = newDraft()
  error.value = ''
}

function togglePriority(priority: number) {
  const selected = draft.value.priorities
  draft.value.priorities = selected.includes(priority)
    ? selected.filter(value => value !== priority)
    : [...selected, priority].sort()
}

function toggleChannel(channelId: string) {
  const selected = draft.value.channelIds
  draft.value.channelIds = selected.includes(channelId)
    ? selected.filter(value => value !== channelId)
    : [...selected, channelId]
}

function addMatcher() {
  draft.value.matchers.push({ key: '', value: '' })
}

function removeMatcher(index: number) {
  draft.value.matchers.splice(index, 1)
}

const formReady = computed(() => {
  return draft.value.name.trim().length > 0
    && draft.value.channelIds.length > 0
    && draft.value.matchers.every(matcher => matcher.key.trim() && matcher.value.trim())
})

function routeInput(): AlertRouteInput {
  const tagMatchers = Object.fromEntries(
    draft.value.matchers.map(matcher => [matcher.key.trim(), matcher.value.trim()]),
  )
  return {
    name: draft.value.name.trim(),
    enabled: draft.value.enabled,
    priorities: [...new Set(draft.value.priorities)].sort(),
    tag_matchers: tagMatchers,
    channel_ids: [...new Set(draft.value.channelIds)],
  }
}

async function saveRoute() {
  if (!formReady.value || saving.value) return
  saving.value = true
  error.value = ''
  let saved = false
  try {
    const input = routeInput()
    if (editingId.value) await api.updateAlertRoute(editingId.value, input)
    else await api.createAlertRoute(input)
    await loadRoutes()
    saved = true
  } catch (cause: any) {
    error.value = cause?.message || 'Could not save this route.'
  } finally {
    saving.value = false
  }
  if (saved) closeEditor()
}

async function toggleRoute(route: AlertRoute) {
  const previous = route.enabled
  route.enabled = !previous
  try {
    await api.updateAlertRoute(route.id, {
      name: route.name,
      enabled: route.enabled,
      priorities: route.priorities,
      tag_matchers: route.tag_matchers,
      channel_ids: route.channel_ids,
    })
  } catch (cause: any) {
    route.enabled = previous
    error.value = cause?.message || 'Could not update this route.'
  }
}

function askDelete(route: AlertRoute) {
  pendingDelete.value = route
  deleteError.value = ''
}

async function confirmDelete() {
  if (!pendingDelete.value || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await api.deleteAlertRoute(pendingDelete.value.id)
    routes.value = routes.value.filter(route => route.id !== pendingDelete.value?.id)
    pendingDelete.value = null
  } catch (cause: any) {
    deleteError.value = cause?.message || 'Could not delete this route.'
  } finally {
    deleting.value = false
  }
}

function channelName(id: string): string {
  return props.channels.find(channel => channel.id === id)?.name || 'Deleted channel'
}

function prioritySummary(route: AlertRoute): string {
  return route.priorities.length
    ? route.priorities.map(priority => `P${priority}`).join(' or ')
    : 'Any priority'
}

function tagSummary(route: AlertRoute): string[] {
  return Object.entries(route.tag_matchers).map(([key, value]) => `${key}:${value}`)
}

onMounted(loadRoutes)
</script>

<template>
  <section class="routing-section" aria-labelledby="alert-routing-title">
    <div class="routing-head">
      <div>
        <div class="routing-eyebrow">Additive matching</div>
        <h2 id="alert-routing-title">Routing rules</h2>
        <p>Rush sends to every matching route. Channels selected directly on an alert are included too.</p>
      </div>
      <button v-if="canWrite && !editorOpen" type="button" class="routing-add" @click="openCreate">
        Add route
      </button>
    </div>

    <div class="routing-flow" aria-label="How alert routing works">
      <span>Alert fires</span>
      <i aria-hidden="true">+</i>
      <span>Direct channels</span>
      <i aria-hidden="true">+</i>
      <span>Every matching route</span>
      <b aria-hidden="true">→</b>
      <strong>One delivery per channel</strong>
    </div>

    <form v-if="editorOpen" class="route-editor" @submit.prevent="saveRoute">
      <div class="editor-heading">
        <div>
          <span>{{ editingId ? 'Edit route' : 'New route' }}</span>
          <p>Conditions inside this route use AND. Selecting P1 and P2 means either priority can match.</p>
        </div>
        <label class="route-enabled">
          <input v-model="draft.enabled" type="checkbox" />
          Enabled
        </label>
      </div>

      <label class="route-field route-name">
        <span>Name</span>
        <input v-model="draft.name" type="text" maxlength="255" placeholder="DevOps urgent alerts" autofocus />
      </label>

      <fieldset class="route-field">
        <legend>Priority</legend>
        <p>No selection matches any priority, including alerts without one.</p>
        <div class="priority-picker">
          <button
            v-for="priority in [1, 2, 3, 4, 5]"
            :key="priority"
            type="button"
            :class="{ selected: draft.priorities.includes(priority) }"
            :aria-pressed="draft.priorities.includes(priority)"
            @click="togglePriority(priority)"
          >P{{ priority }}</button>
        </div>
      </fieldset>

      <fieldset class="route-field">
        <div class="field-heading">
          <div>
            <span class="field-legend">Tag matches</span>
            <p>All tag rows must match. Alert tags use <code>key:value</code>, such as <code>team:devops</code>.</p>
          </div>
          <button type="button" class="text-action" @click="addMatcher">Add tag</button>
        </div>
        <div v-if="draft.matchers.length" class="matcher-list">
          <div v-for="(matcher, index) in draft.matchers" :key="index" class="matcher-row">
            <input v-model="matcher.key" aria-label="Tag key" placeholder="team" />
            <span>=</span>
            <input v-model="matcher.value" aria-label="Tag value" placeholder="devops" />
            <button type="button" aria-label="Remove tag matcher" @click="removeMatcher(index)">×</button>
          </div>
        </div>
        <div v-else class="any-match">No tag filter. Priority is the only condition.</div>
      </fieldset>

      <fieldset class="route-field">
        <legend>Send to</legend>
        <p>Select one or more notification channels.</p>
        <div v-if="channels.length" class="channel-picker">
          <label v-for="channel in channels" :key="channel.id" :class="{ selected: draft.channelIds.includes(channel.id), disabled: !channel.enabled }">
            <input
              type="checkbox"
              :checked="draft.channelIds.includes(channel.id)"
              @change="toggleChannel(channel.id)"
            />
            <span class="channel-mark" aria-hidden="true"></span>
            <span>
              <strong>{{ channel.name }}</strong>
              <small>{{ channel.channel_type.replace('_', ' ') }}{{ channel.enabled ? '' : ' · disabled' }}</small>
            </span>
          </label>
        </div>
        <p v-else class="route-error">Add a notification channel above before creating a route.</p>
      </fieldset>

      <p v-if="error" class="route-error" role="alert">{{ error }}</p>
      <div class="editor-actions">
        <button type="button" class="route-cancel" :disabled="saving" @click="closeEditor">Cancel</button>
        <button type="submit" class="route-save" :disabled="!formReady || saving">
          {{ saving ? 'Saving…' : editingId ? 'Save route' : 'Create route' }}
        </button>
      </div>
    </form>

    <p v-if="error && !editorOpen" class="route-error standalone" role="alert">{{ error }}</p>
    <div v-if="loading" class="route-empty">Loading routing rules…</div>
    <div v-else-if="routes.length === 0 && !editorOpen" class="route-empty">
      <strong>No routing rules yet</strong>
      <span>For your example, create “All P1s” for webhook 1, then “DevOps P1/P2” with <code>team:devops</code> for webhook 2.</span>
    </div>
    <div v-else-if="routes.length" class="route-table">
      <div class="route-table-head">
        <span>Route</span><span>Matches</span><span>Sends to</span><span>Status</span><span></span>
      </div>
      <div v-for="route in routes" :key="route.id" class="route-row" :class="{ muted: !route.enabled }">
        <div class="route-identity">
          <strong>{{ route.name }}</strong>
          <small>All conditions must match</small>
        </div>
        <div class="route-conditions">
          <span class="priority-token">{{ prioritySummary(route) }}</span>
          <template v-for="tag in tagSummary(route)" :key="tag">
            <b>AND</b><code>{{ tag }}</code>
          </template>
        </div>
        <div class="route-destinations">
          <span v-for="channelId in route.channel_ids" :key="channelId">{{ channelName(channelId) }}</span>
        </div>
        <label class="route-switch">
          <input type="checkbox" :checked="route.enabled" :disabled="!canWrite" @change="toggleRoute(route)" />
          <span aria-hidden="true"></span>
          <small>{{ route.enabled ? 'On' : 'Off' }}</small>
        </label>
        <div v-if="canWrite" class="route-actions">
          <button type="button" @click="openEdit(route)">Edit</button>
          <button type="button" class="danger" @click="askDelete(route)">Delete</button>
        </div>
      </div>
    </div>

    <DeleteConfirmationModal
      :open="!!pendingDelete"
      title="Delete routing rule?"
      :description="pendingDelete ? `Alerts will stop routing through “${pendingDelete.name}”. Direct channels and other matching routes are unchanged.` : ''"
      confirm-label="Delete route"
      :busy="deleting"
      :error="deleteError"
      @cancel="pendingDelete = null"
      @confirm="confirmDelete"
    />
  </section>
</template>

<style scoped>
.routing-section { padding: 28px 24px 24px; border-top: 1px solid var(--border-subtle); }
.routing-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.routing-eyebrow { margin-bottom: 5px; color: var(--accent); font-size: 10px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
.routing-head h2 { margin: 0; color: var(--text-primary); font: 650 17px/1.25 var(--font-ui); }
.routing-head p { max-width: 650px; margin: 6px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.55; }
.routing-add, .route-save { min-height: 34px; padding: 0 14px; color: var(--text-inverse); background: var(--accent); border: 1px solid var(--accent); border-radius: 6px; font: 650 12px var(--font-ui); }
.routing-add:hover, .route-save:hover:not(:disabled) { filter: brightness(1.06); }
.routing-flow { display: flex; align-items: center; gap: 9px; margin-top: 20px; padding: 11px 13px; overflow-x: auto; color: var(--text-secondary); background: var(--bg-subtle); border: 1px solid var(--border-subtle); border-radius: 7px; font-size: 11px; white-space: nowrap; }
.routing-flow span { color: var(--text-primary); }
.routing-flow i { color: var(--text-muted); font-style: normal; }
.routing-flow b { color: var(--accent); font-size: 15px; }
.routing-flow strong { color: var(--text-primary); font-weight: 650; }
.route-editor { display: grid; grid-template-columns: minmax(220px, .7fr) minmax(300px, 1.3fr); gap: 22px 28px; margin-top: 18px; padding: 22px; background: var(--bg-subtle); border: 1px solid var(--border-default); border-radius: 8px; }
.editor-heading { display: flex; grid-column: 1 / -1; align-items: flex-start; justify-content: space-between; gap: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-subtle); }
.editor-heading span { color: var(--text-primary); font-size: 14px; font-weight: 700; }
.editor-heading p, .route-field > p, .field-heading p { margin: 4px 0 0; color: var(--text-muted); font-size: 11px; line-height: 1.5; }
.route-enabled { display: flex; align-items: center; gap: 7px; color: var(--text-secondary); font-size: 12px; }
.route-field { display: grid; align-content: start; gap: 9px; min-width: 0; margin: 0; padding: 0; border: 0; }
.route-field > span, .route-field legend, .field-legend { padding: 0; color: var(--text-primary); font-size: 11px; font-weight: 700; letter-spacing: .03em; }
.route-name input, .matcher-row input { width: 100%; min-height: 36px; padding: 0 10px; color: var(--text-primary); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 5px; font: 12px var(--font-ui); }
.route-name input:focus, .matcher-row input:focus { border-color: var(--accent); outline: 2px solid var(--focus-ring); outline-offset: 1px; }
.priority-picker { display: flex; gap: 6px; }
.priority-picker button { min-width: 40px; min-height: 33px; color: var(--text-secondary); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 5px; font: 700 11px var(--font-ui); }
.priority-picker button.selected { color: var(--accent); background: var(--accent-soft); border-color: var(--accent); }
.field-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.text-action { padding: 2px 0; color: var(--accent); background: none; border: 0; font: 650 11px var(--font-ui); }
.matcher-list { display: grid; gap: 7px; }
.matcher-row { display: grid; grid-template-columns: minmax(0, 1fr) 14px minmax(0, 1fr) 26px; align-items: center; gap: 6px; }
.matcher-row > span { color: var(--text-muted); text-align: center; }
.matcher-row > button { height: 28px; padding: 0; color: var(--text-muted); background: transparent; border: 0; font-size: 18px; }
.matcher-row > button:hover { color: var(--error); }
.any-match { min-height: 36px; padding: 10px; color: var(--text-muted); border: 1px dashed var(--border-default); border-radius: 5px; font-size: 11px; }
.channel-picker { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 7px; }
.channel-picker label { display: grid; grid-template-columns: 15px minmax(0, 1fr); align-items: center; gap: 9px; min-height: 48px; padding: 8px 10px; background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 6px; cursor: pointer; }
.channel-picker label.selected { background: var(--accent-soft); border-color: var(--accent); }
.channel-picker label.disabled { opacity: .55; }
.channel-picker input { position: absolute; opacity: 0; pointer-events: none; }
.channel-mark { width: 14px; height: 14px; border: 1px solid var(--border-strong); border-radius: 3px; }
.channel-picker label.selected .channel-mark { background: var(--accent); border-color: var(--accent); box-shadow: inset 0 0 0 3px var(--accent-soft); }
.channel-picker strong, .channel-picker small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.channel-picker strong { color: var(--text-primary); font-size: 11px; font-weight: 650; }
.channel-picker small { margin-top: 2px; color: var(--text-muted); font-size: 10px; text-transform: capitalize; }
.editor-actions { display: flex; grid-column: 1 / -1; justify-content: flex-end; gap: 8px; padding-top: 2px; }
.route-cancel { min-height: 34px; padding: 0 14px; color: var(--text-secondary); background: transparent; border: 1px solid var(--border-default); border-radius: 6px; font: 600 12px var(--font-ui); }
.route-save:disabled, .route-cancel:disabled { cursor: not-allowed; opacity: .5; }
.route-error { margin: 0; color: var(--error); font-size: 11px; }
.route-error.standalone { margin-top: 14px; }
.route-empty { display: grid; gap: 5px; margin-top: 18px; padding: 28px 16px; color: var(--text-muted); border: 1px dashed var(--border-default); border-radius: 7px; font-size: 11px; text-align: center; }
.route-empty strong { color: var(--text-primary); font-size: 12px; }
.route-table { margin-top: 18px; border: 1px solid var(--border-subtle); border-radius: 7px; overflow: hidden; }
.route-table-head, .route-row { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(230px, 1.5fr) minmax(150px, 1fr) 72px 112px; align-items: center; column-gap: 14px; }
.route-table-head { min-height: 32px; padding: 0 12px; color: var(--text-muted); background: var(--bg-subtle); border-bottom: 1px solid var(--border-subtle); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.route-row { min-height: 66px; padding: 9px 12px; background: var(--bg-surface); border-bottom: 1px solid var(--border-subtle); }
.route-row:last-child { border-bottom: 0; }
.route-row.muted > div:not(.route-actions), .route-row.muted .route-switch { opacity: .55; }
.route-identity strong, .route-identity small { display: block; }
.route-identity strong { color: var(--text-primary); font-size: 12px; font-weight: 650; }
.route-identity small { margin-top: 3px; color: var(--text-muted); font-size: 10px; }
.route-conditions { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.route-conditions span, .route-conditions code, .route-destinations span { padding: 3px 6px; color: var(--text-secondary); background: var(--bg-subtle); border: 1px solid var(--border-subtle); border-radius: 4px; font: 10px/1.2 var(--font-ui); }
.route-conditions .priority-token { color: var(--text-primary); font-weight: 650; }
.route-conditions b { color: var(--text-muted); font-size: 8px; letter-spacing: .06em; }
.route-destinations { display: flex; flex-wrap: wrap; gap: 5px; }
.route-destinations span { color: var(--accent); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 24%, transparent); }
.route-switch { display: grid; grid-template-columns: 28px auto; align-items: center; gap: 6px; cursor: pointer; }
.route-switch input { position: absolute; opacity: 0; }
.route-switch > span { position: relative; width: 28px; height: 16px; background: var(--border-strong); border-radius: 999px; transition: background 140ms ease; }
.route-switch > span::after { position: absolute; top: 3px; left: 3px; width: 10px; height: 10px; background: var(--bg-surface); border-radius: 50%; content: ''; transition: transform 140ms ease; }
.route-switch input:checked + span { background: var(--accent); }
.route-switch input:checked + span::after { transform: translateX(12px); }
.route-switch small { color: var(--text-muted); font-size: 10px; }
.route-actions { display: flex; justify-content: flex-end; gap: 4px; }
.route-actions button { padding: 5px 7px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 4px; font: 600 10px var(--font-ui); }
.route-actions button:hover { color: var(--text-primary); background: var(--bg-hover); }
.route-actions button.danger:hover { color: var(--error); }
code { font-family: var(--font-mono); }

@media (max-width: 980px) {
  .route-editor { grid-template-columns: 1fr; }
  .route-editor > * { grid-column: 1; }
  .route-table-head { display: none; }
  .route-row { grid-template-columns: 1fr auto; gap: 12px 18px; }
  .route-conditions, .route-destinations { grid-column: 1 / -1; }
  .route-switch { grid-column: 1; }
  .route-actions { grid-column: 2; grid-row: 1; }
}

@media (max-width: 620px) {
  .routing-section { padding: 22px 16px; }
  .routing-head { align-items: stretch; flex-direction: column; }
  .routing-add { align-self: flex-start; }
  .route-editor { padding: 16px; }
  .editor-heading { flex-direction: column; }
}
</style>
