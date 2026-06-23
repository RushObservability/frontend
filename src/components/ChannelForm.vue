<script setup lang="ts">
import { ref, computed } from 'vue'
import type { NotificationChannel, ChannelType } from '../types'

const props = defineProps<{
  channel?: NotificationChannel
}>()

const emit = defineEmits<{
  save: [data: { name: string; channel_type: string; config: Record<string, any> }]
  cancel: []
}>()

const name = ref(props.channel?.name || '')
const channelType = ref<ChannelType>(props.channel?.channel_type || 'slack')

// Slack Webhook config
const slackWebhookUrl = ref(props.channel?.config?.webhook_url || props.channel?.config?.url || '')

// Slack App config
const slackAppToken = ref(props.channel?.config?.token || '')
const slackAppChannel = ref(props.channel?.config?.channel || '')
const slackAppUsername = ref(props.channel?.config?.username || '')

// Email config
const emailRecipients = ref(props.channel?.config?.recipients || props.channel?.config?.to || '')

// Webhook config
const webhookUrl = ref(props.channel?.config?.url || '')
const webhookMethod = ref(props.channel?.config?.method || 'POST')
const webhookHeaders = ref(
  props.channel?.config?.headers
    ? JSON.stringify(props.channel.config.headers, null, 2)
    : ''
)

// PagerDuty config
const pdRoutingKey = ref(props.channel?.config?.routing_key || '')

// OpsGenie config
const ogApiKey = ref(props.channel?.config?.api_key || '')
const ogResponders = ref(
  props.channel?.config?.responders
    ? JSON.stringify(props.channel.config.responders, null, 2)
    : ''
)

// Discord config
const discordWebhookUrl = ref(props.channel?.config?.webhook_url || '')

// Alertmanager config
const alertmanagerUrl = ref(props.channel?.config?.url || '')
const alertmanagerLabels = ref(
  props.channel?.config?.labels
    ? JSON.stringify(props.channel.config.labels, null, 2)
    : ''
)

const channelTypes = [
  { value: 'slack',        label: 'Slack Webhook', icon: '#',  desc: 'Incoming webhook URL from Slack' },
  { value: 'slack_app',    label: 'Slack App',     icon: 'S',  desc: 'Post via Slack Bot Token (chat.postMessage)' },
  { value: 'discord',      label: 'Discord',       icon: 'D',  desc: 'Discord webhook for server notifications' },
  { value: 'webhook',      label: 'Webhook',       icon: '{}', desc: 'POST JSON to any HTTPS endpoint' },
  { value: 'alertmanager', label: 'Alertmanager',  icon: 'AM', desc: 'Push to Prometheus Alertmanager API' },
  { value: 'email',        label: 'Email',         icon: '@',  desc: 'Send emails via SMTP', comingSoon: true },
  { value: 'pagerduty',    label: 'PagerDuty',     icon: 'PD', desc: 'Create incidents via Events API v2', comingSoon: true },
  { value: 'opsgenie',     label: 'OpsGenie',      icon: 'OG', desc: 'Create alerts via OpsGenie API', comingSoon: true },
]

const isValid = computed(() => {
  if (!name.value.trim()) return false
  switch (channelType.value) {
    case 'slack':        return !!slackWebhookUrl.value.trim()
    case 'slack_app':    return !!slackAppToken.value.trim() && !!slackAppChannel.value.trim()
    case 'discord':      return !!discordWebhookUrl.value.trim()
    case 'webhook':      return !!webhookUrl.value.trim()
    case 'alertmanager': return !!alertmanagerUrl.value.trim()
    case 'email':        return !!emailRecipients.value.trim()
    case 'pagerduty':    return !!pdRoutingKey.value.trim()
    case 'opsgenie':     return !!ogApiKey.value.trim()
    default: return false
  }
})

