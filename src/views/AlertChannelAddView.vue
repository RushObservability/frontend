<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import ChannelForm from '../components/ChannelForm.vue'

const api = useApi()
const router = useRouter()

async function handleSave(data: { name: string; channel_type: string; config: Record<string, string> }) {
  try {
    await api.createChannel(data)
    router.push('/alerts')
  } catch { /* error in api.error */ }
}

function handleCancel() {
  router.push('/alerts')
}
</script>

<template>
  <div class="channel-add-page">
    <div class="page-header">
      <div class="page-header-left">
        <router-link to="/alerts" class="back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </router-link>
        <h1 class="page-title">Add Notification Channel</h1>
      </div>
    </div>

    <ChannelForm
      @save="handleSave"
      @cancel="handleCancel"
    />
  </div>
</template>

<style scoped src="../styles/views/AlertChannelAddView.css"></style>
