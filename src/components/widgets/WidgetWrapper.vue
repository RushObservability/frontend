<script setup lang="ts">
import PanelCard from '../PanelCard.vue'

defineProps<{
  title: string
  type?: string
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
          <span v-if="type" class="widget-type">{{ type }}</span>
          <div
            class="drag-handle"
            title="Drag to reposition"
            aria-label="Drag panel to reposition"
            @pointerdown.prevent="$emit('dragstart', $event)"
          >⠿</div>
          <button class="widget-btn" title="Edit panel" @click="$emit('edit')"><span class="widget-btn-glyph">✎</span><span class="widget-btn-label">Edit</span></button>
          <button class="widget-btn" title="Duplicate panel" @click="$emit('duplicate')"><span class="widget-btn-glyph">＋</span><span class="widget-btn-label">Clone</span></button>
          <button class="widget-btn widget-btn-danger" title="Remove panel" @click="$emit('remove')"><span class="widget-btn-glyph">×</span><span class="widget-btn-label">Remove</span></button>
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