const validationHint = computed(() => {
  if (isValid.value) return ''
  if (!name.value.trim()) return 'Enter a name to enable Save.'
  switch (channelType.value) {
    case 'slack':        return 'Enter the Slack webhook URL.'
    case 'slack_app':    return !slackAppToken.value.trim() ? 'Enter the bot token.' : 'Enter the channel.'
    case 'discord':      return 'Enter the Discord webhook URL.'
    case 'webhook':      return 'Enter the webhook URL.'
    case 'alertmanager': return 'Enter the Alertmanager URL.'
    case 'email':        return 'Enter at least one recipient.'
    case 'pagerduty':    return 'Enter the routing key.'
    case 'opsgenie':     return 'Enter the API key.'
    default:             return 'Select a channel type.'
  }
})

function buildConfig(): Record<string, any> {
  switch (channelType.value) {
    case 'slack':
      return { webhook_url: slackWebhookUrl.value.trim() }
    case 'slack_app': {
      const config: Record<string, any> = {
        token: slackAppToken.value.trim(),
        channel: slackAppChannel.value.trim(),
      }
      if (slackAppUsername.value.trim()) config.username = slackAppUsername.value.trim()
      return config
    }
    case 'discord':
      return { webhook_url: discordWebhookUrl.value.trim() }
    case 'email':
      return { recipients: emailRecipients.value.trim() }
    case 'webhook': {
      const config: Record<string, any> = {
        url: webhookUrl.value.trim(),
        method: webhookMethod.value,
      }
      if (webhookHeaders.value.trim()) {
        try {
          config.headers = JSON.parse(webhookHeaders.value)
        } catch { /* ignore invalid JSON */ }
      }
      return config
    }
    case 'alertmanager': {
      const config: Record<string, any> = { url: alertmanagerUrl.value.trim() }
      if (alertmanagerLabels.value.trim()) {
        try {
          config.labels = JSON.parse(alertmanagerLabels.value)
        } catch { /* ignore invalid JSON */ }
      }
      return config
    }
    case 'pagerduty':
      return { routing_key: pdRoutingKey.value.trim() }
    case 'opsgenie': {
      const config: Record<string, any> = { api_key: ogApiKey.value.trim() }
      if (ogResponders.value.trim()) {
        try {
          config.responders = JSON.parse(ogResponders.value)
        } catch { /* ignore invalid JSON */ }
      }
      return config
    }
    default:
      return {}
  }
}

function save() {
  if (!isValid.value) return
  emit('save', {
    name: name.value.trim(),
    channel_type: channelType.value,
    config: buildConfig(),
  })
}
</script>

