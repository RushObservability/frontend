<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildVirtualOffsets, nextVirtualIndex, virtualWindow } from '../lib/virtualWindow'

const props = withDefaults(defineProps<{
  count: number
  rowHeight?: number
  overscan?: number
  /** Stable identity survives prepend/append and recycled DOM nodes. */
  itemKey?: (index: number) => string | number
  /** Measure rendered rows so wrapped messages and detail panels stay virtualized. */
  variable?: boolean
  selectedIndex?: number
  ariaLabel?: string
  /** Optional live-follow edge. A user scroll away pauses follow until resumeFollow(). */
  follow?: boolean
  followEdge?: 'start' | 'end'
  /** Compatibility escape hatch for small collections. */
  disabled?: boolean
}>(), {
  rowHeight: 36,
  overscan: 8,
  itemKey: (index: number) => index,
  variable: false,
  selectedIndex: -1,
  ariaLabel: 'Results',
  follow: false,
  followEdge: 'end',
  disabled: false,
})

const emit = defineEmits<{
  nearEnd: []
  select: [index: number]
  activate: [index: number]
  followChange: [following: boolean]
}>()

const viewport = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const measurementVersion = ref(0)
const measuredHeights = new Map<string | number, number>()
const observedKeys = new WeakMap<Element, string | number>()
let resizeObserver: ResizeObserver | null = null
let viewportResizeObserver: ResizeObserver | null = null
let frame: number | null = null
let following = props.follow
let programmaticScroll = false

function keyFor(index: number): string | number {
  return props.itemKey(index)
}

const offsets = computed(() => {
  // Explicit dependency: Map is intentionally non-reactive to avoid proxying
  // thousands of entries. ResizeObserver increments one small version counter.
  void measurementVersion.value
  return buildVirtualOffsets(props.count, props.rowHeight, keyFor, measuredHeights)
})

const start = computed(() => {
  if (props.disabled || props.count === 0) return 0
  return virtualWindow(
    offsets.value,
    scrollTop.value,
    viewportHeight.value,
    props.rowHeight,
    props.overscan,
  ).start
})

const end = computed(() => {
  if (props.disabled) return props.count
  if (props.count === 0) return 0
  return virtualWindow(
    offsets.value,
    scrollTop.value,
    viewportHeight.value,
    props.rowHeight,
    props.overscan,
  ).end
})

const indexes = computed(() => {
  const values: number[] = []
  for (let index = start.value; index < end.value; index++) values.push(index)
  return values
})

const topPadding = computed(() => props.disabled ? 0 : offsets.value[start.value] || 0)
const bottomPadding = computed(() => props.disabled
  ? 0
  : Math.max(0, offsets.value[props.count]! - offsets.value[end.value]!))

function measureViewport() {
  viewportHeight.value = viewport.value?.clientHeight || 0
}

function distanceFromFollowEdge(node: HTMLElement): number {
  return props.followEdge === 'start'
    ? node.scrollTop
    : node.scrollHeight - node.clientHeight - node.scrollTop
}

function emitScrollState() {
  frame = null
  const node = viewport.value
  if (!node) return
  scrollTop.value = node.scrollTop
  if (!programmaticScroll && following && distanceFromFollowEdge(node) > props.rowHeight * 2) {
    following = false
    emit('followChange', false)
  }
  programmaticScroll = false
  if (node.scrollTop + node.clientHeight >= node.scrollHeight - 300) emit('nearEnd')
}

function onScroll() {
  if (frame !== null) return
  frame = requestAnimationFrame(emitScrollState)
}

function observeRow(element: unknown, index: number) {
  if (!(element instanceof HTMLElement) || !props.variable || !resizeObserver) return
  observedKeys.set(element, keyFor(index))
  resizeObserver.observe(element)
}

