<script setup lang="ts">
import { computed } from 'vue'
import type { GroupResult } from '../types'

const props = defineProps<{
  groups: GroupResult[]
  field: string
  loading: boolean
}>()

const emit = defineEmits<{
  'add-filter': [field: string, value: string]
}>()

const totalCount = computed(() => props.groups.reduce((s, g) => s + g.count, 0))
const maxCount = computed(() => Math.max(...props.groups.map(g => g.count), 1))
</script>

<template>
  <div class="breakdown card fade-in">
    <div class="bd-header">
      <span class="bd-title mono">{{ field }}</span>
      <span class="bd-total mono text-muted">{{ totalCount.toLocaleString() }} total</span>
    </div>

    <div v-if="loading" class="bd-loading">
      <span class="bd-spinner">&#9676;</span>
      <span class="text-muted">Grouping...</span>
    </div>

    <div v-else-if="!groups.length" class="bd-empty text-muted">
      No groups found
    </div>

    <div v-else class="bd-rows">
      <div
        v-for="group in groups"
        :key="group.key"
        class="bd-row"
        @click="emit('add-filter', field, group.key)"
      >
        <div class="bd-label mono">{{ group.key || '(empty)' }}</div>
        <div class="bd-bar-track">
          <div
            class="bd-bar-fill"
            :style="{ width: `${(group.count / maxCount) * 100}%` }"
          />
        </div>
        <div class="bd-count mono">{{ group.count.toLocaleString() }}</div>
        <div class="bd-pct mono text-muted">{{ totalCount ? ((group.count / totalCount) * 100).toFixed(1) : '0.0' }}%</div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../styles/components/BreakdownPanel.css"></style>
