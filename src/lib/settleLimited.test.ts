import { describe, expect, it } from 'vitest'
import { settleLimited } from './settleLimited'

describe('settleLimited', () => {
  it('keeps order, settles failures and never exceeds the limit', async () => {
    let running = 0
    let peak = 0
    const results = await settleLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise(resolve => setTimeout(resolve, n % 3))
      running--
      if (n === 4) throw new Error('four')
      return n * 10
    })
    expect(peak).toBe(3)
    expect(results.map(r => r.status === 'fulfilled' ? r.value : (r.reason as Error).message))
      .toEqual([10, 20, 30, 'four', 50, 60, 70])
    expect(await settleLimited([], 3, async () => 1)).toEqual([])
  })
})
