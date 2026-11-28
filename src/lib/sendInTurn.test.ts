import { describe, expect, it } from 'vitest'
import { sendInTurn, sendInTurnSummary } from './sendInTurn'

const failure = (message: string, status: number, retryAfterMs?: number) =>
  Object.assign(new Error(message), { status, retryAfterMs })

describe('sendInTurn', () => {
  it('sends one at a time and keeps going past a failed channel', async () => {
    let inFlight = 0, peak = 0
    const result = await sendInTurn(['a', 'b', 'c'], async id => {
      peak = Math.max(peak, ++inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight--
      if (id === 'b') throw failure('channel not found', 404)
    })
    expect(peak).toBe(1)
    expect(result).toEqual({ sent: ['a', 'c'], failed: [{ item: 'b', message: 'channel not found' }], limited: false })
    expect(sendInTurnSummary(result, 3)).toBe('Sent 2 of 3.')
  })

  it('stops at the send limit and says when to retry', async () => {
    const tried: string[] = []
    const result = await sendInTurn(['a', 'b', 'c'], async id => {
      tried.push(id)
      if (id === 'b') throw failure('Too many requests.', 429, 42_100)
    })
    expect(tried).toEqual(['a', 'b'])
    expect(sendInTurnSummary(result, 3)).toBe('Sent 1 of 3. The notification limit was reached; try again in 43s.')
    expect(sendInTurnSummary({ ...result, retryAfterMs: undefined }, 3)).toContain('try again in about a minute')
  })

  it('has nothing to say when every send went out', async () => {
    expect(sendInTurnSummary(await sendInTurn(['a'], async () => {}), 1)).toBe('')
  })
})
