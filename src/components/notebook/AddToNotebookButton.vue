<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../../composables/useAuth'
import type { NotebookCellDraft } from '../../types'
import AddToNotebookDialog from './AddToNotebookDialog.vue'

/** `build` copies the view's current query when the button is clicked. */
defineProps<{ build: () => NotebookCellDraft }>()

const { canWrite } = useAuth()
const draft = ref<NotebookCellDraft | null>(null)
</script>

<template>
  <button v-if="canWrite" type="button" class="add-to-notebook" title="Add this view to an incident notebook" @click="draft = build()">
    <span aria-hidden="true">▤</span> Add to notebook
  </button>
  <AddToNotebookDialog :draft="draft" @close="draft = null" />
</template>

<style scoped>
.add-to-notebook {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.add-to-notebook:hover { border-color: var(--border-strong); color: var(--text-primary); }
.add-to-notebook:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
