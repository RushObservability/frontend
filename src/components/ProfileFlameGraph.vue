<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { buildFlameTree, layoutFlameTree, cpuTime, type ProfileStack, type FlameNode } from '../lib/profiles'

const props = defineProps<{ stacks: ProfileStack[]; search?: string; focusedFunction?: string }>()
const emit = defineEmits<{ select: [name: string] }>()
const root = computed(() => buildFlameTree(props.stacks))
const focus = ref<FlameNode | null>(null)
const hovered = ref<FlameNode | null>(null)
watch(root, () => { focus.value = null; hovered.value = null })
const selected = computed(() => focus.value ?? root.value)
const inspected = computed(() => hovered.value ?? selected.value)
const allRects = computed(() => layoutFlameTree(selected.value))
const rects = computed(() => allRects.value.filter(r => r.width >= .1).slice(0, 5000))
const height = computed(() => Math.max(260, (Math.max(0, ...rects.value.map(r => r.depth)) + 1) * 26))
const ancestors = computed(() => {
  const nodes: FlameNode[] = [root.value]
  let node = root.value
  for (const name of focus.value?.path ?? []) {
    const child = node.children.find(c => c.name === name)
    if (!child) break
    nodes.push(child)
    node = child
  }
  return nodes
})
watch(() => props.focusedFunction, name => {
  if (!name || focus.value?.name === name) return
  const match = layoutFlameTree(root.value).filter(r => r.node.name === name).sort((a, b) => b.node.total - a.node.total)[0]
  if (match) { focus.value = match.node; hovered.value = null }
})
function zoom(node: FlameNode) {
  focus.value = node === root.value ? null : node
  hovered.value = null
  emit('select', focus.value?.name ?? '')
}
function share(node: FlameNode) { return root.value.total ? node.total / root.value.total * 100 : 0 }
function band(node: FlameNode) {
  if (!node.path.length) return 'root-frame'
  const percent = share(node)
  return percent >= 10 ? 'cpu-high' : percent >= 1 ? 'cpu-medium' : 'cpu-low'
}
</script>

<template>
  <section class="profile-flame" aria-label="CPU flame graph">
    <div class="flame-toolbar">
      <nav class="stack-breadcrumbs" aria-label="Focused call stack">
        <template v-for="(node, index) in ancestors" :key="JSON.stringify(node.path)">
          <span v-if="index" aria-hidden="true">/</span>
          <button type="button" :disabled="node === selected" :title="node.name" @click="zoom(node)">{{ index === 0 ? 'All stacks' : node.name }}</button>
        </template>
      </nav>
      <button v-if="focus" type="button" class="reset-button" @click="zoom(root)">Reset zoom</button>
    </div>
    <div class="flame-scroll" @mouseleave="hovered = null">
      <div class="flame-canvas" :style="{ height: `${height}px` }">
        <button v-for="rect in rects" :key="JSON.stringify(rect.node.path)" type="button"
          class="flame-frame" :class="[band(rect.node), { dimmed: search && !rect.node.name.toLowerCase().includes(search.toLowerCase()), matched: search && rect.node.name.toLowerCase().includes(search.toLowerCase()) }]"
          :style="{ left: `${rect.x}%`, width: `${rect.width}%`, top: `${rect.depth * 26}px` }"
          :title="`${rect.node.name}\nTotal: ${cpuTime(rect.node.total)} · Self: ${cpuTime(rect.node.self)}\n${share(rect.node).toFixed(1)}% of all CPU`"
          :aria-label="`${rect.node.name}, ${cpuTime(rect.node.total)} total CPU. Zoom into this stack.`"
          @mouseenter="hovered = rect.node" @focus="hovered = rect.node" @blur="hovered = null"
          @click="zoom(rect.node)">
          <span>{{ rect.node.name }}</span><small v-if="rect.width > 24">{{ (rect.node.total / selected.total * 100).toFixed(1) }}%</small>
        </button>
      </div>
    </div>
    <p v-if="allRects.length > rects.length" class="zoom-label">Small frames are hidden at this zoom. Focus a parent to inspect them. The function table includes all stacks.</p>
    <div class="frame-inspector" aria-label="Frame details">
      <div class="inspected-name" :title="inspected.name">{{ inspected.name }}</div>
      <dl><div><dt>Total CPU</dt><dd>{{ cpuTime(inspected.total) }}</dd></div><div><dt>Self CPU</dt><dd>{{ cpuTime(inspected.self) }}</dd></div><div><dt>Of all CPU</dt><dd>{{ share(inspected).toFixed(1) }}%</dd></div></dl>
    </div>
    <div class="flame-legend"><span>CPU share</span><span><i class="cpu-low"></i>&lt;1%</span><span><i class="cpu-medium"></i>1–&lt;10%</span><span><i class="cpu-high"></i>≥10%</span><span class="legend-hint">Click a frame to focus</span></div>
  </section>