<template>
  <div class="channel-form card fade-in">
    <div class="form-header">{{ channel ? 'Edit Channel' : 'Add Channel' }}</div>
    <div class="form-body">
      <div class="form-group">
        <label class="form-label">Name</label>
        <input v-model="name" class="form-input" placeholder="Production Slack" />
      </div>

      <!-- Channel type picker cards -->
      <div class="form-group">
        <label class="form-label">Type</label>
        <div class="channel-type-grid">
          <button
            v-for="ct in channelTypes"
            :key="ct.value"
            class="channel-type-card"
            :class="{ selected: channelType === ct.value, 'coming-soon': ct.comingSoon }"
            :disabled="ct.comingSoon"
            @click="ct.comingSoon || (channelType = ct.value as ChannelType)"
            type="button"
          >
            <span v-if="ct.comingSoon" class="ct-soon-badge">Coming soon</span>
            <span class="ct-icon mono">{{ ct.icon }}</span>
            <span class="ct-label">{{ ct.label }}</span>
            <span class="ct-desc text-muted">{{ ct.desc }}</span>
          </button>
        </div>
      </div>

      <!-- Slack Webhook config -->
      <template v-if="channelType === 'slack'">
        <div class="form-group">
          <label class="form-label">Webhook URL</label>
          <input v-model="slackWebhookUrl" class="form-input mono" placeholder="https://hooks.slack.com/services/T00/B00/xxx" />
          <span class="form-hint text-muted">Incoming Webhook URL from your Slack app settings</span>
        </div>
      </template>

      <!-- Slack App config -->
      <template v-if="channelType === 'slack_app'">
        <div class="form-group">
          <label class="form-label">Bot Token</label>
          <input v-model="slackAppToken" class="form-input mono" placeholder="Bot User OAuth Token (xoxb-…)" type="password" autocomplete="off" />
          <span class="form-hint text-muted">Bot User OAuth Token from your Slack App — requires <code>chat:write</code> scope</span>
        </div>
        <div class="form-group">
          <label class="form-label">Channel</label>
          <input v-model="slackAppChannel" class="form-input mono" placeholder="#alerts or C0123456789" />
          <span class="form-hint text-muted">Channel name (with #) or channel ID</span>
        </div>
        <div class="form-group">
          <label class="form-label">Bot Name (optional)</label>
          <input v-model="slackAppUsername" class="form-input" placeholder="Rush Alerts" />
        </div>
      </template>

      <!-- Discord config -->
      <template v-if="channelType === 'discord'">
        <div class="form-group">
          <label class="form-label">Webhook URL</label>
          <input v-model="discordWebhookUrl" class="form-input mono" placeholder="https://discord.com/api/webhooks/000000000000/xxxx" />
          <span class="form-hint text-muted">From Discord channel settings → Integrations → Webhooks</span>
        </div>
      </template>

      <!-- Email config -->
      <template v-if="channelType === 'email'">
        <div class="form-group">
          <label class="form-label">Recipients (comma-separated)</label>
          <input v-model="emailRecipients" class="form-input mono" placeholder="oncall@company.com, lead@company.com" />
        </div>
      </template>

      <!-- Webhook config -->
      <template v-if="channelType === 'webhook'">
        <div class="form-group">
          <label class="form-label">URL</label>
          <input v-model="webhookUrl" class="form-input mono" placeholder="https://internal.company.com/hooks/alerts" />
        </div>
        <div class="form-group">
          <label class="form-label">Method</label>
          <select v-model="webhookMethod" class="form-input mono">
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Headers (JSON, optional)</label>
          <textarea v-model="webhookHeaders" class="form-input mono form-textarea" placeholder='{"Authorization": "Bearer xxx"}' rows="3"></textarea>
        </div>
      </template>

      <!-- Alertmanager config -->
      <template v-if="channelType === 'alertmanager'">
        <div class="form-group">
          <label class="form-label">Alertmanager URL</label>
          <input v-model="alertmanagerUrl" class="form-input mono" placeholder="https://alertmanager.internal.company.com" />
          <span class="form-hint text-muted">Base URL — alerts are posted to <code>{url}/api/v2/alerts</code></span>
        </div>
        <div class="form-group">
          <label class="form-label">Extra Labels (JSON, optional)</label>
          <textarea v-model="alertmanagerLabels" class="form-input mono form-textarea" placeholder='{"env": "production", "team": "platform"}' rows="3"></textarea>
          <span class="form-hint text-muted">Merged into the labels of every alert sent to Alertmanager</span>
        </div>
      </template>

      <!-- PagerDuty config -->
      <template v-if="channelType === 'pagerduty'">
        <div class="form-group">
          <label class="form-label">Routing Key</label>
          <input v-model="pdRoutingKey" class="form-input mono" placeholder="R0xxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          <span class="form-hint text-muted">Integration key from PagerDuty Events API v2</span>
        </div>
      </template>

      <!-- OpsGenie config -->
      <template v-if="channelType === 'opsgenie'">
        <div class="form-group">
          <label class="form-label">API Key</label>
          <input v-model="ogApiKey" class="form-input mono" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
        </div>
        <div class="form-group">
          <label class="form-label">Responders (JSON array, optional)</label>
          <textarea v-model="ogResponders" class="form-input mono form-textarea" placeholder='[{"type": "team", "name": "platform-oncall"}]' rows="3"></textarea>
        </div>
      </template>
    </div>
    <div class="form-actions">
      <span v-if="validationHint" class="form-hint text-muted channel-form-hint">{{ validationHint }}</span>
      <button class="btn btn-secondary" @click="emit('cancel')">Cancel</button>
      <button class="btn btn-primary" :disabled="!isValid" @click="save">Save</button>
    </div>
  </div>
</template>

<style scoped src="../styles/components/ChannelForm.css"></style>
