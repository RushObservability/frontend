<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  mono?: boolean
  fetchSuggestions: (prefix: string) => Promise<string[]>
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
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const inputClasses = computed(() => ({
  'ac-input': true,
  'ac-input-mono': props.mono,
}))

function onInput(ev: Event) {
  const val = (ev.target as HTMLInputElement).value
  emit('update:modelValue', val)
  activeIndex.value = -1
  scheduleFetch(val)
}

function scheduleFetch(val: string) {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!val.trim()) {
    suggestions.value = []
    showDropdown.value = false
    return
  }
  debounceTimer = setTimeout(async () => {
    loading.value = true
    try {
      const results = await props.fetchSuggestions(val)
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

function onFocus() {
  if (suggestions.value.length > 0 && props.modelValue.trim()) {
    showDropdown.value = true
  }
}

function onBlur() {
  // Delay to allow click on dropdown items
  setTimeout(() => {
    showDropdown.value = false
  }, 180)
}

function selectItem(item: string) {
  emit('update:modelValue', item)
  emit('select', item)
  showDropdown.value = false
  activeIndex.value = -1
}

function onKeydown(ev: KeyboardEvent) {
  if (!showDropdown.value) return

  if (ev.key === 'ArrowDown') {
    ev.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, suggestions.value.length - 1)
    scrollActive()
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
    scrollActive()
  } else if (ev.key === 'Enter' && activeIndex.value >= 0) {
    ev.preventDefault()
    const item = suggestions.value[activeIndex.value]
    if (item) selectItem(item)
  } else if (ev.key === 'Escape') {
    showDropdown.value = false
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
      :value="modelValue"
      :placeholder="placeholder"
      :class="inputClasses"
      autocomplete="off"
      spellcheck="false"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    />
    <Transition name="ac-dropdown">
      <div
        v-if="showDropdown"
        ref="dropdownRef"
        class="ac-dropdown"
      >
        <div
          v-for="(item, i) in suggestions"
          :key="item"
          class="ac-item"
          :class="{ 'ac-item-active': i === activeIndex }"
          @mousedown.prevent="selectItem(item)"
          @mouseenter="activeIndex = i"
        >
          {{ item }}
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
}
.ac-dropdown-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.ac-dropdown-leave-to {
  opacity: 0;
}
</style>
