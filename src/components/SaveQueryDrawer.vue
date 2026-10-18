<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SavedQuery, SavedQueryGroup, SavedQueryVisibility } from '../types'
import type { SavedQueryDraft } from '../composables/useSavedQueries'
import DetailDrawer from './DetailDrawer.vue'

export interface SaveQueryForm {
  name: string
  description: string
  visibility: SavedQueryVisibility
  groupId: string
}

const props = defineProps<{
  open: boolean
  /** The query being edited, or null to save the current Explore query. */
  editing: SavedQuery | null
  current: SavedQueryDraft
  tenant: string
  groups: SavedQueryGroup[]
  serverMode: boolean
  canShare: boolean
  /** Whether the viewer may change who can see the query (owners only). */
  canChangeVisibility: boolean
  saving: boolean
  error: string
}>()

const emit = defineEmits<{
  close: []
  submit: [form: SaveQueryForm]
}>()

const form = ref<SaveQueryForm>({ name: '', description: '', visibility: 'private', groupId: '' })

// Reset the form each time the drawer opens. New saves default to the whole
// tenant when the user is allowed to share.
watch(() => props.open, (open) => {
  if (!open) return
  const q = props.editing
  form.value = q
    ? { name: q.name, description: q.description ?? '', visibility: q.visibility ?? 'private', groupId: q.groupId ?? props.groups[0]?.id ?? '' }
    : { name: '', description: '', visibility: props.canShare ? 'tenant' : 'private', groupId: props.groups[0]?.id ?? '' }
}, { immediate: true })

const preview = computed(() => props.editing ?? props.current)
const title = computed(() => (props.editing ? 'Edit saved query' : 'Save query'))
const visibilityLocked = computed(() => !!props.editing && !props.canChangeVisibility)
const noGroups = computed(() => !props.groups.length)
// A query shared with a group the editor is not in keeps its group.
const groupOptions = computed(() => {
  const id = props.editing?.groupId
  return id && !props.groups.some(g => g.id === id) ? [...props.groups, { id, name: 'Current group' }] : props.groups
})
const valid = computed(() => !!form.value.name.trim() && (form.value.visibility !== 'group' || !!form.value.groupId))

function formatRange(minutes: number): string {
  if (!minutes) return 'Viewer’s current range'
  if (minutes % 1440 === 0) return `Last ${minutes / 1440}d`
  if (minutes % 60 === 0) return `Last ${minutes / 60}h`
  return `Last ${minutes}m`
}

function submit() {
  if (!valid.value || props.saving) return
  emit('submit', {
    ...form.value,
    name: form.value.name.trim(),
    description: form.value.description.trim(),
  })
}
</script>

