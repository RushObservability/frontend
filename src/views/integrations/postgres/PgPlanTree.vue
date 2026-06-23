<script setup lang="ts">
// Recursive EXPLAIN plan node. `node` is a Postgres plan object (the value of a
// "Plan" / nested "Plans" entry). Self-references by filename for recursion.
defineProps<{ node: any; maxCost: number; depth?: number }>()

const fmt = (n: number | undefined) =>
  (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
</script>

<template>
  <div class="plan-node" :class="{ child: (depth || 0) > 0 }">
    <div class="pn-card" :class="{ scan: node['Node Type'] === 'Seq Scan' }">
      <div class="pn-bar"><div class="pn-bar-fill" :style="{ width: (maxCost > 0 ? Math.max(2, (node['Total Cost'] / maxCost) * 100) : 2) + '%' }"></div></div>
      <div class="pn-row">
        <span class="pn-type">{{ node['Node Type'] }}</span>
        <span v-if="node['Relation Name']" class="pn-rel">on <b>{{ node['Relation Name'] }}</b></span>
        <span v-if="node['Index Name']" class="pn-rel">using <b>{{ node['Index Name'] }}</b></span>
        <span v-if="node['Node Type'] === 'Seq Scan'" class="pn-flag">SEQ SCAN</span>
        <span class="pn-spacer"></span>
        <span class="pn-metric">cost {{ fmt(node['Startup Cost']) }}…{{ fmt(node['Total Cost']) }}</span>
        <span class="pn-metric">rows {{ (node['Plan Rows'] ?? 0).toLocaleString() }}</span>
        <span class="pn-metric">w {{ node['Plan Width'] ?? 0 }}</span>
      </div>
      <div v-if="node['Index Cond']" class="pn-detail">Index Cond: <code>{{ node['Index Cond'] }}</code></div>
      <div v-if="node['Filter']" class="pn-detail">Filter: <code>{{ node['Filter'] }}</code></div>
      <div v-if="node['Hash Cond']" class="pn-detail">Hash Cond: <code>{{ node['Hash Cond'] }}</code></div>
    </div>
    <div v-if="node['Plans'] && node['Plans'].length" class="pn-children">
      <PgPlanTree v-for="(c, i) in node['Plans']" :key="i" :node="c" :max-cost="maxCost" :depth="(depth || 0) + 1" />
    </div>
  </div>
</template>

<style scoped>
.plan-node.child { margin-left: 18px; border-left: 1px solid var(--border-subtle); padding-left: 12px; }
.pn-card {
  position: relative; overflow: hidden;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm, 4px);
  padding: 8px 10px;
  margin: 6px 0;
}
.pn-card.scan { border-color: color-mix(in srgb, var(--amber, #f59e0b) 45%, var(--border-subtle)); }
.pn-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: transparent; }
.pn-bar-fill { height: 100%; background: color-mix(in srgb, var(--amber, #f59e0b) 60%, transparent); }
.pn-row { display: flex; align-items: center; gap: 8px; font-size: 13px; flex-wrap: wrap; }
.pn-type { font-weight: 600; color: var(--text-primary); }
.pn-rel { color: var(--text-secondary); font-size: 12px; }
.pn-rel b { font-family: var(--font-mono, monospace); color: var(--text-primary); font-weight: 500; }
.pn-flag { font-size: 9px; font-weight: 700; letter-spacing: 0.05em; color: var(--amber, #f59e0b); background: color-mix(in srgb, var(--amber, #f59e0b) 16%, transparent); padding: 1px 5px; border-radius: 3px; }
.pn-spacer { flex: 1; }
.pn-metric { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text-tertiary); white-space: nowrap; }
.pn-detail { font-size: 11.5px; color: var(--text-tertiary); margin-top: 4px; }
.pn-detail code { font-family: var(--font-mono, monospace); color: var(--text-secondary); }
</style>
