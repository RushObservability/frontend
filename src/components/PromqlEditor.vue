<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { useApi } from '../composables/useApi'
import { useTenant } from '../composables/useTenant'
import { completionContext, insertCompletion, matchCompletions } from '../lib/promqlCompletion'
import type { CompletionContext, PromqlCompletion } from '../lib/promqlCompletion'
import { metricSelector } from '../lib/promqlNames'

const props = withDefaults(defineProps<{
  modelValue: string
  rows?: number
  placeholder?: string
  inputClass?: string
  completionEnabled?: boolean
}>(), { rows: 3, placeholder: 'Enter a PromQL expression...', inputClass: '', completionEnabled: true })
const emit = defineEmits<{
  'update:modelValue': [value: string]
  keydown: [event: KeyboardEvent]
  execute: []
}>()
const api = useApi()
const { activeTenant } = useTenant()
const textarea = ref<HTMLTextAreaElement | null>(null)
const dropdown = ref<HTMLDivElement | null>(null)
const popupStyle = ref<CSSProperties>({})
const listId = `promql-${useId()}`
const items = ref<PromqlCompletion[]>([])
const selected = ref(0)
const context = ref<CompletionContext | null>(null)
const focused = ref(false)
const open = computed(() => focused.value && props.completionEnabled && items.value.length > 0)
const cache = new Map<string, Promise<string[]>>()
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
let resizeObserver: ResizeObserver | undefined

