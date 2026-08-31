<script setup lang="ts">
import { ref } from 'vue'

const model = defineModel<string>({ default: '' })

const DIRECT_FIELDS = [
  'service_name',
  'http_method',
  'http_path',
  'http_status_code',
  'status',
  'environment',
  'host_name',
  'service_version',
]

const open = ref(false)
const customInput = ref('')

function select(field: string) {
  model.value = field
  open.value = false
  customInput.value = ''
}

function clear() {
  model.value = ''
}

function submitCustom() {
  const v = customInput.value.trim()
  if (v) {
    model.value = v.startsWith('attributes.') ? v : `attributes.${v}`
    open.value = false
    customInput.value = ''
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
</script>

<template>
  <div class="gbs" @keydown="handleKeydown">
    <!-- Selected chip -->
    <div v-if="model" class="gbs-chip" @click="clear">
      <span class="gbs-chip-label">group by</span>
      <span class="gbs-chip-value mono">{{ model }}</span>
      <span class="gbs-chip-x">&times;</span>
    </div>

    <!-- Trigger button -->
    <button v-else class="gbs-trigger" @click="open = !open">
      + Group by
    </button>

    <!-- Dropdown -->
    <div v-if="open" class="gbs-dropdown">
      <div class="gbs-group-label">Direct Fields</div>
      <button
        v-for="field in DIRECT_FIELDS"
        :key="field"
        class="gbs-option mono"
        @click="select(field)"
      >{{ field }}</button>

      <div class="gbs-group-label" style="margin-top: 4px">Custom Attribute</div>
      <div class="gbs-custom">
        <span class="gbs-custom-prefix mono text-muted">attributes.</span>
        <input
          v-model="customInput"
          class="gbs-custom-input mono"
          placeholder="user.plan"
          @keydown.enter="submitCustom"
          @keydown.escape.stop="open = false"
        />
      </div>
    </div>

    <!-- Backdrop -->
    <div v-if="open" class="gbs-backdrop" @click="open = false" />
  </div>
</template>

<style scoped src="../styles/components/GroupBySelector.css"></style>
