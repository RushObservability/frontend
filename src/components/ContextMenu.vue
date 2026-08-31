<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import type { ContextMenuEntry, ContextMenuItem } from '../types/contextMenu'

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
          <svg
            v-if="(item as ContextMenuItem).icon"
            class="ctx-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <template v-if="(item as ContextMenuItem).icon === 'filter'">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </template>
            <template v-else-if="(item as ContextMenuItem).icon === 'exclude'">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </template>
            <template v-else-if="(item as ContextMenuItem).icon === 'copy'">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </template>
            <template v-else-if="(item as ContextMenuItem).icon === 'logs'">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </template>
            <template v-else-if="(item as ContextMenuItem).icon === 'apm'">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </template>
            <template v-else-if="(item as ContextMenuItem).icon === 'trace'">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </template>
          </svg>
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
