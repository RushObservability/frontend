<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  groups: Array<{ key: string; count: number }>
}>()

const maxCount = computed(() =>
  props.groups.reduce((max, g) => Math.max(max, g.count), 0)
)

const total = computed(() =>
  props.groups.reduce((sum, g) => sum + g.count, 0)
)
</script>

<template>
  <div class="bar-widget">
    <div v-for="group in groups" :key="group.key" class="bar-row">
      <div class="bar-label mono">{{ group.key || '(empty)' }}</div>
      <div class="bar-track">
        <div
          class="bar-fill"
          :style="{ width: maxCount > 0 ? `${(group.count / maxCount) * 100}%` : '0%' }"
        ></div>
      </div>
      <div class="bar-count mono">{{ group.count.toLocaleString() }}</div>
      <div class="bar-pct text-secondary">
        {{ total > 0 ? ((group.count / total) * 100).toFixed(1) : '0' }}%
      </div>
    </div>
    <div v-if="groups.length === 0" class="empty-state">
      <div class="empty-state-icon">--</div>
      <div>No data</div>
    </div>
  </div>
</template>

<style scoped src="../../styles/widgets/BarWidget.css"></style>
