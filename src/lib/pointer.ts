// Whether a mouse button or touch is held, so a layout change triggered by a
// blur can wait for the click that caused it to land first.
let down = false
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { down = true }, true)
  window.addEventListener('pointerup', () => { down = false }, true)
  window.addEventListener('pointercancel', () => { down = false }, true)
}

/** Run `fn` after the current click finishes, or right away when no pointer is held. */
export function afterPointerRelease(fn: () => void) {
  if (!down) { fn(); return }
  window.addEventListener('pointerup', () => setTimeout(fn), { once: true })
}
