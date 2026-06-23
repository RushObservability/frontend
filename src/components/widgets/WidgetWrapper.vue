<script setup lang="ts">
import PanelCard from '../PanelCard.vue'

defineProps<{
  title: string
  description?: string
  unit?: string
  loading?: boolean
  error?: string | null
  editMode?: boolean
}>()

defineEmits<{
  edit: []
  duplicate: []
  remove: []
  dragstart: [e: PointerEvent]
  resizestart: [e: PointerEvent]
}>()
</script>

<template>
  <div class="widget-wrap" :class="{ 'widget-edit-mode': editMode }">
    <PanelCard :title="title" :description="description" :unit="unit" :loading="loading" :error="error">
      <template v-if="editMode" #actions>
        <div class="widget-actions">
          <div
            class="drag-handle"
            title="Drag to reposition"
            @pointerdown.prevent="$emit('dragstart', $event)"
          >&#9776;</div>
          <button class="widget-btn" title="Edit" @click="$emit('edit')">&#9998;</button>
          <button class="widget-btn" title="Duplicate" @click="$emit('duplicate')">&#10697;</button>
          <button class="widget-btn widget-btn-danger" title="Remove" @click="$emit('remove')">&times;</button>
        </div>
      </template>
      <slot />
    </PanelCard>
    <div
      v-if="editMode"
      class="resize-handle"
      title="Drag to resize"
      @pointerdown.prevent="$emit('resizestart', $event)"
    >&#9698;</div>
  </div>
</template>

<style scoped src="../../styles/widgets/WidgetWrapper.css"></style>
