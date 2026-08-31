<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useApi } from '../composables/useApi'
import type { CustomSkill } from '../types'

const KNOWN_TOOLS = [
  'search_logs',
  'query_traces',
  'get_trace',
  'query_metrics',
  'list_services',
  'service_dependencies',
  'list_deploys',
  'get_anomaly_context',
  'get_argocd_app',
  'kube_describe',
  'kube_events',
  'load_skill',
] as const

const NAME_PATTERN = /^[a-z0-9_]{1,64}$/
const MAX_TITLE = 128
const MAX_DESCRIPTION = 1024
const MAX_CONTENT = 25000

const CONTENT_TEMPLATE = `# Your Skill Title

## Quick Assessment
1. First thing to check
2. Second thing

## Root Cause Patterns
### Pattern: Name
-> What to do

## Key Queries
- tool_name with args
`

interface Props {
  open: boolean
  skill?: CustomSkill
  template?: { title: string; description: string; content: string }
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  saved: [skill: CustomSkill]
}>()

const api = useApi()

const name = ref('')
const title = ref('')
const description = ref('')
const content = ref('')
const allowedTools = ref<string[]>([...KNOWN_TOOLS])
const enabled = ref(true)

const saving = ref(false)
const errorMsg = ref('')

const isEdit = computed(() => !!props.skill)

function resetForm() {
  errorMsg.value = ''
  saving.value = false
  if (props.skill) {
    name.value = props.skill.name
    title.value = props.skill.title
    description.value = props.skill.description
    content.value = props.skill.content
    allowedTools.value = [...(props.skill.allowed_tools || [])]
    enabled.value = props.skill.enabled
  } else if (props.template) {
    name.value = ''
    title.value = props.template.title
    description.value = props.template.description
    content.value = props.template.content
    allowedTools.value = [...KNOWN_TOOLS]
    enabled.value = true
  } else {
    name.value = ''
    title.value = ''
    description.value = ''
    content.value = CONTENT_TEMPLATE
    allowedTools.value = [...KNOWN_TOOLS]
    enabled.value = true
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) resetForm()
  },
  { immediate: true }
)

const nameValid = computed(() => {
  if (isEdit.value) return true
  return NAME_PATTERN.test(name.value)
})
const titleValid = computed(() => title.value.trim().length > 0 && title.value.length <= MAX_TITLE)
const descriptionValid = computed(
  () => description.value.trim().length > 0 && description.value.length <= MAX_DESCRIPTION
)
const contentValid = computed(() => content.value.trim().length > 0 && content.value.length <= MAX_CONTENT)

const canSave = computed(
  () =>
    !saving.value &&
    nameValid.value &&
    titleValid.value &&
    descriptionValid.value &&
    contentValid.value
)

function toggleTool(tool: string) {
  const idx = allowedTools.value.indexOf(tool)
  if (idx >= 0) {
    allowedTools.value.splice(idx, 1)
  } else {
    allowedTools.value.push(tool)
  }
}

function toolChecked(tool: string): boolean {
  return allowedTools.value.includes(tool)
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  errorMsg.value = ''
  try {
    let saved: CustomSkill
    if (props.skill) {
      saved = await api.updateCustomSkill(props.skill.id, {
        title: title.value.trim(),
        description: description.value.trim(),
        content: content.value,
        allowed_tools: allowedTools.value,
        enabled: enabled.value,
      })
    } else {
      saved = await api.createCustomSkill({
        name: name.value.trim(),
        title: title.value.trim(),
        description: description.value.trim(),
        content: content.value,
        allowed_tools: allowedTools.value,
        enabled: enabled.value,
      })
    }
    emit('saved', saved)
  } catch (e: any) {
    // Try to pull a clean message out of "<status>: <body>"
    const raw = e?.message || 'Failed to save skill'
    const match = /^\d+:\s*(.*)$/s.exec(raw)
    errorMsg.value = match ? match[1] : raw
  } finally {
    saving.value = false
  }
}

