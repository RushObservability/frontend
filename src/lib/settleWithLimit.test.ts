import { describe, expect, it } from 'vitest'
import { settleWithLimit } from './settleWithLimit'

describe('settleWithLimit', () => {
  it('keeps at most the limit in flight and settles every item in order', async () => {
    let inFlight = 0, peak = 0
    const results = await settleWithLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async n => {
      peak = Math.max(peak, ++inFlight)
      await new Promise(resolve => setTimeout(resolve, 11 - n))
      inFlight--
      if (n === 3) throw new Error('boom')
      return n * 2
    })
    expect(peak).toBe(4)
    expect(results[0]).toEqual({ status: 'fulfilled', value: 2 })
    expect(results[2]).toMatchObject({ status: 'rejected', reason: new Error('boom') })
    expect(results[9]).toEqual({ status: 'fulfilled', value: 20 })
    expect(results).toHaveLength(10)
  })
})