<template>
  <DetailDrawer :open="open" :label="title" size="medium" @close="emit('close')">
    <form class="sqd" :aria-busy="saving" @submit.prevent="submit">
      <header class="sqd-heading">
        <h2>{{ title }}</h2>
        <button type="button" class="sqd-close" aria-label="Close" :disabled="saving" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>

      <div class="sqd-body">
        <p v-if="error" class="sqd-error" role="alert">{{ error }}</p>
        <fieldset class="sqd-fields" :disabled="saving">
          <label class="sqd-field">
            Title
            <input v-model="form.name" maxlength="120" required placeholder="Checkout 5xx by region" autofocus>
          </label>

          <label class="sqd-field">
            Description
            <textarea
              v-model="form.description"
              maxlength="1000"
              rows="4"
              placeholder="Why is this query useful? e.g. “First place to look when checkout alerts fire. Narrows to the payment provider timeouts we saw in the Oct 12 incident.”"
            />
            <span class="sqd-hint">{{ form.description.length }}/1000 · Helps teammates know when to reach for it.</span>
          </label>

          <fieldset v-if="serverMode" class="sqd-visibility">
            <legend>Who can see it</legend>
            <p v-if="visibilityLocked" class="sqd-hint">Only the owner can change who can see this query.</p>
            <label class="sqd-option" :class="{ 'sqd-option-disabled': !canShare || visibilityLocked }">
              <input v-model="form.visibility" type="radio" value="tenant" :disabled="!canShare || visibilityLocked">
              <span>
                <strong>Everyone in {{ tenant }}</strong>
                <span class="sqd-hint">Anyone with access to this tenant can find and run it.</span>
              </span>
            </label>
            <label class="sqd-option" :class="{ 'sqd-option-disabled': !canShare || noGroups || visibilityLocked }">
              <input v-model="form.visibility" type="radio" value="group" :disabled="!canShare || noGroups || visibilityLocked">
              <span class="sqd-option-main">
                <strong>A group</strong>
                <span class="sqd-hint">{{ noGroups ? 'You are not in any groups yet.' : 'Only members of the group can see it.' }}</span>
                <select
                  v-if="form.visibility === 'group'"
                  v-model="form.groupId"
                  aria-label="Group to share with"
                  :disabled="visibilityLocked"
                >
                  <option v-for="g in groupOptions" :key="g.id" :value="g.id">{{ g.name }}</option>
                </select>
              </span>
            </label>
            <label class="sqd-option" :class="{ 'sqd-option-disabled': visibilityLocked }">
              <input v-model="form.visibility" type="radio" value="private" :disabled="visibilityLocked">
              <span>
                <strong>Only me</strong>
                <span class="sqd-hint">Private to you, on any browser you sign in from.</span>
              </span>
            </label>
            <p v-if="!canShare" class="sqd-hint">Sharing needs write access. Ask an admin if you need it.</p>
          </fieldset>
          <p v-else class="sqd-hint">You are signed out, so this query is saved in this browser only.</p>

          <fieldset class="sqd-preview">
            <legend>Query</legend>
            <dl>
              <dt>Filters</dt>
              <dd>
                <span v-if="!preview.filters.length" class="sqd-hint">None</span>
                <code v-for="(f, i) in preview.filters" :key="i">{{ f.field }}{{ f.op }}{{ f.value }}</code>
              </dd>
              <template v-if="preview.search">
                <dt>Search</dt>
                <dd><code>{{ preview.search }}</code></dd>
              </template>
              <template v-if="preview.groupBy">
                <dt>Group by</dt>
                <dd><code>{{ preview.groupBy }}</code></dd>
              </template>
              <dt>Time range</dt>
              <dd>{{ formatRange(preview.timePreset) }}</dd>
              <template v-if="preview.viewMode">
                <dt>View</dt>
                <dd>{{ preview.viewMode === 'logs' ? 'Logs' : 'Spans' }}</dd>
              </template>
            </dl>
            <p v-if="editing" class="sqd-hint">To change the query itself, load it, adjust it in Explore, and save it again.</p>
          </fieldset>
        </fieldset>
      </div>

      <footer class="sqd-actions">
        <button type="button" class="btn" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving || !valid">
          {{ saving ? 'Saving…' : editing ? 'Save changes' : 'Save query' }}
        </button>
      </footer>
    </form>
  </DetailDrawer>
</template>

<style scoped>
.sqd { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.sqd-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
h2 { margin: 0; color: var(--text-primary); font-size: 14px; font-weight: 600; }
.sqd-close { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--r-sm); color: var(--text-secondary); }
.sqd-close:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.sqd-close:disabled { opacity: .4; cursor: not-allowed; }
.sqd-body { flex: 1; min-height: 0; overflow-y: auto; padding: var(--sp-5); }
.sqd-fields { display: flex; flex-direction: column; gap: var(--sp-5); padding: 0; margin: 0; border: 0; min-width: 0; }
.sqd-field { display: grid; gap: 8px; font-size: 12px; }
input, select, textarea { min-width: 0; padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: 4px; color: var(--text-primary); background: var(--bg-surface); font: inherit; font-size: 12px; }
input:focus, select:focus, textarea:focus { border-color: var(--accent); outline: none; }
textarea { resize: vertical; min-height: 84px; line-height: 1.5; }
fieldset fieldset { min-width: 0; padding: 20px 0 0; margin: 0; border: 0; border-top: 1px solid var(--border-subtle); }
legend { font-size: 13px; font-weight: 600; padding-right: 12px; color: var(--text-primary); }
.sqd-visibility { display: flex; flex-direction: column; gap: 8px; }
.sqd-option { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: var(--r-sm); cursor: pointer; font-size: 12px; }
.sqd-option:has(input:checked) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.sqd-option input[type="radio"] { margin-top: 2px; padding: 0; }
.sqd-option > span { display: grid; gap: 2px; min-width: 0; }
.sqd-option-main select { margin-top: 6px; max-width: 320px; }
.sqd-option-disabled { opacity: .55; cursor: not-allowed; }
.sqd-preview dl { display: grid; grid-template-columns: 90px 1fr; gap: 8px 12px; margin: 0; font-size: 12px; }
.sqd-preview dt { color: var(--text-muted); }
.sqd-preview dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.sqd-preview code { padding: 1px 6px; border-radius: 3px; background: var(--bg-surface); border: 1px solid var(--border-subtle); font-size: 11px; overflow-wrap: anywhere; }
.sqd-preview > p { margin: 12px 0 0; }
.sqd-actions { display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; border-top: 1px solid var(--border-subtle); padding: var(--sp-4) var(--sp-5); }
.sqd-hint { color: var(--text-muted); font-size: 11px; }
.sqd-error { color: var(--error); margin: 0 0 var(--sp-4); font-size: 12px; }
</style>
