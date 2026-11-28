export interface SendInTurnResult<T> {
  sent: T[]
  failed: Array<{ item: T; message: string }>
  /** A 429 stopped the run; later items were not tried. */
  limited: boolean
  retryAfterMs?: number
}

/** Send to each item one at a time, collecting failures and stopping at the first 429. */
export async function sendInTurn<T>(items: readonly T[], send: (item: T) => Promise<unknown>): Promise<SendInTurnResult<T>> {
  const result: SendInTurnResult<T> = { sent: [], failed: [], limited: false }
  for (const item of items) {
    try {
      await send(item)
      result.sent.push(item)
    } catch (error) {
      const { status, retryAfterMs, message } = (error ?? {}) as { status?: number; retryAfterMs?: number; message?: string }
      if (status === 429) return { ...result, limited: true, retryAfterMs }
      result.failed.push({ item, message: message || 'Send failed.' })
    }
  }
  return result
}

/** One line for the sender, or '' when every send went out. */
export function sendInTurnSummary(result: SendInTurnResult<unknown>, total: number): string {
  const sent = `Sent ${result.sent.length} of ${total}.`
  if (!result.limited) return result.failed.length ? sent : ''
  const wait = result.retryAfterMs === undefined ? 'about a minute' : `${Math.max(1, Math.ceil(result.retryAfterMs / 1000))}s`
  return `${sent} The notification limit was reached; try again in ${wait}.`
}
