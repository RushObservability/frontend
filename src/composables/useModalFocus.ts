import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function useModalFocus(
  open: () => boolean,
  container: Ref<HTMLElement | null>,
  close: () => void,
  initialFocus?: Ref<HTMLElement | null>,
) {
  let returnFocus: HTMLElement | null = null
  let previousOverflow = ''
  let ownsScrollLock = false

  function focusableElements(): HTMLElement[] {
    if (!container.value) return []
    return Array.from(container.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(element => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
  }

  function handleModalKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = focusableElements()
    if (!focusable.length) {
      event.preventDefault()
      container.value?.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && (document.activeElement === first || document.activeElement === container.value)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function restorePage() {
    if (!ownsScrollLock) return
    document.body.style.overflow = previousOverflow
    ownsScrollLock = false
    returnFocus?.focus()
    returnFocus = null
  }

  watch(open, async isOpen => {
    if (isOpen) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      ownsScrollLock = true
      await nextTick()
      ;(initialFocus?.value ?? container.value)?.focus()
    } else {
      restorePage()
    }
  })

  onBeforeUnmount(restorePage)

  return { handleModalKeydown }
}
