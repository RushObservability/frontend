export type VirtualKey = string | number
export type VirtualNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

export function nextVirtualIndex(
  key: VirtualNavigationKey,
  current: number,
  count: number,
): number {
  const last = Math.max(0, count - 1)
  if (key === 'Home') return 0
  if (key === 'End') return last
  if (key === 'ArrowDown') return Math.min(last, current + 1)
  return Math.max(0, current - 1)
}

export function buildVirtualOffsets(
  count: number,
  estimatedHeight: number,
  keyAt: (index: number) => VirtualKey,
  measuredHeights: ReadonlyMap<VirtualKey, number>,
): number[] {
  const offsets = new Array<number>(count + 1)
  offsets[0] = 0
  for (let index = 0; index < count; index++) {
    offsets[index + 1] = offsets[index]! + (measuredHeights.get(keyAt(index)) || estimatedHeight)
  }
  return offsets
}

export function virtualIndexAtOffset(offsets: readonly number[], offset: number): number {
  const count = Math.max(0, offsets.length - 1)
  if (count === 0) return 0
  let low = 0
  let high = count
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle + 1]! <= offset) low = middle + 1
    else high = middle
  }
  return Math.min(low, count - 1)
}

export function virtualWindow(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  estimatedHeight: number,
  overscan: number,
): { start: number; end: number } {
  const count = Math.max(0, offsets.length - 1)
  if (count === 0) return { start: 0, end: 0 }
  const start = Math.max(0, virtualIndexAtOffset(offsets, scrollTop) - overscan)
  const target = scrollTop + viewportHeight + overscan * estimatedHeight
  let end = Math.max(start, virtualIndexAtOffset(offsets, target))
  while (end < count && offsets[end]! < target) end++
  return { start, end: Math.min(count, end + overscan) }
}
