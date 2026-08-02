<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  count: number
  rowHeight?: number
  overscan?: number
  disabled?: boolean
}>(), {
  rowHeight: 30,
  overscan: 10,
  disabled: false,
})

const emit = defineEmits<{
  nearEnd: []
}>()

const viewport = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
let resizeObserver: ResizeObserver | null = null
let frame: number | null = null

const start = computed(() => {
  if (props.disabled || props.count === 0) return 0
  return Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - props.overscan)
})

const end = computed(() => {
  if (props.disabled) return props.count
  const visible = Math.ceil(viewportHeight.value / props.rowHeight) + props.overscan * 2
  return Math.min(props.count, start.value + Math.max(visible, props.overscan * 2))
})

const indexes = computed(() => {
  const values: number[] = []
  for (let i = start.value; i < end.value; i++) values.push(i)
  return values
})

function measure() {
  viewportHeight.value = viewport.value?.clientHeight || 0
}

function emitScrollState() {
  frame = null
  const node = viewport.value
  if (!node) return
  scrollTop.value = node.scrollTop
  if (node.scrollTop + node.clientHeight >= node.scrollHeight - 300) emit('nearEnd')
}

function onScroll() {
  if (frame !== null) return
  frame = requestAnimationFrame(emitScrollState)
}

onMounted(async () => {
  await nextTick()
  measure()
  resizeObserver = new ResizeObserver(measure)
  if (viewport.value) resizeObserver.observe(viewport.value)
})

watch(() => props.count, (count, previousCount) => {
  if (count < previousCount && viewport.value) viewport.value.scrollTop = 0
  void nextTick(() => {
    measure()
    emitScrollState()
  })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (frame !== null) cancelAnimationFrame(frame)
})
</script>

<template>
  <div ref="viewport" class="virtual-table-viewport" @scroll="onScroll">
    <div v-if="!disabled" aria-hidden="true" :style="{ height: `${start * rowHeight}px` }" />
    <template v-for="index in indexes" :key="index">
      <slot :index="index" />
    </template>
    <div v-if="!disabled" aria-hidden="true" :style="{ height: `${Math.max(0, count - end) * rowHeight}px` }" />
    <slot name="footer" />
  </div>
</template>

<style scoped>
.virtual-table-viewport {
  max-height: min(68vh, 760px);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
</style>
