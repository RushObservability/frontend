<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{ open: boolean; checking: boolean; offline: boolean }>()
const emit = defineEmits<{ retry: []; dismiss: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = [...dialog.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

watch(() => props.open, open => {
  if (open && !dialog.value?.open) dialog.value?.showModal()
  else if (!open && dialog.value?.open) dialog.value.close()
}, { flush: 'post', immediate: true })

onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="api-unavailable-dialog"
      aria-labelledby="api-unavailable-title"
      aria-describedby="api-unavailable-description"
      @cancel.prevent="emit('dismiss')"
      @keydown="onKeydown"
    >
      <div class="api-unavailable-heading">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M12 8v5m0 3v.5M10.3 3.8 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
        </svg>
        <h2 id="api-unavailable-title">API unavailable</h2>
      </div>
      <p id="api-unavailable-description">
        {{ offline ? 'Your browser is offline. Reconnect to reach query-api.' : 'The frontend cannot reach query-api. The service may be stopped, restarting, or blocked by a network or proxy.' }}
      </p>
      <p>Your page is still here, but its data may be out of date. Check your connection and that query-api is running.</p>
      <p class="api-unavailable-status" role="status">
        {{ checking ? 'Checking the connection…' : offline ? 'Waiting for a network connection.' : 'Retrying automatically. This notice closes when the API responds.' }}
      </p>
      <div class="api-unavailable-actions">
        <button type="button" class="api-unavailable-secondary" autofocus @click="emit('dismiss')">Keep viewing</button>
        <button type="button" class="api-unavailable-primary" :disabled="checking" @click="emit('retry')">
          {{ checking ? 'Checking…' : 'Retry now' }}
        </button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.api-unavailable-dialog { width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: var(--sp-6); overflow: auto; color: var(--text-primary); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--r-lg); box-shadow: 0 22px 70px rgba(3, 5, 10, .32); }
.api-unavailable-dialog::backdrop { background: rgba(3, 5, 10, .65); }
.api-unavailable-heading { display: flex; align-items: center; gap: var(--sp-3); }
.api-unavailable-heading svg { width: 24px; height: 24px; flex-shrink: 0; color: var(--warning); }
.api-unavailable-heading h2 { margin: 0; font-size: 18px; font-weight: 650; }
.api-unavailable-dialog p { margin: var(--sp-4) 0 0; color: var(--text-secondary); font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.api-unavailable-dialog .api-unavailable-status { padding-top: var(--sp-4); border-top: 1px solid var(--border-subtle); font-size: 12px; }
.api-unavailable-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--sp-2); margin-top: var(--sp-5); }
.api-unavailable-actions button { min-height: 44px; padding: var(--sp-2) var(--sp-4); border: 1px solid var(--border-default); border-radius: var(--r-sm); font-size: 13px; font-weight: 600; cursor: pointer; }
.api-unavailable-secondary { background: var(--bg-surface); color: var(--text-secondary); }
.api-unavailable-primary { background: var(--accent); color: var(--text-inverse); }
.api-unavailable-actions button:hover:not(:disabled) { filter: brightness(1.1); }
.api-unavailable-actions button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
.api-unavailable-actions button:disabled { opacity: .6; cursor: wait; }
</style>
