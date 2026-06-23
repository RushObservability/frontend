<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import DOMPurify from 'dompurify'

function safeIcon(icon: string): string {
  return DOMPurify.sanitize(icon, { USE_PROFILES: { svg: true, svgFilters: true } })
}

export interface ContextMenuItem {
  label: string
  icon?: string
  action: () => void
  separator?: false
  disabled?: boolean
}

export interface ContextMenuSeparator {
  separator: true
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

const props = defineProps<{
  x: number
  y: number
  items: ContextMenuEntry[]
}>()

const emit = defineEmits<{
  close: []
}>()

const menuEl = ref<HTMLElement | null>(null)
const adjustedX = ref(props.x)
const adjustedY = ref(props.y)

function positionMenu() {
  nextTick(() => {
    if (!menuEl.value) return
    const rect = menuEl.value.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Adjust if menu overflows right edge
    if (props.x + rect.width > vw - 8) {
      adjustedX.value = Math.max(8, vw - rect.width - 8)
    } else {
      adjustedX.value = props.x
    }

    // Adjust if menu overflows bottom edge
    if (props.y + rect.height > vh - 8) {
      adjustedY.value = Math.max(8, vh - rect.height - 8)
    } else {
      adjustedY.value = props.y
    }
  })
}

function onClickOutside(e: MouseEvent) {
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) {
    emit('close')
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

function onScroll() {
  emit('close')
}

function handleItemClick(item: ContextMenuEntry) {
  if ('separator' in item && item.separator) return
  if ('disabled' in item && item.disabled) return
  ;(item as ContextMenuItem).action()
  emit('close')
}

onMounted(() => {
  positionMenu()
  document.addEventListener('mousedown', onClickOutside, true)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', onScroll, true)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onClickOutside, true)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', onScroll, true)
})

watch(() => [props.x, props.y], positionMenu)
</script>

<template>
  <Teleport to="body">
    <div
      ref="menuEl"
      class="ctx-menu"
      :style="{ left: adjustedX + 'px', top: adjustedY + 'px' }"
      @contextmenu.prevent
    >
      <template v-for="(item, i) in items" :key="i">
        <div v-if="'separator' in item && item.separator" class="ctx-sep" />
        <button
          v-else
          class="ctx-item"
          :class="{ 'ctx-disabled': (item as ContextMenuItem).disabled }"
          @click="handleItemClick(item)"
        >
          <span v-if="(item as ContextMenuItem).icon" class="ctx-icon" v-html="safeIcon((item as ContextMenuItem).icon!)" />
          <span class="ctx-label">{{ (item as ContextMenuItem).label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 10000;
  min-width: 200px;
  max-width: 320px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2);
  padding: 4px 0;
  animation: ctx-fade-in 0.1s ease;
}

@keyframes ctx-fade-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: background 0.08s;
  white-space: nowrap;
}

.ctx-item:hover {
  background: var(--bg-hover);
}

.ctx-item.ctx-disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}

.ctx-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.ctx-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctx-sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--border-subtle);
}
</style>
