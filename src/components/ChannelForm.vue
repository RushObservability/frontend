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
const pdRegion = ref(props.channel?.config?.region || 'us')
const pdSeverity = ref(props.channel?.config?.severity || props.channel?.config?.severity_mapping?.critical || 'critical')

// Rootly Generic Webhook Alert Source, authenticated with its source secret.
const rootlyUrl = ref(props.channel?.config?.url || (props.channel ? '' : 'https://webhooks.rootly.com/webhooks/incoming/generic_webhooks'))
const rootlyToken = ref(props.channel?.config?.token || '')

// Discord config
const discordWebhookUrl = ref(props.channel?.config?.webhook_url || '')

// Alertmanager config
const alertmanagerUrl = ref(props.channel?.config?.url || '')
const alertmanagerLabels = ref(
  props.channel?.config?.labels
    ? JSON.stringify(props.channel.config.labels, null, 2)
    : ''
)

// Secret values are deliberately never returned by the API. These flags keep
// an existing channel editable without exposing its credential; submitting an
// empty secret field preserves the stored value server-side.
const slackWebhookConfigured = !!(props.channel?.config?.webhook_url_configured || props.channel?.config?.url_configured)
const slackAppTokenConfigured = !!props.channel?.config?.token_configured
const webhookUrlConfigured = !!props.channel?.config?.url_configured
const pdRoutingKeyConfigured = !!props.channel?.config?.routing_key_configured
const rootlyUrlConfigured = props.channel?.channel_type === 'rootly' && !!props.channel.config?.url_configured
const rootlyTokenConfigured = props.channel?.channel_type === 'rootly' && !!props.channel.config?.token_configured
const discordWebhookConfigured = !!props.channel?.config?.webhook_url_configured
const alertmanagerUrlConfigured = !!props.channel?.config?.url_configured

const channelTypes = [
  { value: 'slack',        label: 'Slack Webhook', icon: '#',  desc: 'Incoming webhook URL from Slack' },
  { value: 'slack_app',    label: 'Slack App',     icon: 'S',  desc: 'Post via Slack Bot Token (chat.postMessage)' },
  { value: 'discord',      label: 'Discord',       icon: 'D',  desc: 'Discord webhook for server notifications' },
  { value: 'webhook',      label: 'Webhook',       icon: '{}', desc: 'POST JSON to any HTTPS endpoint' },
  { value: 'alertmanager', label: 'Alertmanager',  icon: 'AM', desc: 'Push to Prometheus Alertmanager API' },
  { value: 'email',        label: 'Email',         icon: '@',  desc: 'Send emails via SMTP', comingSoon: true },
  { value: 'pagerduty',    label: 'PagerDuty',     icon: 'PD', desc: 'Send alerts and recoveries via Events API v2' },
  { value: 'rootly',       label: 'Rootly',        icon: 'R', desc: 'Send alerts and recoveries to Rootly On-Call' },
]

function selectChannelType(type: ChannelType) {
  channelType.value = type
  // Give a new channel an editable name as soon as its destination is known.
  // Never overwrite a name the user entered or an existing channel's name.
  if (!props.channel && !name.value.trim()) {
    name.value = channelTypes.find(ct => ct.value === type)?.label || ''
  }
}

