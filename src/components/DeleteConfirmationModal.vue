<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  error?: string | null
}>(), {
  confirmLabel: 'Delete permanently',
  cancelLabel: 'Cancel',
  busy: false,
  error: null,
})

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const dialogRef = ref<HTMLElement | null>(null)
const cancelButtonRef = ref<HTMLButtonElement | null>(null)
const titleId = useId()
const descriptionId = useId()
let returnFocusTo: HTMLElement | null = null

watch(() => props.open, async (open) => {
  if (open) {
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    cancelButtonRef.value?.focus()
    return
  }

  if (returnFocusTo?.isConnected) returnFocusTo.focus()
  returnFocusTo = null
})

onBeforeUnmount(() => {
  if (returnFocusTo?.isConnected) returnFocusTo.focus()
})

function cancel() {
  if (!props.busy) emit('cancel')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
    return
  }

  if (event.key !== 'Tab' || !dialogRef.value) return
  const controls = [...dialogRef.value.querySelectorAll<HTMLElement>('button:not(:disabled)')]
  if (!controls.length) return

  const first = controls[0]!
  const last = controls[controls.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="delete-confirm">
      <div v-if="open" class="delete-confirm-backdrop" @click.self="cancel">
        <section
          ref="dialogRef"
          class="delete-confirm-modal"
          role="alertdialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="descriptionId"
          @keydown="onKeydown"
        >
          <div class="delete-confirm-symbol" aria-hidden="true">!</div>
          <div class="delete-confirm-copy">
            <div class="delete-confirm-kicker">Destructive action</div>
            <h2 :id="titleId">{{ title }}</h2>
            <p :id="descriptionId">{{ description }}</p>
            <p v-if="error" class="delete-confirm-error" role="alert">{{ error }}</p>
          </div>
          <div class="delete-confirm-actions">
            <button
              ref="cancelButtonRef"
              type="button"
              class="delete-confirm-button delete-confirm-cancel"
              :disabled="busy"
              @click="cancel"
            >
              {{ cancelLabel }}
            </button>
            <button
              type="button"
              class="delete-confirm-button delete-confirm-delete"
              :disabled="busy"
              @click="emit('confirm')"
            >
              {{ busy ? 'Deleting…' : confirmLabel }}
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.delete-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: var(--sp-4);
  background: rgba(3, 5, 10, 0.68);
  backdrop-filter: blur(3px);
}

.delete-confirm-modal {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--sp-4);
  width: min(500px, 100%);
  padding: var(--sp-5);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  box-shadow: 0 22px 70px rgba(3, 5, 10, 0.32);
}

.delete-confirm-symbol {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  color: var(--error);
  background: var(--error-dim);
  border: 1px solid color-mix(in srgb, var(--error) 35%, transparent);
  border-radius: 50%;
  font-size: 16px;
  font-weight: 750;
}

.delete-confirm-copy {
  min-width: 0;
}

.delete-confirm-kicker {
  margin-bottom: 5px;
  color: var(--error);
  font: 700 9px/1 var(--font-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.delete-confirm-copy h2 {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 650;
  line-height: 1.3;
}

.delete-confirm-copy p {
  margin: 7px 0 0;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.5;
}

.delete-confirm-copy .delete-confirm-error {
  color: var(--error);
}

.delete-confirm-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding-top: var(--sp-1);
}

.delete-confirm-button {
  min-height: 31px;
  padding: 0 var(--sp-3);
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  transition: background 0.14s, border-color 0.14s, color 0.14s, filter 0.14s;
}

.delete-confirm-button:disabled {
  opacity: 0.55;
  cursor: wait;
}

.delete-confirm-cancel {
  color: var(--text-secondary);
  background: var(--bg-surface);
  border-color: var(--border-default);
}

.delete-confirm-cancel:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.delete-confirm-delete {
  color: var(--text-inverse);
  background: var(--error);
}

.delete-confirm-delete:hover:not(:disabled) {
  filter: brightness(1.08);
}

.delete-confirm-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.delete-confirm-enter-active,
.delete-confirm-leave-active {
  transition: opacity 0.16s ease;
}

.delete-confirm-enter-active .delete-confirm-modal,
.delete-confirm-leave-active .delete-confirm-modal {
  transition: opacity 0.16s ease, transform 0.16s cubic-bezier(0.22, 1, 0.36, 1);
}

.delete-confirm-enter-from,
.delete-confirm-leave-to,
.delete-confirm-enter-from .delete-confirm-modal,
.delete-confirm-leave-to .delete-confirm-modal {
  opacity: 0;
}

.delete-confirm-enter-from .delete-confirm-modal,
.delete-confirm-leave-to .delete-confirm-modal {
  transform: translateY(6px) scale(0.985);
}

@media (prefers-reduced-motion: reduce) {
  .delete-confirm-enter-active,
  .delete-confirm-leave-active,
  .delete-confirm-enter-active .delete-confirm-modal,
  .delete-confirm-leave-active .delete-confirm-modal {
    transition: none;
  }
}
</style>
