/** Promise.allSettled over `items`, running at most `limit` of them at once. */
export async function settleWithLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const index = next++
      try { results[index] = { status: 'fulfilled', value: await run(items[index]!) } }
      catch (reason) { results[index] = { status: 'rejected', reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return results
}
