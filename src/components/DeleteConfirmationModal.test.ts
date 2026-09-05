import { describe, expect, it } from 'vitest'
import source from './DeleteConfirmationModal.vue?raw'

describe('delete confirmation modal', () => {
  it('is an accessible alert dialog with safe dismissal controls', () => {
    expect(source).toContain('role="alertdialog"')
    expect(source).toContain('aria-modal="true"')
    expect(source).toContain('@click.self="cancel"')
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain('cancelButtonRef.value?.focus()')
  })

  it('locks the dialog while deletion is pending', () => {
    expect(source).toContain("busy ? 'Deleting…' : confirmLabel")
    expect(source).toContain(':disabled="busy"')
    expect(source).toContain("if (!props.busy) emit('cancel')")
  })
})