</template>

<style scoped>
.profile-flame { --cpu-low: color-mix(in oklch, var(--accent) 14%, var(--bg-surface)); --cpu-medium: color-mix(in oklch, var(--accent) 30%, var(--bg-surface)); --cpu-high: color-mix(in oklch, var(--accent) 50%, var(--bg-surface)); }
.flame-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; min-height: 44px; border-bottom: 1px solid var(--border-default); }
.stack-breadcrumbs { display: flex; align-items: center; gap: 8px; overflow: auto; color: var(--text-muted); font-size: 11px; min-width: 0; }
.stack-breadcrumbs button, .reset-button { color: var(--accent); border: 0; background: none; padding: 6px 0; font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.stack-breadcrumbs button { max-width: 180px; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; }
.stack-breadcrumbs button:disabled { color: var(--text-secondary); cursor: default; }
.reset-button { flex-shrink: 0; }
.zoom-label { padding: 0 12px; overflow-wrap: anywhere; font-size: 11px; line-height: 1.6; color: var(--text-secondary); }
.flame-scroll { overflow: auto; max-height: 520px; padding: 12px 8px; }
.flame-canvas { position: relative; min-width: 400px; }
.flame-frame { position: absolute; display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 25px; border: 1px solid var(--bg-surface); border-radius: 2px; padding: 3px 7px; overflow: hidden; text-align: left; white-space: nowrap; cursor: pointer; color: var(--text-primary); font: 11px var(--font-mono); }
.flame-frame span { overflow: hidden; text-overflow: ellipsis; }
.flame-frame small { font: inherit; font-size: 10px; flex-shrink: 0; }
.cpu-low { background: var(--cpu-low); }
.cpu-medium { background: var(--cpu-medium); }
.cpu-high { background: var(--cpu-high); }
.root-frame { background: var(--bg-raised); }
.flame-frame:hover, .flame-frame.matched { border-color: var(--text-primary); }
.flame-frame:focus-visible { outline: 2px solid var(--text-primary); outline-offset: -2px; z-index: 1; }
.flame-toolbar button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.dimmed { opacity: .3; }
.frame-inspector { display: flex; align-items: center; flex-wrap: wrap; gap: 16px 32px; border-top: 1px solid var(--border-default); padding: 12px 16px; background: var(--bg-raised); }
.inspected-name { flex: 1 1 280px; min-width: 0; color: var(--text-primary); font: 11px var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
dl { display: flex; gap: 32px; margin: 0; font-size: 11px; }
dt { color: var(--text-secondary); margin-bottom: 4px; }
dd { margin: 0; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.flame-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 16px; color: var(--text-secondary); font-size: 10px; border-top: 1px solid var(--border-default); }
.flame-legend span { display: flex; align-items: center; gap: 5px; }
.flame-legend i { display: inline-block; width: 9px; height: 9px; border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border-default)); }
.legend-hint { margin-left: auto; }
@media (pointer: coarse) { .flame-toolbar button { min-height: 44px; } }
</style>