function positionDropdown() {
  if (!open.value || !textarea.value || !dropdown.value) return
  const rect = textarea.value.getBoundingClientRect()
  const margin = 8
  const below = Math.max(0, window.innerHeight - rect.bottom - margin)
  const above = Math.max(0, rect.top - margin)
  const desiredHeight = Math.min(260, dropdown.value.scrollHeight)
  const flip = below < desiredHeight && above > below
  const height = Math.min(desiredHeight, flip ? above : below)
  const width = Math.min(rect.width, window.innerWidth - 2 * margin)
  popupStyle.value = {
    left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`,
    top: `${flip ? rect.top - height - 4 : rect.bottom + 4}px`,
    width: `${width}px`,
    maxHeight: `${height}px`,
  }
}

function close() {
  generation++
  clearTimeout(timer)
  items.value = []
  context.value = null
}
function values(key: string, fetcher: () => Promise<string[]>) {
  let pending = cache.get(key)
  if (!pending) {
    pending = fetcher().catch(() => { cache.delete(key); return [] })
    cache.set(key, pending)
  }
  return pending
}
async function complete(force = false) {
  const el = textarea.value
  if (!el || !focused.value || !props.completionEnabled || el.selectionStart !== el.selectionEnd) return close()
  const query = el.value
  const cursor = el.selectionStart
  const ctx = completionContext(query, cursor)
  if (!ctx || (!force && ctx.kind === 'expression' && !ctx.prefix)) return close()
  const request = ++generation
  context.value = ctx
  selected.value = 0
  items.value = matchCompletions(ctx, [])
  const tenant = activeTenant.value
  const match = ctx.metric ? metricSelector(ctx.metric) : undefined
  const names = ctx.kind === 'expression'
    ? await values(`${tenant}:metrics`, () => api.promLabelValues('__name__'))
    : ctx.kind === 'label'
      ? await values(`${tenant}:labels:${ctx.metric || ''}`, () => api.promLabels(match))
      : await values(`${tenant}:values:${ctx.metric || ''}:${ctx.label}`, () => api.promLabelValues(ctx.label!, match))
  if (request !== generation || !focused.value || tenant !== activeTenant.value || el.value !== query || el.selectionStart !== cursor) return
  items.value = matchCompletions(ctx, names)
}
function input(event: Event) {
  close()
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  if (!(event as InputEvent).isComposing) timer = setTimeout(() => complete(), 120)
}
async function accept(item: PromqlCompletion) {
  if (!context.value || !textarea.value) return
  const result = insertCompletion(textarea.value.value, context.value, item)
  close()
  emit('update:modelValue', result.text)
  await nextTick()
  textarea.value?.focus()
  textarea.value?.setSelectionRange(result.cursor, result.cursor)
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape' && context.value) {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && props.completionEnabled) {
    event.preventDefault()
    close()
    emit('execute')
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
    event.preventDefault()
    void complete(true)
    return
  }
  if (open.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      selected.value = (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + items.value.length) % items.value.length
      void nextTick(() => document.getElementById(`${listId}-${selected.value}`)?.scrollIntoView({ block: 'nearest' }))
      return
    }
    if ((event.key === 'Enter' && !event.shiftKey) || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault()
      void accept(items.value[selected.value]!)
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
  }
  if (event.key === 'Tab' || event.key === 'Escape') close()
  emit('keydown', event)
}
function cursorMoved(event: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) void complete()
}
watch(() => props.modelValue, value => {
  if (textarea.value?.value !== value) close()
})
watch(() => props.completionEnabled, close)
watch(activeTenant, () => { cache.clear(); close() })
watch([open, items], () => { void nextTick(positionDropdown) }, { flush: 'post' })
onMounted(() => {
  window.addEventListener('resize', positionDropdown)
  window.addEventListener('scroll', positionDropdown, true)
  resizeObserver = new ResizeObserver(positionDropdown)
  if (textarea.value) resizeObserver.observe(textarea.value)
})
onBeforeUnmount(() => {
  close()
  resizeObserver?.disconnect()
  window.removeEventListener('resize', positionDropdown)
  window.removeEventListener('scroll', positionDropdown, true)
})
defineExpose({
  focus: () => textarea.value?.focus(),
  setSelectionRange: (start: number, end: number) => textarea.value?.setSelectionRange(start, end),
})
</script>

<template>
  <div class="promql-editor">
    <textarea ref="textarea" :value="modelValue" :rows="rows" :placeholder="placeholder"
      class="promql-editor-input" :class="inputClass" aria-label="Query expression"
      role="combobox" aria-autocomplete="list" aria-haspopup="listbox" :aria-expanded="open"
      :aria-controls="open ? listId : undefined" :aria-activedescendant="open ? `${listId}-${selected}` : undefined"
      autocomplete="off" autocapitalize="off" :spellcheck="false"
      @input="input" @keydown="keydown" @keyup="cursorMoved" @click="complete()"
      @focus="focused = true" @blur="focused = false; close()" @compositionend="complete()"
    ></textarea>
    <Teleport to="body">
    <div v-if="open" :id="listId" ref="dropdown" :style="popupStyle" class="promql-completions" role="listbox" aria-label="Query suggestions">
      <div v-for="(item, index) in items" :id="`${listId}-${index}`" :key="`${item.kind}:${item.text}`"
        role="option" :aria-selected="index === selected" class="promql-option" :class="{ selected: index === selected }"
        @mousedown.prevent="accept(item)" @mousemove="selected = index">
        <span class="promql-option-text">{{ item.text }}{{ item.kind === 'function' ? '()' : '' }}</span>
        <span class="promql-option-kind">{{ item.kind }}</span>
      </div>
      <div class="promql-completion-help" aria-hidden="true">↑ ↓ navigate · Tab / Enter insert · Esc close</div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.promql-editor { position: relative; width: 100%; min-width: 0; }
.promql-editor-input { display: block; width: 100%; box-sizing: border-box; resize: vertical; padding: 10px 12px; border: 1px solid var(--border-default); border-radius: var(--r-md); background: var(--bg-raised); color: var(--text-primary); font: 12px/1.6 var(--font-mono); }
.promql-editor-input:focus { outline: 2px solid var(--amber); outline-offset: -1px; }
.promql-completions { position: fixed; z-index: 600; box-sizing: border-box; max-height: 260px; overflow-y: auto; border: 1px solid var(--border-strong); border-radius: var(--r-md); background: var(--bg-raised); box-shadow: 0 6px 20px #0002; }
.promql-option { display: flex; align-items: center; gap: 16px; padding: 8px 12px; cursor: pointer; color: var(--text-primary); }
.promql-option.selected { background: var(--bg-hover); color: var(--amber); }
.promql-option-text { flex: 1; min-width: 0; overflow-wrap: anywhere; font: 12px/1.5 var(--font-mono); }
.promql-option-kind { color: var(--text-muted); font-size: 10px; flex-shrink: 0; }
.promql-completion-help { position: sticky; bottom: 0; padding: 6px 12px; background: var(--bg-raised); color: var(--text-muted); border-top: 1px solid var(--border-default); font-size: 10px; }
</style>