function scrollToIndex(index: number, align: 'auto' | 'center' = 'auto') {
  const node = viewport.value
  if (!node || index < 0 || index >= props.count) return
  const top = offsets.value[index]!
  const bottom = offsets.value[index + 1]!
  let target = node.scrollTop
  if (align === 'center') target = top - (node.clientHeight - (bottom - top)) / 2
  else if (top < node.scrollTop) target = top
  else if (bottom > node.scrollTop + node.clientHeight) target = bottom - node.clientHeight
  if (target !== node.scrollTop) {
    programmaticScroll = true
    node.scrollTop = Math.max(0, target)
  }
}

async function resumeFollow() {
  following = true
  emit('followChange', true)
  await nextTick()
  const node = viewport.value
  if (!node) return
  programmaticScroll = true
  node.scrollTop = props.followEdge === 'start' ? 0 : node.scrollHeight
}

function onRowKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('activate', index)
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const target = nextVirtualIndex(event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End', index, props.count)
  event.preventDefault()
  emit('select', target)
  scrollToIndex(target)
  void nextTick(() => {
    viewport.value?.querySelector<HTMLElement>(`[data-virtual-index="${target}"]`)?.focus()
  })
}

onMounted(async () => {
  await nextTick()
  measureViewport()
  viewportResizeObserver = new ResizeObserver(measureViewport)
  if (viewport.value) viewportResizeObserver.observe(viewport.value)
  resizeObserver = new ResizeObserver((entries) => {
    let changed = false
    for (const entry of entries) {
      const key = observedKeys.get(entry.target)
      if (key === undefined) continue
      const height = Math.max(1, Math.ceil(entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height))
      if (measuredHeights.get(key) !== height) {
        measuredHeights.set(key, height)
        changed = true
      }
    }
    if (changed) measurementVersion.value++
  })
  // Template refs run before onMounted, so register the initially rendered
  // window after the observer exists. Later recycled rows register via ref.
  viewport.value?.querySelectorAll<HTMLElement>('[data-virtual-index]').forEach((element) => {
    observeRow(element, Number(element.dataset.virtualIndex))
  })
})

watch(() => props.follow, (value) => { following = value })
watch(() => props.selectedIndex, (index) => {
  if (index >= 0) scrollToIndex(index)
})
watch(() => props.count, async (count, previousCount) => {
  if (count < previousCount) {
    measuredHeights.clear()
    measurementVersion.value++
    if (viewport.value) viewport.value.scrollTop = 0
  }
  await nextTick()
  measureViewport()
  if (following) await resumeFollow()
  else emitScrollState()
})
watch(() => props.count > 0 ? keyFor(0) : null, async (key, previousKey) => {
  // Live queries commonly replace a fixed-size page. Count does not change, but
  // a new first key still means the followed edge moved.
  if (key !== previousKey && following) await resumeFollow()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  viewportResizeObserver?.disconnect()
  if (frame !== null) cancelAnimationFrame(frame)
})

defineExpose({ resumeFollow, scrollToIndex })
</script>

<template>
  <div
    ref="viewport"
    class="virtual-table-viewport"
    role="listbox"
    :aria-label="ariaLabel"
    :aria-setsize="count"
    @scroll="onScroll"
  >
    <slot name="header" />
    <slot name="overlay" />
    <div v-if="!disabled" aria-hidden="true" :style="{ height: `${topPadding}px` }" />
    <div
      v-for="index in indexes"
      :key="keyFor(index)"
      :ref="(element) => observeRow(element, index)"
      class="virtual-table-row"
      role="option"
      :data-virtual-index="index"
      :aria-posinset="index + 1"
      :aria-setsize="count"
      :aria-selected="selectedIndex === index"
      :tabindex="selectedIndex === index || (selectedIndex < 0 && index === 0) ? 0 : -1"
      @focus="emit('select', index)"
      @keydown="onRowKeydown($event, index)"
    >
      <slot :index="index" />
    </div>
    <div v-if="!disabled" aria-hidden="true" :style="{ height: `${bottomPadding}px` }" />
    <slot name="footer" />
  </div>
</template>

<style scoped>
.virtual-table-viewport {
  max-height: min(68vh, 760px);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  overflow-anchor: none;
}

.virtual-table-row:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: -2px;
}
</style>
