<script setup lang="ts">
import { ref, watch, nextTick, computed, useId } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  mono?: boolean
  fetchSuggestions?: (prefix: string) => Promise<string[]>
  options?: readonly string[]
  emptyOption?: string
  debounceMs?: number
}>(), {
  placeholder: '',
  mono: false,
  debounceMs: 200,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'select', value: string): void
}>()

const dropdownRef = ref<HTMLDivElement | null>(null)
const suggestions = ref<string[]>([])
const showDropdown = ref(false)
const activeIndex = ref(-1)
const loading = ref(false)
const focused = ref(false)
const dismissed = ref(false)
const typed = ref(false)
const listId = useId()
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const items = computed(() => {
  if (!props.options) return suggestions.value
  const query = typed.value ? props.modelValue.trim().toLowerCase() : ''
  const matches = query ? props.options.filter(value => value.toLowerCase().includes(query)) : props.options
  const offerEmpty = props.emptyOption && props.emptyOption.toLowerCase().includes(query)
  return (offerEmpty ? ['', ...matches] : matches).slice(0, 50)
})
const expanded = computed(() => props.options
  ? focused.value && !dismissed.value && items.value.length > 0
  : showDropdown.value)

const inputClasses = computed(() => ({
  'ac-input': true,
  'ac-input-mono': props.mono,
}))

function onInput(ev: Event) {
  const val = (ev.target as HTMLInputElement).value
  emit('update:modelValue', val)
  activeIndex.value = -1
  if (props.options) {
    dismissed.value = false
    typed.value = true
    return
  }
  scheduleFetch(val)
}

function scheduleFetch(val: string) {
  if (debounceTimer) clearTimeout(debounceTimer)
  const fetch = props.fetchSuggestions
  if (!val.trim() || !fetch) {
    suggestions.value = []
    showDropdown.value = false
    return
  }
  debounceTimer = setTimeout(async () => {
    loading.value = true
    try {
      const results = await fetch(val)
      suggestions.value = results
      showDropdown.value = results.length > 0
    } catch {
      suggestions.value = []
      showDropdown.value = false
    } finally {
      loading.value = false
    }
  }, props.debounceMs)
}

function openChoices() {
  dismissed.value = false
  typed.value = false
  activeIndex.value = -1
}

function onFocus() {
  focused.value = true
  openChoices()
  if (suggestions.value.length > 0 && props.modelValue.trim()) {
    showDropdown.value = true
  }
}

function onBlur() {
  focused.value = false
  activeIndex.value = -1
  // Delay to allow click on dropdown items
  setTimeout(() => {
    showDropdown.value = false
  }, 180)
}

function selectItem(item: string) {
  emit('update:modelValue', item)
  emit('select', item)
  showDropdown.value = false
  dismissed.value = true
  activeIndex.value = -1
}

function onKeydown(ev: KeyboardEvent) {
  if (!expanded.value && props.options && ev.key === 'ArrowDown') {
    openChoices()
  }
  if (!expanded.value) return

  if (ev.key === 'ArrowDown') {
    ev.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, items.value.length - 1)
    scrollActive()
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
    scrollActive()
  } else if (ev.key === 'Enter' && activeIndex.value >= 0) {
    ev.preventDefault()
    const item = items.value[activeIndex.value]
    if (item !== undefined) selectItem(item)
  } else if (ev.key === 'Escape') {
    ev.preventDefault()
    showDropdown.value = false
    dismissed.value = true
    activeIndex.value = -1
  }
}

function scrollActive() {
  nextTick(() => {
    if (!dropdownRef.value) return
    const el = dropdownRef.value.children[activeIndex.value] as HTMLElement | undefined
    if (el) el.scrollIntoView({ block: 'nearest' })
  })
}

watch(() => props.modelValue, (val) => {
  if (!val.trim()) {
    suggestions.value = []
    showDropdown.value = false
  }
})
</script>

<template>
  <div class="ac-wrap">
    <input
      v-bind="$attrs"
      :value="modelValue"
      :placeholder="placeholder"
      :class="inputClasses"
      autocomplete="off"
      spellcheck="false"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="expanded"
      :aria-controls="expanded ? listId : undefined"
      :aria-activedescendant="expanded && items[activeIndex] !== undefined ? `${listId}-${activeIndex}` : undefined"
      @input="onInput"
      @focus="onFocus"
      @click="options && openChoices()"
      @blur="onBlur"
      @keydown="onKeydown"
    />
    <Transition name="ac-dropdown">
      <div
        v-if="expanded"
        :id="listId"
        ref="dropdownRef"
        class="ac-dropdown"
        role="listbox"
      >
        <div
          v-for="(item, i) in items"
          :key="item"
          :id="`${listId}-${i}`"
          class="ac-item"
          :class="{ 'ac-item-active': i === activeIndex }"
          role="option"
          :aria-selected="i === activeIndex"
          :title="item || emptyOption"
          @pointerdown.prevent
          @click="selectItem(item)"
          @mouseenter="activeIndex = i"
        >
          {{ item || emptyOption }}
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ac-wrap {
  position: relative;
}
.ac-input {
  width: 100%;
  padding: 7px 10px;
  font-size: 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  color: var(--text-primary);
  transition: border-color 0.15s;
}
.ac-input:focus {
  border-color: var(--amber);
  outline: none;
}
.ac-input::placeholder {
  color: var(--text-muted);
}
.ac-input-mono {
  font-family: var(--font-mono);
  font-size: 11px;
}

/* ── Dropdown ── */
.ac-dropdown {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  scrollbar-width: thin;
  scrollbar-color: var(--border-subtle) transparent;
}
.ac-item {
  padding: 6px 10px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.08s, color 0.08s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ac-item:hover,
.ac-item-active {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ── Dropdown transition ── */
.ac-dropdown-enter-active {
  transition: opacity 0.1s ease-out, transform 0.1s ease-out;
}
.ac-dropdown-leave-active {
  transition: opacity 0.08s ease-in;
  pointer-events: none;
}
.ac-dropdown-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.ac-dropdown-leave-to {
  opacity: 0;
}
</style>
