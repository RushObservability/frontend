<script setup lang="ts">
import { ref } from 'vue'
import { useModalFocus } from '../composables/useModalFocus'

const props = withDefaults(defineProps<{
  open: boolean
  label: string
  size?: 'medium' | 'wide'
}>(), {
  size: 'wide',
})

const emit = defineEmits<{
  close: []
}>()

const panel = ref<HTMLElement | null>(null)

function close() {
  emit('close')
}

const { handleModalKeydown } = useModalFocus(() => props.open, panel, close)
</script>

<template>
  <Teleport to="body">
    <Transition name="detail-drawer">
      <div v-if="open" class="detail-drawer-overlay" @click.self="close">
        <section
          ref="panel"
          class="detail-drawer"
          :class="`detail-drawer--${size}`"
          role="dialog"
          aria-modal="true"
          :aria-label="label"
          tabindex="-1"
          @keydown="handleModalKeydown"
        >
          <slot />
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.detail-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in srgb, var(--bg-void) 72%, transparent);
  backdrop-filter: blur(3px);
}

.detail-drawer {
  height: 100%;
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--bg-raised);
  border-top: 2px solid var(--accent);
  border-left: 1px solid var(--border-strong);
  box-shadow: -18px 0 55px rgba(0, 0, 0, .42);
  outline: none;
}

.detail-drawer--medium { width: min(680px, 82vw); }
.detail-drawer--wide { width: min(920px, 88vw); }

.detail-drawer-enter-active { transition: opacity 250ms ease; }
.detail-drawer-leave-active { transition: opacity 180ms ease; }
.detail-drawer-enter-active .detail-drawer {
  transition: transform 300ms cubic-bezier(.16, 1, .3, 1);
}
.detail-drawer-leave-active .detail-drawer {
  transition: transform 180ms cubic-bezier(.4, 0, 1, 1);
}
.detail-drawer-enter-from,
.detail-drawer-leave-to { opacity: 0; }
.detail-drawer-enter-from .detail-drawer,
.detail-drawer-leave-to .detail-drawer { transform: translateX(100%); }

@media (max-width: 700px) {
  .detail-drawer--medium,
  .detail-drawer--wide {
    width: 100%;
    border-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .detail-drawer-enter-active,
  .detail-drawer-leave-active,
  .detail-drawer-enter-active .detail-drawer,
  .detail-drawer-leave-active .detail-drawer {
    transition-duration: 1ms;
  }
}
</style>