function cancel() {
  if (saving.value) return
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="skill-dialog-overlay" @click.self="cancel">
      <div class="skill-dialog">
        <div class="skill-dialog-header">
          <h2 class="skill-dialog-title">{{ isEdit ? 'Edit custom skill' : 'New custom skill' }}</h2>
          <button class="skill-dialog-close" @click="cancel" :disabled="saving">&times;</button>
        </div>

        <div v-if="errorMsg" class="skill-dialog-error">{{ errorMsg }}</div>

        <div class="skill-dialog-body">
          <!-- Name -->
          <div class="field">
            <label class="field-label">
              Name
              <span class="field-hint">lowercase letters, digits, underscores — immutable once created</span>
            </label>
            <input
              v-model="name"
              class="field-input mono"
              :class="{ invalid: !isEdit && name.length > 0 && !nameValid }"
              placeholder="my_service_crash"
              :disabled="isEdit || saving"
              maxlength="64"
            />
            <div v-if="!isEdit && name.length > 0 && !nameValid" class="field-error">
              Name must match [a-z0-9_]{1,64}
            </div>
          </div>

          <!-- Title -->
          <div class="field">
            <label class="field-label">
              Title
              <span class="field-counter">{{ title.length }}/{{ MAX_TITLE }}</span>
            </label>
            <input
              v-model="title"
              class="field-input"
              placeholder="e.g. My service crash investigation"
              :maxlength="MAX_TITLE"
              :disabled="saving"
            />
          </div>

          <!-- Description -->
          <div class="field">
            <label class="field-label">
              Description
              <span class="field-counter">{{ description.length }}/{{ MAX_DESCRIPTION }}</span>
            </label>
            <div class="field-hint">
              Third person, what it does and when to use it. The agent picks skills based on this.
            </div>
            <textarea
              v-model="description"
              class="field-textarea"
              rows="3"
              :maxlength="MAX_DESCRIPTION"
              placeholder="Playbook for diagnosing service crashes — used when containers are restarting or OOMKilled."
              :disabled="saving"
            ></textarea>
          </div>

          <!-- Content -->
          <div class="field">
            <label class="field-label">
              Playbook content (markdown)
              <span class="field-counter">{{ content.length }}/{{ MAX_CONTENT }}</span>
            </label>
            <textarea
              v-model="content"
              class="field-textarea mono content-textarea"
              rows="14"
              :maxlength="MAX_CONTENT"
              :disabled="saving"
            ></textarea>
          </div>

          <!-- Allowed tools -->
          <div class="field">
            <label class="field-label">Allowed tools</label>
            <div class="field-hint">Tools the agent may call while running this skill.</div>
            <div class="tool-grid">
              <label v-for="tool in KNOWN_TOOLS" :key="tool" class="tool-item">
                <input
                  type="checkbox"
                  :checked="toolChecked(tool)"
                  @change="toggleTool(tool)"
                  :disabled="saving"
                />
                <span class="mono">{{ tool }}</span>
              </label>
            </div>
          </div>

          <!-- Enabled toggle -->
          <div class="field field-row">
            <div>
              <div class="field-label">Enabled</div>
              <div class="field-hint">Disabled skills are hidden from the agent.</div>
            </div>
            <label class="sk-toggle">
              <input type="checkbox" v-model="enabled" :disabled="saving" />
              <span class="sk-toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="skill-dialog-footer">
          <button class="btn btn-secondary" @click="cancel" :disabled="saving">Cancel</button>
          <button class="btn btn-primary" @click="save" :disabled="!canSave">
            {{ saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create skill' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.skill-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(6, 7, 16, 0.72);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  z-index: 1100;
  padding: 5vh var(--sp-4);
  overflow-y: auto;
}

.skill-dialog {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--r-lg);
  width: 720px;
  max-width: 100%;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}

.skill-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-4);
  border-bottom: 1px solid var(--border-subtle);
}
.skill-dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.skill-dialog-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0 var(--sp-2);
}
.skill-dialog-close:hover:not(:disabled) {
  color: var(--text-primary);
}

.skill-dialog-error {
  margin: var(--sp-3) var(--sp-4) 0;
  padding: var(--sp-2) var(--sp-3);
  background: var(--error-dim);
  border: 1px solid var(--error);
  border-radius: var(--r-sm);
  color: var(--error);
  font-size: 12px;
}

.skill-dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.skill-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-raised);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.field-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
}
.field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.field-hint {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  line-height: 1.4;
}
.field-counter {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 400;
  font-family: var(--font-mono);
}
.field-error {
  font-size: 11px;
  color: var(--error);
  margin-top: 2px;
}

.field-input,
.field-textarea {
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  font-size: 12px;
  color: var(--text-primary);
  font-family: inherit;
  box-sizing: border-box;
}
.field-input.mono,
.field-textarea.mono {
  font-family: var(--font-mono);
}
.field-input:focus,
.field-textarea:focus {
  outline: none;
  border-color: var(--amber);
  box-shadow: 0 0 0 1px var(--amber-glow);
}
.field-input:disabled,
.field-textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.field-input.invalid {
  border-color: var(--error);
}

.field-textarea {
  resize: vertical;
  line-height: 1.5;
}
.content-textarea {
  font-size: 12px;
  min-height: 260px;
}

/* Tools checklist */
.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--sp-1) var(--sp-3);
  padding: var(--sp-2);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
}
.tool-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 3px var(--sp-1);
  border-radius: var(--r-sm);
}
.tool-item:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.tool-item input[type='checkbox'] {
  accent-color: var(--amber);
}

/* Toggle (self-contained so scoped styles can't clash) */
.sk-toggle {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}
.sk-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}
.sk-toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--bg-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--r-pill);
  transition: background 0.2s, border-color 0.2s;
}
.sk-toggle-slider::before {
  content: '';
  position: absolute;
  height: 14px;
  width: 14px;
  left: 2px;
  bottom: 2px;
  background: var(--text-muted);
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}
.sk-toggle input:checked + .sk-toggle-slider {
  background: var(--amber-dim);
  border-color: var(--amber);
}
.sk-toggle input:checked + .sk-toggle-slider::before {
  transform: translateX(16px);
  background: var(--amber);
}

/* Buttons */
.btn {
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--r-sm);
  font-size: 12px;
  font-weight: 500;
  border: none;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-secondary {
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}
.btn-secondary:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text-primary);
}
.btn-primary {
  background: var(--amber);
  color: var(--text-inverse);
}
.btn-primary:hover:not(:disabled) {
  background: var(--amber-hover);
}
</style>