const isValid = computed(() => {
  if (!name.value.trim()) return false
  switch (channelType.value) {
    case 'slack':        return !!slackWebhookUrl.value.trim() || slackWebhookConfigured
    case 'slack_app':    return (!!slackAppToken.value.trim() || slackAppTokenConfigured) && !!slackAppChannel.value.trim()
    case 'discord':      return !!discordWebhookUrl.value.trim() || discordWebhookConfigured
    case 'webhook':      return !!webhookUrl.value.trim() || webhookUrlConfigured
    case 'alertmanager': return !!alertmanagerUrl.value.trim() || alertmanagerUrlConfigured
    case 'email':        return !!emailRecipients.value.trim()
    case 'pagerduty':    return !!pdRoutingKey.value.trim() || pdRoutingKeyConfigured
    case 'rootly':       return (!!rootlyUrl.value.trim() || rootlyUrlConfigured) && (!!rootlyToken.value.trim() || rootlyTokenConfigured)
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
    case 'rootly':       return !rootlyUrl.value.trim() && !rootlyUrlConfigured ? 'Enter the Rootly webhook URL.' : 'Enter the Rootly bearer secret.'
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
      return { routing_key: pdRoutingKey.value.trim(), region: pdRegion.value, severity: pdSeverity.value }
    case 'rootly':
      return { url: rootlyUrl.value.trim(), token: rootlyToken.value.trim() }
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
            :disabled="ct.comingSoon || (!!channel && channelType !== ct.value)"
            @click="ct.comingSoon || selectChannelType(ct.value as ChannelType)"
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
          <label class="form-label" for="pd-routing-key">Integration key</label>
          <input id="pd-routing-key" v-model="pdRoutingKey" class="form-input mono" type="password" autocomplete="new-password" :placeholder="pdRoutingKeyConfigured ? 'Configured. Leave blank to keep the saved key.' : 'Events API v2 integration key'" aria-describedby="pd-key-help" />
          <span id="pd-key-help" class="form-hint text-muted">Use the integration's routing key, not a PagerDuty REST API token.</span>
        </div>
        <div class="form-group">
          <label class="form-label" for="pd-region">Account region</label>
          <select id="pd-region" v-model="pdRegion" class="form-input" aria-describedby="pd-region-help">
            <option value="us">United States</option>
            <option value="eu">Europe</option>
          </select>
          <span id="pd-region-help" class="form-hint text-muted">Choose Europe if your PagerDuty address contains .eu.pagerduty.com.</span>
        </div>
        <div class="form-group">
          <label class="form-label" for="pd-severity">Alert severity</label>
          <select id="pd-severity" v-model="pdSeverity" class="form-input" aria-describedby="pd-severity-help">
            <option value="critical">Critical</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <span id="pd-severity-help" class="form-hint text-muted">Applied to alerts sent through this channel. PagerDuty's service settings control notification urgency.</span>
        </div>
        <div class="channel-setup">
          <strong>Connect a PagerDuty service</strong>
          <p>In PagerDuty, open Services → Service Directory → your service → Integrations. Add an Events API V2 integration and copy its Integration Key above.</p>
          <p>Rush sends trigger events when a rule fires and resolve events when it recovers. Repeated alerts use the same deduplication key, with separate keys for each monitor group.</p>
          <p>Save, then use Test on the channel row. This sends a real test alert and may page responders. Resolve the test alert in PagerDuty when finished.</p>
          <a href="https://support.pagerduty.com/main/docs/services-and-integrations" target="_blank" rel="noopener noreferrer">PagerDuty setup documentation ↗</a>
        </div>
      </template>

      <!-- Rootly config -->
      <template v-if="channelType === 'rootly'">
        <div class="form-group">
          <label class="form-label" for="rootly-webhook-url">Rootly webhook URL</label>
          <input id="rootly-webhook-url" v-model="rootlyUrl" class="form-input mono" type="url" :placeholder="rootlyUrlConfigured ? 'Configured. Leave blank to keep the saved URL.' : 'https://webhooks.rootly.com/webhooks/incoming/generic_webhooks'" aria-describedby="rootly-url-help" />
          <span id="rootly-url-help" class="form-hint text-muted">Use the URL from your Generic Webhook source. Remove any ?secret= query parameter and enter the secret below.</span>
        </div>
        <div class="form-group">
          <label class="form-label" for="rootly-bearer-secret">Bearer secret</label>
          <input id="rootly-bearer-secret" v-model="rootlyToken" class="form-input mono" type="password" autocomplete="new-password" :placeholder="rootlyTokenConfigured ? 'Configured. Leave blank to keep the saved secret.' : 'Secret from the Rootly alert source'" aria-describedby="rootly-secret-help" />
          <span id="rootly-secret-help" class="form-hint text-muted">The source's bearer secret, not an account API key. Sent in the Authorization header.</span>
        </div>
        <div class="channel-setup">
          <strong>Set up the Rootly source</strong>
          <p>Create a Generic Webhook Alert Source in Rootly, then configure these payload mappings:</p>
          <dl class="rootly-mappings">
            <div><dt>Title</dt><dd><code>$.title</code></dd></div>
            <div><dt>Description</dt><dd><code>$.description</code></dd></div>
            <div><dt>External identifier / deduplication key</dt><dd><code>$.external_id</code></dd></div>
            <div><dt>State</dt><dd><code>$.state</code></dd></div>
          </dl>
          <p>Enable deduplication and auto-resolution with <code>resolved</code> as the recovery value. Active alerts use <code>triggered</code>.</p>
          <p>Route this source using Rootly Alert Routes, or paste its fixed-target <code>/notify/&lt;type&gt;/&lt;id&gt;</code> URL above.</p>
          <p>Save, then use Test on the channel row. This sends a real test alert and may page responders.</p>
          <a href="https://docs.rootly.com/integrations/generic-webhook-alert-source/generic-webhook-alert-source" target="_blank" rel="noopener noreferrer">Rootly setup documentation ↗</a>
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
