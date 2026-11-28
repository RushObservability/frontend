/**
 * vue-router records the previous in-app location in `history.state.back`.
 * A link from outside the app or a fresh page load has none.
 */
export function openedInApp(historyState: unknown): boolean {
  return !!(historyState as { back?: unknown } | null)?.back
}
