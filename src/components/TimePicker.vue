<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface Preset {
  label: string
  value: number // minutes
}

const props = withDefaults(defineProps<{
  modelValue: number
  presets?: Preset[]
  customRange?: { from: string; to: string } | null
}>(), {
  presets: () => [
    { label: '5m', value: 5 },
    { label: '15m', value: 15 },
    { label: '30m', value: 30 },
    { label: '1h', value: 60 },
    { label: '3h', value: 180 },
    { label: '6h', value: 360 },
    { label: '12h', value: 720 },
    { label: '24h', value: 1440 },
    { label: '2d', value: 2880 },
    { label: '7d', value: 10080 },
    { label: '30d', value: 43200 },
  ],
  customRange: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
  'update:customRange': [value: { from: string; to: string } | null]
}>()

const open = ref(false)
const wrapperRef = ref<HTMLElement | null>(null)
const customFrom = ref('')
const customTo = ref('')

function presetLabel(minutes: number): string {
  if (minutes < 60) return `Last ${minutes}m`
  if (minutes === 60) return 'Last 1h'
  if (minutes < 1440) return `Last ${minutes / 60}h`
  if (minutes === 1440) return 'Last 24h'
  return `Last ${minutes / 1440}d`
}

const isCustom = computed(() => props.customRange != null)

const activeLabel = computed(() => {
  if (isCustom.value && props.customRange) {
    const fmt = (iso: string) => {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return iso
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const hh = String(d.getHours()).padStart(2, '0')
      const mi = String(d.getMinutes()).padStart(2, '0')
      return `${mm}/${dd} ${hh}:${mi}`
    }
    return `${fmt(props.customRange.from)} — ${fmt(props.customRange.to)}`
  }
  return presetLabel(props.modelValue)
})

function selectPreset(value: number) {
  emit('update:customRange', null)
  emit('update:modelValue', value)
  open.value = false
}

function applyCustomRange() {
  if (!customFrom.value || !customTo.value) return
  const from = new Date(customFrom.value)
  const to = new Date(customTo.value)
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) return

  const diffMin = Math.round((to.getTime() - from.getTime()) / 60000)
  emit('update:customRange', { from: from.toISOString(), to: to.toISOString() })
  emit('update:modelValue', diffMin)
  open.value = false
}

function initDefaults() {
  if (props.customRange) {
    customFrom.value = toLocalISO(new Date(props.customRange.from))
    customTo.value = toLocalISO(new Date(props.customRange.to))
  } else {
    const now = new Date()
    const from = new Date(now.getTime() - props.modelValue * 60000)
    customFrom.value = toLocalISO(from)
    customTo.value = toLocalISO(now)
  }
}

function toLocalISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${dd}T${hh}:${mi}`
}

function toggle() {
  open.value = !open.value
  if (open.value) initDefaults()
}

function onClickOutside(e: MouseEvent) {
  if (wrapperRef.value && !wrapperRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
  <div ref="wrapperRef" class="tp-wrapper">
    <button class="tp-trigger" :class="{ open }" @click="toggle">
      <svg class="tp-clock-icon" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/>
        <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="tp-label">{{ activeLabel }}</span>
      <svg class="tp-chevron" :class="{ flipped: open }" viewBox="0 0 10 6" fill="none">
        <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <Transition name="tp-pop">
      <div v-if="open" class="tp-popover">
        <!-- Left: Custom range -->
        <div class="tp-custom">
          <div class="tp-section-label">Custom range</div>
          <div class="tp-field">
            <label class="tp-field-label">From</label>
            <input v-model="customFrom" type="datetime-local" class="tp-input mono" />
          </div>
          <div class="tp-field">
            <label class="tp-field-label">To</label>
            <input v-model="customTo" type="datetime-local" class="tp-input mono" />
          </div>
          <button class="tp-apply" @click="applyCustomRange">Apply range</button>
        </div>

        <div class="tp-divider"></div>

        <!-- Right: Quick presets -->
        <div class="tp-presets">
          <div class="tp-section-label">Quick ranges</div>
          <div class="tp-preset-grid">
            <button
              v-for="p in presets"
              :key="p.value"
              class="tp-preset"
              :class="{ active: modelValue === p.value && !isCustom }"
              @click="selectPreset(p.value)"
            >
              {{ presetLabel(p.value) }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped src="../styles/components/TimePicker.css"></style>
