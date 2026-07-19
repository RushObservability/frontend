<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import { useFeatures } from '../composables/useFeatures'
import { useTenant } from '../composables/useTenant'
import { apiBaseUrl } from '../config'
import type { ApiKey, ApiKeyCreated, ServiceLink, CustomSkill, Group, Tenant, TenantRetention, TenantSignals, GlobalRetention, User, SsoProvider, IdpGroupMapping, SetupToken, NotificationChannel, MetricFirewallRule, MetricFirewallInput, LicenseStatus } from '../types'
import SkillEditDialog from '../components/SkillEditDialog.vue'
import ChannelForm from '../components/ChannelForm.vue'
import RegexHelp from '../components/RegexHelp.vue'
import StatsView from './StatsView.vue'
import { getAddon } from '../integrations/catalog'
import { isAddonEnabled, setAddonEnabled, addonNamespace, saveAddonNamespace, namespaceValid } from '../composables/useIntegrationEnabled'

const api = useApi()
const { user: currentUser } = useAuth()
const { features, loadFeatures } = useFeatures()
const { activeTenantName } = useTenant()

// Whether an integration is enabled at the platform level (Helm chart / env →
// /api/v1/features). Free integrations can only be toggled here when this is on;
// otherwise the card shows how to enable it in the Helm chart.
const featureOn = (k: string) => !!(features.value as Record<string, boolean | undefined>)[k]

// ── Integrations (ArgoCD enable/disable + namespace) ──
// Toggling here drives the Integrations rail/nav live via the shared store; a
// disabled add-on is hidden from the Integrations area entirely.
const argoAddon = getAddon('argocd')!
const argocdEnabled = ref(isAddonEnabled(argoAddon))
const argocdNamespace = ref(addonNamespace(argoAddon))
const integrationsSaved = ref(false)
const integrationsErr = ref('')
function saveIntegrations() {
  integrationsErr.value = ''
  if (!namespaceValid(argocdNamespace.value)) {
    integrationsErr.value = 'Invalid Kubernetes namespace name.'
    return
  }
  setAddonEnabled(argoAddon, argocdEnabled.value)
  saveAddonNamespace(argoAddon, argocdNamespace.value)
  integrationsSaved.value = true
  setTimeout(() => { integrationsSaved.value = false }, 2000)
}

// ── Integrations (FluxCD v2 enable/disable + namespace) ──
const fluxAddon = getAddon('fluxcd')!
const fluxcdEnabled = ref(isAddonEnabled(fluxAddon))
const fluxcdNamespace = ref(addonNamespace(fluxAddon))
const fluxSaved = ref(false)
const fluxErr = ref('')
function saveFlux() {
  fluxErr.value = ''
  if (!namespaceValid(fluxcdNamespace.value)) {
    fluxErr.value = 'Invalid Kubernetes namespace name.'
    return
  }
  setAddonEnabled(fluxAddon, fluxcdEnabled.value)
  saveAddonNamespace(fluxAddon, fluxcdNamespace.value)
  fluxSaved.value = true
  setTimeout(() => { fluxSaved.value = false }, 2000)
}

// ── Integrations (Kubernetes read-only browser; cluster-wide, no namespace) ──
const k8sAddon = getAddon('kubernetes')!
const kubernetesEnabled = ref(isAddonEnabled(k8sAddon))
const k8sSaved = ref(false)
function saveKubernetes() {
  setAddonEnabled(k8sAddon, kubernetesEnabled.value)
  k8sSaved.value = true
  setTimeout(() => { k8sSaved.value = false }, 2000)
}

// ── Tab navigation ──
type TabId = 'keys' | 'auth' | 'links' | 'integrations' | 'agent' | 'tenants' | 'retention' | 'groups' | 'users' | 'alerting' | 'general' | 'firewall' | 'license' | 'stats'
type AgentSubtabId = 'access' | 'models' | 'limits' | 'skills'
interface TabDef {
  id: TabId
  label: string
  hint: string
  group: string
}
const tabs: TabDef[] = [
  { id: 'general',      label: 'General',       group: 'Workspace',         hint: 'Workspace-wide preferences and defaults.' },
  { id: 'license',      label: 'License',       group: 'Workspace',         hint: 'License status and entitled add-ons. Set RUSH_LICENSE_KEY to license this instance.' },
  { id: 'integrations', label: 'Integrations',  group: 'Workspace',         hint: 'Connect external tools and observability add-ons.' },
  { id: 'agent',        label: 'AI Agent',      group: 'Workspace',         hint: 'Custom investigation playbooks the SRE agent loads on demand.' },
  { id: 'users',        label: 'Users',         group: 'Access & Identity', hint: 'Manage local user accounts for authentication and access control.' },
  { id: 'groups',       label: 'Groups',        group: 'Access & Identity', hint: 'Manage permission groups that bundle scopes, permissions, and tenant bindings.' },
  { id: 'auth',         label: 'Authentication', group: 'Access & Identity', hint: 'Configure authentication methods — local accounts and single sign-on.' },
  { id: 'keys',         label: 'API Keys',      group: 'Access & Identity', hint: 'Tokens for programmatic access to the Rush API.' },
  { id: 'stats',        label: 'Stats',         group: 'Data & Routing',    hint: 'Storage, cardinality, and ingest/usage stats across metrics, APM, logs, and tenants.' },
  { id: 'tenants',      label: 'Tenants',       group: 'Data & Routing',    hint: 'Manage tenant isolation boundaries for multi-team or multi-customer deployments.' },
  { id: 'retention',    label: 'Retention',     group: 'Data & Routing',    hint: 'Global data retention caps per signal. Tenants cannot exceed these maximums.' },
  { id: 'links',        label: 'Service Links', group: 'Data & Routing',    hint: 'Map services to GitHub repos for code-aware investigations.' },
  { id: 'alerting',     label: 'Alerting',      group: 'Data & Routing',    hint: 'Notification channels for alert delivery — Slack, Discord, webhooks, and more.' },
  { id: 'firewall',     label: 'Metric Firewall', group: 'Data & Routing',  hint: 'Block metric series or drop labels at ingest by name or label (literal or regex).' },
]
const GROUP_ORDER = ['Workspace', 'Access & Identity', 'Data & Routing']
const groupedTabs = computed(() =>
  GROUP_ORDER.map(name => ({ name, items: tabs.filter(t => t.group === name) }))
)
const orderedTabs = computed(() => groupedTabs.value.flatMap(g => g.items))

// ── Integrations: overview table + per-integration deep-linkable pages ──
// `#integrations` shows the overview table; `#integrations/<key>` opens one
// integration's own page. The rail's "Integrations" item expands into the same
// list as a second-level menu.
const integrationsMeta = [
  { key: 'postgresql', label: 'PostgreSQL', desc: 'Database health, query workload, schema, and maintenance.' },
  { key: 'argocd', label: 'ArgoCD', desc: 'Application health & sync status from ArgoCD.' },
  { key: 'fluxcd', label: 'FluxCD', desc: 'Flux v2 Kustomizations, HelmReleases, and Sources.' },
  { key: 'kubernetes', label: 'Kubernetes', desc: 'Read-only browser for cluster workloads & resources.' },
  { key: 'cloudwatch', label: 'CloudWatch Logs', desc: 'Ingest AWS CloudWatch Logs via Kinesis Data Firehose.' },
]
// The rail sub-menu reuses the same list (needs key + label).
const integrationSubItems = integrationsMeta
const integrationsExpanded = ref(false)
const activeIntegration = ref<string>('') // '' = overview table
const license = ref<LicenseStatus | null>(null)
const licenseLoading = ref(false)

// Status per integration: helm-gated ones (argocd/fluxcd/kubernetes) are
// "unavailable" unless their Helm feature flag is on; licensed add-ons are
// enabled when the server reports the required entitlement.
function integrationStatus(key: string): 'enabled' | 'disabled' | 'unavailable' {
  if (key === 'postgresql') {
    return license.value?.valid && license.value.entitlements.includes('postgres') ? 'enabled' : 'unavailable'
  }
  if (key === 'cloudwatch') return cloudwatchEnabled.value ? 'enabled' : 'disabled'
  if (!featureOn(key)) return 'unavailable'
  const en = key === 'argocd' ? argocdEnabled.value
    : key === 'fluxcd' ? fluxcdEnabled.value
    : kubernetesEnabled.value
  return en ? 'enabled' : 'disabled'
}
const statusLabels: Record<string, string> = {
  enabled: 'Enabled', disabled: 'Disabled', unavailable: 'Unavailable',
}
const integrationRows = computed(() => integrationsMeta.map(m => {
  const status = integrationStatus(m.key)
  return { ...m, status, statusLabel: statusLabels[status] }
}))

// Click the parent / "all integrations": show the overview table.
function selectIntegrations() {
  activeTab.value = 'integrations'
  integrationsExpanded.value = true
  activeIntegration.value = ''
  navHash('#integrations')
}
// Open one integration's own page.
function selectIntegration(key: string) {
  activeTab.value = 'integrations'
  integrationsExpanded.value = true
  activeIntegration.value = key
  navHash(`#integrations/${key}`)
}

// ── License ──
async function loadLicense() {
  licenseLoading.value = true
  try { license.value = await api.getLicense() } catch { /* api.error */ } finally { licenseLoading.value = false }
}

const activeTab = ref<TabId>('general')
const activeAgentSubtab = ref<AgentSubtabId>(currentUser.value?.role === 'admin' ? 'access' : 'skills')
const agentSubtabs: Array<{ id: AgentSubtabId; label: string; eyebrow: string; adminOnly: boolean }> = [
  { id: 'access', label: 'Tenant access', eyebrow: 'Scope', adminOnly: true },
  { id: 'models', label: 'Models', eyebrow: 'Policy', adminOnly: true },
  { id: 'limits', label: 'Investigation limits', eyebrow: 'Budget', adminOnly: true },
  { id: 'skills', label: 'Custom skills', eyebrow: 'Playbooks', adminOnly: false },
]
const activeIndex = computed(() => orderedTabs.value.findIndex(t => t.id === activeTab.value))
const activeTabDef = computed(() => tabs.find(t => t.id === activeTab.value) ?? tabs[0]!)
const activeHint = computed(() => activeTabDef.value.hint)

// Navigate the URL hash, pushing a NEW history entry so the browser Back button
// returns to the previous tab/page instead of skipping out of Settings. Guarded
// against duplicates (re-selecting the current view is a no-op).
function navHash(hash: string) {
  if (typeof window === 'undefined') return
  const target = hash.startsWith('#') ? hash : `#${hash}`
  if (window.location.hash === target) return
  history.pushState(null, '', target)
}

function setTab(id: TabId) {
  activeTab.value = id
  navHash(id === 'agent' ? `#agent/${activeAgentSubtab.value}` : `#${id}`)
  if (id === 'alerting' && !alertChannelsLoaded.value) {
    loadAlertChannels()
  }
  if (id === 'firewall' && !firewallLoaded.value) {
    loadFirewallRules()
  }
  if (id === 'agent' && !agentBudgetLoaded.value) {
    loadAgentBudget()
  }
  if (id === 'integrations') {
    integrationsExpanded.value = true
  }
}

function validAgentSubtab(sub: string): AgentSubtabId {
  const found = agentSubtabs.find(item => item.id === sub && (!item.adminOnly || isAdmin.value))
  return found?.id ?? (isAdmin.value ? 'access' : 'skills')
}

function selectAgentSubtab(id: AgentSubtabId) {
  activeTab.value = 'agent'
  activeAgentSubtab.value = validAgentSubtab(id)
  navHash(`#agent/${activeAgentSubtab.value}`)
}

function agentSubtabMeta(id: AgentSubtabId): string {
  if (id === 'access') {
    return agentTenantMode.value === 'all'
      ? `${enabledAgentTenants.value.length} enabled`
      : `${agentAllowedTenants.value.length} selected`
  }
  if (id === 'models') return agentAllowedIds.value.length ? `${agentAllowedIds.value.length} allowed` : 'Default only'
  if (id === 'limits') return agentMaxToolSteps.value ? `${agentMaxToolSteps.value} tool calls` : 'Cost controls'
  return customSkills.value.length ? `${customSkills.value.length} custom` : 'Built-in only'
}

function onAgentSubtabKeydown(e: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  const items = agentSubtabs.filter(item => !item.adminOnly || isAdmin.value)
  const current = items.findIndex(item => item.id === activeAgentSubtab.value)
  let next = current
  if (e.key === 'ArrowLeft') next = (current - 1 + items.length) % items.length
  if (e.key === 'ArrowRight') next = (current + 1) % items.length
  if (e.key === 'Home') next = 0
  if (e.key === 'End') next = items.length - 1
  const target = items[next]
  if (!target) return
  selectAgentSubtab(target.id)
  requestAnimationFrame(() => document.getElementById(`agent-tab-${target.id}`)?.focus())
}

function onTabKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const list = orderedTabs.value
  const i = activeIndex.value
  let next = i
  if (e.key === 'ArrowUp')   next = (i - 1 + list.length) % list.length
  if (e.key === 'ArrowDown') next = (i + 1) % list.length
  if (e.key === 'Home')      next = 0
  if (e.key === 'End')       next = list.length - 1
  const t = list[next]
  if (t) setTab(t.id)
}

// Parse the hash into a base tab + optional sub-path, e.g. "#integrations/argocd"
// → { tab: 'integrations', sub: 'argocd' }.
function parseHash(): { tab: TabId | null; sub: string } {
  if (typeof window === 'undefined') return { tab: null, sub: '' }
  const raw = window.location.hash.replace('#', '')
  const slash = raw.indexOf('/')
  const base = slash === -1 ? raw : raw.slice(0, slash)
  const sub = slash === -1 ? '' : raw.slice(slash + 1)
  return { tab: tabs.some(t => t.id === base) ? (base as TabId) : null, sub }
}

function onHashChange() {
  const { tab, sub } = parseHash()
  if (!tab) return
  if (tab !== activeTab.value) activeTab.value = tab
  if (tab === 'integrations') {
    integrationsExpanded.value = true
    // sub names a specific integration; '' shows the overview table.
    activeIntegration.value = integrationsMeta.some(m => m.key === sub) ? sub : ''
  }
  if (tab === 'agent') activeAgentSubtab.value = validAgentSubtab(sub)
}

// ── Data export (max rows) ──
const exportMaxRows = ref(1000)
const exportMaxRowsSaving = ref(false)
const exportMaxRowsSaved = ref(false)
const exportMaxRowsError = ref<string | null>(null)

async function loadExportMaxRows() {
  try {
    const f = await api.getFeatures()
    exportMaxRows.value = f.export_max_rows || 1000
  } catch { /* keep default */ }
}

async function saveExportMaxRows() {
  exportMaxRowsError.value = null
  exportMaxRowsSaved.value = false
  const value = Math.max(1, Math.floor(Number(exportMaxRows.value) || 1))
  exportMaxRowsSaving.value = true
  try {
    const r = await api.setExportMaxRows(value)
    exportMaxRows.value = r.export_max_rows
    exportMaxRowsSaved.value = true
    setTimeout(() => { exportMaxRowsSaved.value = false }, 2000)
  } catch (e: any) {
    exportMaxRowsError.value = e.message || 'Failed to save'
  } finally {
    exportMaxRowsSaving.value = false
  }
}

// ── Deploy markers on charts (display toggle) ──
const deployMarkersEnabled = ref(true)
const deployMarkersSaving = ref(false)

async function loadDeployMarkersSetting() {
  try {
    const r = await api.getDeployMarkersSetting()
    deployMarkersEnabled.value = r.enabled
  } catch { /* keep default */ }
}

async function toggleDeployMarkers() {
  if (deployMarkersSaving.value) return
  deployMarkersSaving.value = true
  const next = !deployMarkersEnabled.value
  try {
    const r = await api.setDeployMarkersEnabled(next)
    deployMarkersEnabled.value = r.enabled
    // Refresh shared feature flags so service charts react without a reload.
    await loadFeatures()
  } catch { /* leave toggle as-is */ } finally {
    deployMarkersSaving.value = false
  }
}

const rumEnabled = ref(true)
const rumSaving = ref(false)

async function loadRumSetting() {
  try {
    const r = await api.getRumSetting()
    rumEnabled.value = r.enabled
  } catch { /* keep default */ }
}

async function toggleRum() {
  if (rumSaving.value) return
  rumSaving.value = true
  const next = !rumEnabled.value
  try {
    const r = await api.setRumEnabled(next)
    rumEnabled.value = r.enabled
    // Refresh shared feature flags so the RUM nav item hides/shows live.
    await loadFeatures()
  } catch { /* leave toggle as-is */ } finally {
    rumSaving.value = false
  }
}

// ── CloudWatch Logs ingest (admin toggle + default tenant hint) ──
const cloudwatchEnabled = ref(false)
const cloudwatchTenant = ref('')
const cloudwatchSaving = ref(false)
const cloudwatchSaved = ref(false)

async function loadCloudwatchSetting() {
  try {
    const r = await api.getCloudwatchSetting()
    cloudwatchEnabled.value = r.enabled
    // cloudwatchTenant is a local preview selector only — not persisted.
  } catch { /* keep defaults */ }
}

async function saveCloudwatch() {
  if (cloudwatchSaving.value) return
  cloudwatchSaving.value = true
  try {
    const r = await api.setCloudwatchSetting(cloudwatchEnabled.value)
    cloudwatchEnabled.value = r.enabled
    // Refresh shared feature flags so the integration rail item hides/shows live.
    await loadFeatures()
    cloudwatchSaved.value = true
    setTimeout(() => { cloudwatchSaved.value = false }, 2000)
  } catch { /* leave as-is */ } finally {
    cloudwatchSaving.value = false
  }
}

const cloudwatchOrigin = apiBaseUrl()
const cloudwatchUrlEndpoint = computed(() => `${cloudwatchOrigin}/cloudwatch/firehose/t/${cloudwatchTenant.value || '{tenant}'}`)
// True when the selected tenant requires auth — Firehose must then send a
// tenant-scoped API key as its access-key header (enforced server-side).
const cloudwatchTenantProtected = computed(() =>
  tenants.value.some(t => t.name === cloudwatchTenant.value && t.auth_required))
const cloudwatchAccessKeyHeader = 'X-Amz-Firehose-Access-Key: <your-tenant-api-key>'
// A tenant has been picked (drives the setup instructions / CLI example).
const cloudwatchTenantChosen = computed(() => !!cloudwatchTenant.value)
// Copy-paste AWS CLI: create the Firehose stream → Rush, then subscribe a log group.
const cloudwatchCliExample = computed(() => {
  const tenant = cloudwatchTenant.value || '<tenant>'
  const stream = `rush-${tenant}-logs`
  const accessKey = cloudwatchTenantProtected.value
    ? ',\n      "AccessKey": "<your-tenant-api-key>"'
    : ''
  return `# 1) Create the Firehose delivery stream → Rush HTTP endpoint
aws firehose create-delivery-stream \\
  --delivery-stream-name ${stream} \\
  --delivery-stream-type DirectPut \\
  --http-endpoint-destination-configuration '{
    "EndpointConfiguration": {
      "Url": "${cloudwatchUrlEndpoint.value}",
      "Name": "rush"${accessKey}
    },
    "BufferingHints": { "SizeInMBs": 5, "IntervalInSeconds": 60 },
    "RetryOptions": { "DurationInSeconds": 300 },
    "RoleARN": "arn:aws:iam::<account-id>:role/<firehose-role>",
    "S3BackupMode": "FailedDataOnly",
    "S3Configuration": {
      "RoleARN": "arn:aws:iam::<account-id>:role/<firehose-role>",
      "BucketARN": "arn:aws:s3:::<firehose-backup-bucket>"
    }
  }'

# 2) Subscribe a log group to that stream (repeat per log group)
aws logs put-subscription-filter \\
  --log-group-name "/aws/rds/instance/<db>/error" \\
  --filter-name "rush" \\
  --filter-pattern "" \\
  --destination-arn "arn:aws:firehose:<region>:<account-id>:deliverystream/${stream}" \\
  --role-arn "arn:aws:iam::<account-id>:role/<cwl-to-firehose-role>"`
})
const cloudwatchCopied = ref('')
async function copyCloudwatch(text: string, id: string) {
  try {
    await navigator.clipboard.writeText(text)
    cloudwatchCopied.value = id
    setTimeout(() => { if (cloudwatchCopied.value === id) cloudwatchCopied.value = '' }, 1500)
  } catch { /* clipboard unavailable */ }
}

// ── Global Retention ──
const globalRetention = ref<GlobalRetention | null>(null)
const retDefault = ref<string>('')
const retLogs = ref<string>('')
const retMetrics = ref<string>('')
const retApm = ref<string>('')
const globalRetSaving = ref(false)
const globalRetSaved = ref(false)
const globalRetError = ref<string | null>(null)

async function loadGlobalRetention() {
  try {
    const r = await api.getGlobalRetention()
    globalRetention.value = r
    retDefault.value = String(r.default_days)
    retLogs.value = r.logs_days === 0 ? '' : String(r.logs_days)
    retMetrics.value = r.metrics_days === 0 ? '' : String(r.metrics_days)
    retApm.value = r.apm_days === 0 ? '' : String(r.apm_days)
  } catch { /* ignore — admin-only; non-admins will get 403 */ }
}

async function saveGlobalRetention() {
  globalRetError.value = null
  globalRetSaved.value = false
  globalRetSaving.value = true
  try {
    const payload = {
      default_days: Math.max(1, parseInt(retDefault.value, 10) || 1),
      logs_days: retLogs.value.trim() ? parseInt(retLogs.value, 10) : 0,
      metrics_days: retMetrics.value.trim() ? parseInt(retMetrics.value, 10) : 0,
      apm_days: retApm.value.trim() ? parseInt(retApm.value, 10) : 0,
    }
    const r = await api.setGlobalRetention(payload)
    globalRetention.value = r
    retDefault.value = String(r.default_days)
    retLogs.value = r.logs_days === 0 ? '' : String(r.logs_days)
    retMetrics.value = r.metrics_days === 0 ? '' : String(r.metrics_days)
    retApm.value = r.apm_days === 0 ? '' : String(r.apm_days)
    globalRetSaved.value = true
    setTimeout(() => { globalRetSaved.value = false }, 2000)
  } catch (e: any) {
    globalRetError.value = e.message || 'Failed to save'
  } finally {
    globalRetSaving.value = false
  }
}

// ── Alerting (notification channels) state ──
const alertChannels = ref<NotificationChannel[]>([])
const alertChannelsLoaded = ref(false)
const showChannelForm = ref(false)
const editingChannel = ref<NotificationChannel | undefined>(undefined)
const testingChannelId = ref<string | null>(null)
const testModal = ref<{ ok: boolean; message: string; name: string } | null>(null)

async function loadAlertChannels() {
  try {
    const res = await api.listChannels()
    alertChannels.value = res.channels
    alertChannelsLoaded.value = true
  } catch { /* ignore */ }
}

async function saveAlertChannel(data: { name: string; channel_type: string; config: Record<string, any> }) {
  try {
    if (editingChannel.value) {
      await api.updateChannel(editingChannel.value.id, {
        name: data.name,
        config: data.config as Record<string, unknown>,
        enabled: editingChannel.value.enabled,
      })
    } else {
      await api.createChannel(data)
    }
    showChannelForm.value = false
    editingChannel.value = undefined
    await loadAlertChannels()
  } catch (e: any) {
    alert('Failed to save channel: ' + (e.message || e))
  }
}

function startEditChannel(ch: NotificationChannel) {
  editingChannel.value = ch
  showChannelForm.value = true
}

function cancelChannelForm() {
  showChannelForm.value = false
  editingChannel.value = undefined
}

async function removeChannel(id: string) {
  try {
    await api.deleteChannel(id)
    alertChannels.value = alertChannels.value.filter(c => c.id !== id)
  } catch { /* error in api.error */ }
}

async function testAlertChannel(id: string) {
  const name = alertChannels.value.find(c => c.id === id)?.name || 'Channel'
  testingChannelId.value = id
  try {
    const res = await api.testChannel(id)
    testModal.value = { ok: true, message: res.message || 'Test notification sent successfully.', name }
  } catch (e: any) {
    testModal.value = { ok: false, message: e.message || 'Failed to send test notification.', name }
  } finally {
    testingChannelId.value = null
  }
}

function channelTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    slack: 'Slack Webhook',
    slack_app: 'Slack App',
    discord: 'Discord',
    webhook: 'Webhook',
    alertmanager: 'Alertmanager',
    email: 'Email',
    pagerduty: 'PagerDuty',
    opsgenie: 'OpsGenie',
  }
  return labels[type] ?? type
}

function channelTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    slack: '#',
    slack_app: 'S',
    discord: 'D',
    webhook: '{}',
    alertmanager: 'AM',
    email: '@',
    pagerduty: 'PD',
    opsgenie: 'OG',
  }
  return icons[type] ?? '🔔'
}

// ── SSO state ──
const ssoProvider = ref<Partial<SsoProvider>>({
  id: '',
  name: '',
  protocol: 'oidc',
  enabled: false,
  client_id: '',
  issuer_url: '',
  oidc_scopes: 'openid profile email groups',
  groups_claim: 'groups',
  email_claim: 'email',
  first_name_claim: 'first_name',
  last_name_claim: 'last_name',
  jit_provisioning: true,
  default_group_id: '',
  saml_idp_metadata_url: '',
  saml_idp_sso_url: '',
  saml_idp_cert: '',
  saml_sp_entity_id: '',
})
const ssoClientSecret = ref('')
const ssoMappings = ref<IdpGroupMapping[]>([])
const ssoSaved = ref(false)
const ssoLoaded = ref(false)
const showMappingForm = ref(false)
const editingMappingId = ref<string | null>(null)
const mappingIdpGroup = ref('')
const mappingRushGroupId = ref('')

async function loadSsoConfig() {
  try {
    const { providers } = await api.listSsoProviders()
    if (providers.length > 0) {
      const p = providers[0]
      ssoProvider.value = { ...p }
    }
    const { mappings } = await api.listIdpGroupMappings()
    ssoMappings.value = mappings
    ssoLoaded.value = true
  } catch { /* ignore load errors */ }
}

async function saveSsoConfig() {
  try {
    const data: Record<string, unknown> = { ...ssoProvider.value }
    if (ssoClientSecret.value) {
      data.client_secret = ssoClientSecret.value
    }
    const res = await api.saveSsoProvider(data as any)
    if (!ssoProvider.value.id) {
      ssoProvider.value.id = res.id
    }
    ssoSaved.value = true
    setTimeout(() => { ssoSaved.value = false }, 2000)
  } catch (e: any) {
    alert('Failed to save SSO config: ' + (e.message || e))
  }
}

function openMappingForm(m?: IdpGroupMapping) {
  if (m) {
    editingMappingId.value = m.id
    mappingIdpGroup.value = m.idp_group
    mappingRushGroupId.value = m.rush_group_id
  } else {
    editingMappingId.value = null
    mappingIdpGroup.value = ''
    mappingRushGroupId.value = ''
  }
  showMappingForm.value = true
}

function closeMappingForm() {
  showMappingForm.value = false
  editingMappingId.value = null
  mappingIdpGroup.value = ''
  mappingRushGroupId.value = ''
}

async function saveMappingForm() {
  if (!mappingIdpGroup.value || !mappingRushGroupId.value) return
  try {
    if (editingMappingId.value) {
      await api.updateIdpGroupMapping(editingMappingId.value, {
        idp_group: mappingIdpGroup.value,
        rush_group_id: mappingRushGroupId.value,
      })
    } else {
      await api.createIdpGroupMapping({
        idp_group: mappingIdpGroup.value,
        rush_group_id: mappingRushGroupId.value,
        provider_id: ssoProvider.value.id || 'default',
      })
    }
    closeMappingForm()
    await loadSsoConfig()
  } catch (e: any) {
    alert('Failed to save mapping: ' + (e.message || e))
  }
}

async function removeSsoMapping(id: string) {
  try {
    await api.deleteIdpGroupMapping(id)
    await loadSsoConfig()
  } catch (e: any) {
    alert('Failed to remove mapping: ' + (e.message || e))
  }
}

// ── SSO Wizard state machine ──
const wizardOpen = ref(false)
const wizardStep = ref(0)       // 0=choose provider, 1=choose method, 2+=guided steps
const wizardProvider = ref('')   // 'google', 'okta', 'azure', 'custom-oidc', 'custom-saml'
const wizardMethod = ref('')     // 'self' or 'magic'
const wizardSaving = ref(false)

// Wizard form data collected during guided steps
const wizardCert = ref('')
const wizardSsoUrl = ref('')
const wizardIssuerUrl = ref('')
const wizardClientId = ref('')
const wizardClientSecret = ref('')
const wizardOidcScopes = ref('openid profile email groups')
const wizardGroupsClaim = ref('groups')
const wizardEmailClaim = ref('email')
const wizardFirstNameClaim = ref('first_name')
const wizardLastNameClaim = ref('last_name')
const wizardProviderName = ref('')

// ── Wizard validation helpers ──
function isValidHttpsUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:' } catch { return false }
}
function isValidCert(cert: string): boolean {
  const trimmed = cert.trim()
  if (trimmed.includes('BEGIN CERTIFICATE')) return true
  return /^[A-Za-z0-9+/=\s]{100,}$/.test(trimmed)
}

// Track whether user has interacted with fields (for showing errors only after touch)
const wizardTouched = ref<Record<string, boolean>>({})
function touchField(field: string) { wizardTouched.value[field] = true }
function resetTouched() { wizardTouched.value = {} }

// Per-field error messages (empty string = valid)
const wizardErrors = computed(() => {
  const p = wizardProvider.value
  const protocol = protocolForProvider(p)
  const errors: Record<string, string> = {}

  // Provider name (shared)
  if (!wizardProviderName.value.trim()) errors.providerName = 'Provider name is required'

  // Groups claim (shared)
  if (!wizardGroupsClaim.value.trim()) errors.groupsClaim = 'Groups claim is required'

  // Email claim (shared)
  if (!wizardEmailClaim.value.trim()) errors.emailClaim = 'Email claim is required'

  // OIDC-specific
  if (protocol === 'oidc' || p === 'custom-oidc') {
    if (!wizardIssuerUrl.value.trim()) errors.issuerUrl = 'Issuer URL is required'
    else if (!isValidHttpsUrl(wizardIssuerUrl.value.trim())) errors.issuerUrl = 'Issuer URL must start with https://'
    if (!wizardClientId.value.trim()) errors.clientId = 'Client ID is required'
    if (!wizardClientSecret.value.trim()) errors.clientSecret = 'Client Secret is required'
  }

  // SAML-specific
  if (protocol === 'saml' || p === 'google' || p === 'okta' || p === 'azure' || p === 'custom-saml') {
    if (!wizardSsoUrl.value.trim()) errors.ssoUrl = 'IdP SSO URL is required'
    else if (!isValidHttpsUrl(wizardSsoUrl.value.trim())) errors.ssoUrl = 'IdP SSO URL must start with https://'
    if (!wizardCert.value.trim()) errors.cert = 'IdP Certificate is required'
    else if (!isValidCert(wizardCert.value)) errors.cert = 'Certificate must be in PEM format (-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----) or raw base64'
    // SP Entity ID for custom-saml
    if (p === 'custom-saml') {
      // entity ID is auto-set to hostname, always valid
    }
  }

  return errors
})

// Determine which fields belong to which step, per provider
const wizardStepValid = computed(() => {
  const p = wizardProvider.value
  const step = guidedStepNumber.value
  const e = wizardErrors.value

  if (p === 'google') {
    if (step === 1) return true // instructional
    if (step === 2) return !e.ssoUrl && !e.cert // enter IdP details
    if (step === 3) return true // copy values
    if (step === 4) return true // instructional
    if (step === 5) return !e.ssoUrl && !e.cert && !e.emailClaim
    return true
  }
  if (p === 'okta') {
    if (step <= 2) return true // create app + configure SAML (one Okta page)
    if (step === 3) return !e.ssoUrl && !e.cert // enter IdP details
    if (step === 4) return !e.ssoUrl && !e.cert // review (email/name come from NameID)
    return true
  }
  if (p === 'azure') {
    if (step === 1) return true
    if (step === 2) return true
    if (step === 3) return true
    if (step === 4) return !e.ssoUrl && !e.cert
    if (step === 5) return !e.ssoUrl && !e.cert && !e.emailClaim
    return true
  }
  if (p === 'custom-oidc') {
    if (step === 1) return !e.providerName && !e.issuerUrl && !e.clientId && !e.clientSecret
    if (step === 2) return !e.groupsClaim && !e.emailClaim
    if (step === 3) return !e.providerName && !e.issuerUrl && !e.clientId && !e.clientSecret && !e.groupsClaim && !e.emailClaim
    return true
  }
  if (p === 'custom-saml') {
    if (step === 1) return true // copy values
    if (step === 2) return !e.ssoUrl && !e.cert
    if (step === 3) return !e.ssoUrl && !e.cert && !e.emailClaim
    return true
  }
  return true
})

// Magic link state
const wizardMagicToken = ref<SetupToken | null>(null)
const wizardMagicCopied = ref(false)

const hostname = computed(() => typeof window !== 'undefined' ? window.location.origin : '')

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => { /* fallback */ })
}

const providerCards = [
  { id: 'google',      label: 'Google Workspace', subtitle: 'SAML 2.0' },
  { id: 'okta',        label: 'Okta',             subtitle: 'SAML 2.0 or OIDC' },
  { id: 'azure',       label: 'Azure AD',         subtitle: 'SAML 2.0 or OIDC' },
  { id: 'custom-oidc', label: 'Custom OIDC',      subtitle: 'Any OpenID Connect provider' },
  { id: 'custom-saml', label: 'Custom SAML',      subtitle: 'Any SAML 2.0 IdP' },
]

const wizardTotalSteps = computed(() => {
  const p = wizardProvider.value
  if (p === 'google') return 5
  if (p === 'okta') return 4
  if (p === 'azure') return 5
  if (p === 'custom-oidc') return 3
  if (p === 'custom-saml') return 3
  return 0
})

// The guided step number (1-based), starting at wizardStep=2
const guidedStepNumber = computed(() => wizardStep.value - 1)

function openWizard() {
  wizardOpen.value = true
  wizardStep.value = 0
  wizardProvider.value = ''
  wizardMethod.value = ''
  wizardCert.value = ''
  wizardSsoUrl.value = ''
  wizardIssuerUrl.value = ''
  wizardClientId.value = ''
  wizardClientSecret.value = ''
  wizardOidcScopes.value = 'openid profile email groups'
  wizardGroupsClaim.value = 'groups'
  wizardEmailClaim.value = 'email'
  wizardFirstNameClaim.value = 'first_name'
  wizardLastNameClaim.value = 'last_name'
  wizardProviderName.value = ''
  resetTouched()
  wizardMagicToken.value = null
  wizardMagicCopied.value = false
  wizardSaving.value = false
}

function closeWizard() {
  wizardOpen.value = false
}

function selectProvider(id: string) {
  wizardProvider.value = id
  // Pre-fill provider name
  const card = providerCards.find(c => c.id === id)
  wizardProviderName.value = card?.label || ''
  wizardStep.value = 1
}

function selectMethod(method: string) {
  wizardMethod.value = method
  if (method === 'self') {
    wizardStep.value = 2
  }
  // magic link handled separately
}

async function generateMagicLink() {
  wizardMethod.value = 'magic'
  try {
    wizardMagicToken.value = await api.createSetupToken(wizardProvider.value, hostname.value)
    wizardMagicCopied.value = false
  } catch (e: any) {
    alert('Failed to generate setup link: ' + (e.message || e))
  }
}

async function copyMagicLink() {
  if (!wizardMagicToken.value) return
  try {
    await navigator.clipboard.writeText(wizardMagicToken.value.url)
    wizardMagicCopied.value = true
    setTimeout(() => { wizardMagicCopied.value = false }, 2000)
  } catch { /* fallback */ }
}

function wizardBack() {
  if (wizardStep.value > 0) wizardStep.value--
}

function wizardNext() {
  if (wizardStep.value >= 2 && guidedStepNumber.value < wizardTotalSteps.value) {
    wizardStep.value++
  }
}

function protocolForProvider(p: string): string {
  if (p === 'custom-oidc') return 'oidc'
  if (p === 'custom-saml' || p === 'google') return 'saml'
  // okta and azure default to saml for wizard, but we keep what they set
  return 'saml'
}

async function wizardSave() {
  wizardSaving.value = true
  try {
    const protocol = protocolForProvider(wizardProvider.value)
    const data: Record<string, unknown> = {
      name: wizardProviderName.value || wizardProvider.value,
      protocol,
      enabled: true,
      jit_provisioning: true,
      groups_claim: wizardGroupsClaim.value || 'groups',
      email_claim: wizardEmailClaim.value || 'email',
      first_name_claim: wizardFirstNameClaim.value || 'first_name',
      last_name_claim: wizardLastNameClaim.value || 'last_name',
      default_group_id: '',
    }
    if (protocol === 'oidc') {
      data.issuer_url = wizardIssuerUrl.value
      data.client_id = wizardClientId.value
      data.client_secret = wizardClientSecret.value
      data.oidc_scopes = wizardOidcScopes.value
    } else {
      data.saml_idp_sso_url = wizardSsoUrl.value
      data.saml_idp_cert = wizardCert.value
      data.saml_sp_entity_id = hostname.value
    }
    if (ssoProvider.value.id) {
      data.id = ssoProvider.value.id
    }
    const res = await api.saveSsoProvider(data as any)
    if (!ssoProvider.value.id) {
      ssoProvider.value.id = res.id
    }
    await loadSsoConfig()
    closeWizard()
  } catch (e: any) {
    alert('Failed to save SSO config: ' + (e.message || e))
  } finally {
    wizardSaving.value = false
  }
}

// (copySetupLink removed - magic link now handled inside wizard)

// ── API Keys state ──
// ── Shared delete confirmation modal ──
const deleteModal = ref<{ type: string; id: string; label: string } | null>(null)

function askDelete(type: string, id: string, label: string) {
  deleteModal.value = { type, id, label }
}

async function confirmDelete() {
  if (!deleteModal.value) return
  const { type, id } = deleteModal.value
  try {
    if (type === 'key') await removeKey(id)
    else if (type === 'link') await removeServiceLink(id)
    else if (type === 'skill') await deleteSkill(id)
    else if (type === 'tenant') await removeTenant(id)
    else if (type === 'group') await removeGroup(id)
    else if (type === 'user') await removeUser(id)
    else if (type === 'channel') await removeChannel(id)
    else if (type === 'firewall rule') await removeFirewallRule(id)
    else if (type === 'model') removeModel(id)
  } finally {
    deleteModal.value = null
  }
}

const keys = ref<ApiKey[]>([])
const showForm = ref(false)
const keyName = ref('')
const newlyCreated = ref<ApiKeyCreated | null>(null)
const copied = ref(false)

// ── Service Links state ──
const serviceLinks = ref<ServiceLink[]>([])
const showLinkForm = ref(false)
const linkServiceName = ref('')
const linkGithubRepo = ref('')
const linkDefaultBranch = ref('main')
const linkRootPath = ref('')
const serviceSuggestions = ref<string[]>([])

// ── Custom Skills state ──
const customSkills = ref<CustomSkill[]>([])
const skillDialogOpen = ref(false)
const editingSkill = ref<CustomSkill | undefined>(undefined)
const dialogTemplate = ref<{ title: string; description: string; content: string } | undefined>(undefined)

// Hardcoded reference list of built-in skills that ship with sre-agent.
// Users can't edit these; "Duplicate" copies one as a starting point for a new custom skill.
const builtInSkillTemplates = [
  {
    name: 'error_rate_spike',
    title: 'Error Rate Spike Investigation',
    description: 'Playbook for diagnosing sudden increases in error rates',
    content: `# Error Rate Spike Investigation Playbook

## Quick Assessment
1. Scope the blast radius — is it one service, one endpoint, or the whole system?
2. Check error_count vs total requests — percentage vs absolute
3. Compare current window to prior window (1h ago, 24h ago)

## Root Cause Patterns
### Pattern: Upstream dependency failure
-> Follow the trace, look for 5xx from downstream calls

### Pattern: Deploy regression
-> Correlate with recent deploy markers via list_deploys

### Pattern: Bad input / new traffic shape
-> Group errors by path, user-agent, or query shape

## Key Queries
- search_logs with severity=ERROR grouped by service
- query_traces filtered on http_status_code>=500
- list_deploys within the last 2 hours
`,
  },
  {
    name: 'latency_degradation',
    title: 'Latency Degradation Investigation',
    description: 'Playbook for investigating latency increases and slow requests',
    content: `# Latency Degradation Investigation Playbook

## Quick Assessment
1. p50 vs p99 — is it a tail problem or a median shift?
2. Which service/endpoint owns the regression?
3. Is downstream I/O (DB, cache, external API) the critical path?

## Root Cause Patterns
### Pattern: Database contention
-> Look at DB span durations and query shape

### Pattern: Garbage collection / CPU saturation
-> Check container CPU and memory metrics

### Pattern: Network / dependency slowdown
-> Walk the trace and find the slow span

## Key Queries
- query_metrics for p99 latency by service
- query_traces sorted by duration, filtered to slow percentile
- service_dependencies to identify hot paths
`,
  },
  {
    name: 'deploy_regression',
    title: 'Deploy Regression Investigation',
    description: 'Playbook for correlating issues with recent deployments',
    content: `# Deploy Regression Investigation Playbook

## Quick Assessment
1. List recent deploys for the affected services
2. Compare before/after on error rate and latency
3. Identify the exact deploy window

## Root Cause Patterns
### Pattern: Config change
-> Look at logs for config-related warnings at startup

### Pattern: Dependency bump
-> Scan for new error signatures absent before the deploy

### Pattern: Schema / migration issue
-> Check DB-adjacent logs

## Key Queries
- list_deploys within the window
- search_logs before vs after deploy timestamp
- get_argocd_app for each impacted service
`,
  },
  {
    name: 'dependency_failure',
    title: 'Dependency Failure Investigation',
    description: 'Playbook for tracing failures through the service dependency graph',
    content: `# Dependency Failure Investigation Playbook

## Quick Assessment
1. Map the dependency graph — which service is the root?
2. Are downstream services also affected (fan-out) or is it isolated?
3. Check circuit breaker / retry storm signatures

## Root Cause Patterns
### Pattern: Downstream outage
-> The root service is healthy but its callee is failing

### Pattern: Cascading timeout
-> Look for matching timeout durations across services

## Key Queries
- service_dependencies to see the call graph
- query_traces filtered to failed spans
- list_services to find the highest error rate
`,
  },
  {
    name: 'argocd_unhealthy',
    title: 'ArgoCD Unhealthy App Investigation',
    description: 'Playbook for diagnosing ArgoCD applications that are Degraded or have failed syncs',
    content: `# ArgoCD Unhealthy App Investigation Playbook

## Quick Assessment
1. Call get_argocd_app for the unhealthy application
2. Check sync_status and operation_phase
3. List unhealthy_resources with their health messages

## Root Cause Patterns
### Pattern: Pod / container failing
-> kube_describe the pod, then kube_events to see why

### Pattern: Sync failed
-> Look at operation_message, check the target revision

### Pattern: Missing secret / configmap
-> kube_events in the destination namespace

## Key Queries
- get_argocd_app with the app name
- kube_describe for each unhealthy resource
- kube_events in the destination namespace
`,
  },
  {
    name: 'throughput_anomaly',
    title: 'Throughput Anomaly Investigation',
    description: 'Playbook for analyzing request volume changes',
    content: `# Throughput Anomaly Investigation Playbook

## Quick Assessment
1. Direction — higher or lower than expected?
2. Scope — which service, endpoint, or client?
3. Compare to the seasonal baseline (same weekday, same hour)

## Root Cause Patterns
### Pattern: Upstream traffic shift
-> A new client, crawler, or A/B test is driving volume

### Pattern: Retry storm
-> Errors upstream driving retries downstream

### Pattern: Outage hiding traffic
-> Look for a drop in a specific client — they may be down

## Key Queries
- query_metrics for request rate by service
- query_traces grouped by caller identity
- search_logs for throttling / rate-limit messages
`,
  },
]

async function loadCustomSkills() {
  try {
    customSkills.value = await api.listCustomSkills()
  } catch { /* error surfaced via api.error */ }
}

function openSkillDialog(skill?: CustomSkill) {
  editingSkill.value = skill
  dialogTemplate.value = undefined
  skillDialogOpen.value = true
}

function cloneBuiltIn(b: (typeof builtInSkillTemplates)[number]) {
  editingSkill.value = undefined
  dialogTemplate.value = {
    title: b.title,
    description: b.description,
    content: b.content,
  }
  skillDialogOpen.value = true
}

function closeSkillDialog() {
  skillDialogOpen.value = false
  editingSkill.value = undefined
  dialogTemplate.value = undefined
}

async function onSkillSaved(_skill: CustomSkill) {
  await loadCustomSkills()
  closeSkillDialog()
}

async function deleteSkill(id: string) {
  try {
    await api.deleteCustomSkill(id)
    // modal handles close
    await loadCustomSkills()
  } catch { /* error in api.error */ }
}

function formatSkillDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ── Tenants state ──
const tenants = ref<Tenant[]>([])
const showTenantForm = ref(false)
const tenantName = ref('')

function openTenantForm() {
  tenantName.value = ''
  retentionLogs.value = ''
  retentionTraces.value = ''
  retentionMetrics.value = ''
  newSignalLogs.value = true
  newSignalApm.value = true
  newSignalMetrics.value = true
  newSignalRum.value = true
  if (!globalRetention.value) loadGlobalRetention()
  showTenantForm.value = true
}

function closeTenantForm() {
  showTenantForm.value = false
  tenantName.value = ''
  retentionLogs.value = ''
  retentionTraces.value = ''
  retentionMetrics.value = ''
}

async function loadTenants() {
  try {
    const res = await api.listTenants()
    tenants.value = res.tenants
  } catch { /* error surfaced via api.error */ }
}

const creatingTenant = ref(false)

// Tenant names must be unique (data is keyed by name). Instant client-side
// check against the loaded list; the server enforces it too (409).
const tenantNameTaken = computed(() => {
  const n = tenantName.value.trim().toLowerCase()
  return !!n && tenants.value.some(t => t.name.toLowerCase() === n)
})

async function createTenant() {
  // In-flight guard: a double click (or Enter + click) previously fired the
  // POST twice and created duplicate tenants.
  if (!tenantName.value.trim() || creatingTenant.value || tenantNameTaken.value) return
  creatingTenant.value = true
  try {
    const created = await api.createTenant(tenantName.value.trim(), {
      signals: {
        logs: newSignalLogs.value,
        apm: newSignalApm.value,
        metrics: newSignalMetrics.value,
        rum: newSignalRum.value,
      },
    })
    // Apply any tenant-only retention overrides set in the drawer. Clamp to the
    // global caps first; the server re-validates and clamps regardless.
    clampRetention('logs')
    clampRetention('traces')
    clampRetention('metrics')
    const retention: TenantRetention = {}
    if (retentionLogs.value.trim()) retention.logs_days = parseInt(retentionLogs.value, 10)
    if (retentionTraces.value.trim()) retention.traces_days = parseInt(retentionTraces.value, 10)
    if (retentionMetrics.value.trim()) retention.metrics_days = parseInt(retentionMetrics.value, 10)
    if (Object.keys(retention).length > 0) {
      tenantRetentionMap.value[created.id] = await api.setTenantRetention(created.id, retention)
    }
    closeTenantForm()
    await loadTenants()
  } catch { /* error in api.error */ }
  finally {
    creatingTenant.value = false
  }
}

async function removeTenant(id: string) {
  try {
    await api.deleteTenant(id)
    // modal handles close
    await loadTenants()
  } catch { /* error in api.error */ }
}

async function toggleTenantEnabled(id: string, enabled: boolean) {
  try {
    await api.toggleTenant(id, enabled)
    await loadTenants()
  } catch { /* error in api.error */ }
}

// ── Tenant ingest-signal state ──
// Per-tenant { signals, dropped } loaded alongside retention; mirrors the
// tenantRetentionMap pattern. Default all-enabled when not yet loaded.
const tenantSignalsMap = ref<Record<string, TenantSignals>>({})
// Create-form signal toggles (all default ON).
const newSignalLogs = ref(true)
const newSignalApm = ref(true)
const newSignalMetrics = ref(true)
const newSignalRum = ref(true)

const SIGNAL_DEFS: { key: 'logs' | 'apm' | 'metrics' | 'rum'; label: string }[] = [
  { key: 'logs', label: 'Logs' },
  { key: 'apm', label: 'APM' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'rum', label: 'RUM' },
]

async function loadAllTenantSignals() {
  for (const t of tenants.value) {
    try {
      tenantSignalsMap.value[t.id] = await api.getTenantSignals(t.id)
    } catch { /* ignore — defaults to all-enabled in the UI */ }
  }
}

// Effective enabled flag for a tenant signal (defaults true if not loaded).
function signalEnabled(tenantId: string, key: 'logs' | 'apm' | 'metrics' | 'rum'): boolean {
  const s = tenantSignalsMap.value[tenantId]?.signals
  return s ? s[key] : true
}

function signalDropped(tenantId: string, key: 'logs' | 'apm' | 'metrics' | 'rum'): number {
  return tenantSignalsMap.value[tenantId]?.dropped?.[key] ?? 0
}

// Compact human count, e.g. 12300 → "12.3k".
function formatDropped(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// Auto-save a single signal toggle (like the auth_required checkbox).
async function toggleTenantSignal(tenantId: string, key: 'logs' | 'apm' | 'metrics' | 'rum', enabled: boolean) {
  try {
    tenantSignalsMap.value[tenantId] = await api.setTenantSignals(tenantId, { [key]: enabled })
  } catch { /* error surfaced via api.error */ }
}

// ── Tenant retention state ──
const tenantRetentionMap = ref<Record<string, TenantRetention>>({})
const showRetentionModal = ref(false)
const retentionEditTenantId = ref('')
const retentionEditTenantName = ref('')
const retentionMetrics = ref<string>('')
const retentionTraces = ref<string>('')
const retentionLogs = ref<string>('')
const retentionSaving = ref(false)

async function loadAllTenantRetention() {
  for (const t of tenants.value) {
    try {
      const r = await api.getTenantRetention(t.id)
      tenantRetentionMap.value[t.id] = r
    } catch { /* ignore */ }
  }
}

const retentionSaveError = ref<string | null>(null)

function openRetentionModal(tenant: Tenant) {
  retentionEditTenantId.value = tenant.id
  retentionEditTenantName.value = tenant.name
  const existing = tenantRetentionMap.value[tenant.id]
  retentionMetrics.value = existing?.metrics_days != null ? String(existing.metrics_days) : ''
  retentionTraces.value = existing?.traces_days != null ? String(existing.traces_days) : ''
  retentionLogs.value = existing?.logs_days != null ? String(existing.logs_days) : ''
  retentionSaveError.value = null
  if (!globalRetention.value) {
    loadGlobalRetention()
  }
  showRetentionModal.value = true
}

function closeRetentionModal() {
  showRetentionModal.value = false
  retentionEditTenantId.value = ''
  retentionEditTenantName.value = ''
}

// Cap for a given signal from the global retention policy (logs→effective_logs,
// traces→effective_apm, metrics→effective_metrics). Null when global isn't loaded.
function retentionCap(signal: 'logs' | 'traces' | 'metrics'): number | null {
  const g = globalRetention.value
  if (!g) return null
  if (signal === 'logs') return g.effective_logs
  if (signal === 'traces') return g.effective_apm
  return g.effective_metrics
}

// Clamp a per-signal input to [1, global cap]. Empty stays empty (inherit the
// global default). Non-numeric/negative input is normalized rather than sent on.
// The backend re-validates regardless — this is UX, not the security boundary.
function clampRetention(signal: 'logs' | 'traces' | 'metrics') {
  const r = signal === 'logs' ? retentionLogs : signal === 'traces' ? retentionTraces : retentionMetrics
  const raw = r.value.trim()
  if (!raw) { r.value = ''; return }
  let n = parseInt(raw, 10)
  if (!Number.isFinite(n)) { r.value = ''; return }
  if (n < 1) n = 1
  const cap = retentionCap(signal)
  if (cap != null && n > cap) n = cap
  r.value = String(n)
}

// Returns the global cap when the currently typed value for a signal exceeds it,
// else null. Drives the "over the max" warning; empty/non-numeric input is not a
// warning (empty inherits the global default).
function retentionOver(signal: 'logs' | 'traces' | 'metrics'): number | null {
  const r = signal === 'logs' ? retentionLogs : signal === 'traces' ? retentionTraces : retentionMetrics
  const raw = r.value.trim()
  if (!raw) return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return null
  const cap = retentionCap(signal)
  return cap != null && n > cap ? cap : null
}

async function saveRetention() {
  retentionSaving.value = true
  retentionSaveError.value = null
  try {
    // Clamp every field to the global cap before building the payload, so a value
    // typed past the cap (or pasted in) is reduced to the maximum rather than rejected.
    clampRetention('logs')
    clampRetention('traces')
    clampRetention('metrics')
    const payload: TenantRetention = {}
    if (retentionMetrics.value.trim()) payload.metrics_days = parseInt(retentionMetrics.value, 10)
    if (retentionTraces.value.trim()) payload.traces_days = parseInt(retentionTraces.value, 10)
    if (retentionLogs.value.trim()) payload.logs_days = parseInt(retentionLogs.value, 10)
    const result = await api.setTenantRetention(retentionEditTenantId.value, payload)
    tenantRetentionMap.value[retentionEditTenantId.value] = result
    closeRetentionModal()
  } catch (e: any) {
    retentionSaveError.value = e.message || 'Failed to save'
  } finally {
    retentionSaving.value = false
  }
}

function retentionBadges(tenantId: string): string[] {
  const r = tenantRetentionMap.value[tenantId]
  if (!r) return []
  const badges: string[] = []
  if (r.logs_days != null) badges.push(`logs: ${r.logs_days}d`)
  if (r.traces_days != null) badges.push(`traces: ${r.traces_days}d`)
  if (r.metrics_days != null) badges.push(`metrics: ${r.metrics_days}d`)
  return badges
}

// ── Groups state ──
const groups = ref<Group[]>([])
const showGroupForm = ref(false)
const editingGroupId = ref<string | null>(null)
const groupName = ref('')
const groupDescription = ref('')
const groupScopes = ref<string[]>(['all'])
const groupPermissions = ref<string[]>(['read'])
const groupTenantIds = ref<string[]>([])

const allScopes = ['logs', 'traces', 'metrics', 'all']
const allPermissions = ['read', 'write']

async function loadGroups() {
  try {
    const res = await api.listGroups()
    groups.value = res.groups
  } catch { /* error surfaced via api.error */ }
}

function openGroupForm(group?: Group) {
  if (group) {
    editingGroupId.value = group.id
    groupName.value = group.name
    groupDescription.value = group.description
    groupScopes.value = [...group.scopes]
    groupPermissions.value = [...group.permissions]
    groupTenantIds.value = [...group.tenant_ids]
  } else {
    editingGroupId.value = null
    groupName.value = ''
    groupDescription.value = ''
    groupScopes.value = ['all']
    groupPermissions.value = ['read']
    // New groups are viewers (read-only) by default, and viewers default to ALL
    // tenants: an empty mapping would grant access to nothing (the backend
    // unions explicit group→tenant rows). Admins can narrow it before saving.
    groupTenantIds.value = tenants.value.map(t => t.id)
  }
  showGroupForm.value = true
}

const tenantDropdownOpen = ref(false)

const tenantSelectionLabel = computed(() => {
  if (allTenantsSelected.value) return 'All tenants'
  const count = groupTenantIds.value.length
  if (count === 0) return 'No tenants selected'
  if (count === 1) return tenantDisplayName(groupTenantIds.value[0]!)
  return `${count} tenants selected`
})

function closeGroupForm() {
  showGroupForm.value = false
  editingGroupId.value = null
  groupName.value = ''
  groupDescription.value = ''
  groupScopes.value = ['all']
  groupPermissions.value = ['read']
  groupTenantIds.value = []
  tenantDropdownOpen.value = false
}

function toggleScope(scope: string) {
  const idx = groupScopes.value.indexOf(scope)
  if (idx >= 0) {
    groupScopes.value.splice(idx, 1)
  } else {
    groupScopes.value.push(scope)
  }
}

function togglePermission(perm: string) {
  const idx = groupPermissions.value.indexOf(perm)
  if (idx >= 0) {
    groupPermissions.value.splice(idx, 1)
  } else {
    groupPermissions.value.push(perm)
  }
}

function tenantDisplayName(tid: string): string {
  return tenants.value.find(t => t.id === tid)?.name ?? tid
}

function toggleGroupTenant(tid: string) {
  const idx = groupTenantIds.value.indexOf(tid)
  if (idx >= 0) {
    groupTenantIds.value.splice(idx, 1)
  } else {
    groupTenantIds.value.push(tid)
  }
}

const allTenantsSelected = computed(() =>
  tenants.value.length > 0 && tenants.value.every(t => groupTenantIds.value.includes(t.id))
)

function toggleAllTenants() {
  if (allTenantsSelected.value) {
    groupTenantIds.value = []
  } else {
    groupTenantIds.value = tenants.value.map(t => t.id)
  }
}

async function saveGroup() {
  if (!editingGroupId.value && !groupName.value.trim()) return
  try {
    if (editingGroupId.value) {
      await api.updateGroup(editingGroupId.value, {
        description: groupDescription.value,
        scopes: groupScopes.value,
        permissions: groupPermissions.value,
      })
      await api.setGroupTenants(editingGroupId.value, groupTenantIds.value)
    } else {
      const created = await api.createGroup({
        name: groupName.value.trim(),
        description: groupDescription.value,
        scopes: groupScopes.value,
        permissions: groupPermissions.value,
      })
      if (groupTenantIds.value.length > 0) {
        await api.setGroupTenants(created.id, groupTenantIds.value)
      }
    }
    closeGroupForm()
    await loadGroups()
  } catch { /* error in api.error */ }
}

async function removeGroup(id: string) {
  try {
    await api.deleteGroup(id)
    await loadGroups()
  } catch { /* error in api.error */ }
}

// ── User group editing state ──
const editUserGroupsId = ref<string | null>(null)
const editUserGroupIds = ref<string[]>([])
const editUserGroupsUsername = computed(() => {
  if (!editUserGroupsId.value) return ''
  return users.value.find(u => u.id === editUserGroupsId.value)?.username ?? ''
})

const userGroupMap = ref<Record<string, string[]>>({})

async function loadAllUserGroups() {
  for (const u of users.value) {
    try {
      const res = await api.getUserGroups(u.id)
      userGroupMap.value[u.id] = res.group_ids
    } catch { /* ignore */ }
  }
}

function openEditUserGroups(userId: string) {
  editUserGroupsId.value = userId
  editUserGroupIds.value = [...(userGroupMap.value[userId] || [])]
}

function toggleUserGroup(gid: string) {
  const idx = editUserGroupIds.value.indexOf(gid)
  if (idx >= 0) {
    editUserGroupIds.value.splice(idx, 1)
  } else {
    editUserGroupIds.value.push(gid)
  }
}

async function saveUserGroups() {
  if (!editUserGroupsId.value) return
  try {
    await api.setUserGroups(editUserGroupsId.value, editUserGroupIds.value)
    userGroupMap.value[editUserGroupsId.value] = [...editUserGroupIds.value]
    editUserGroupsId.value = null
    editUserGroupIds.value = []
  } catch { /* error in api.error */ }
}

function groupNameById(gid: string): string {
  return groups.value.find(g => g.id === gid)?.name ?? gid
}

// ── Users state ──
const users = ref<User[]>([])
const showUserForm = ref(false)
const newUserUsername = ref('')
const newUserPassword = ref('')
const newUserDisplayName = ref('')
const newUserGroupIds = ref<string[]>([])
const userGroupDropdownOpen = ref(false)

const userGroupSelectionLabel = computed(() => {
  const count = newUserGroupIds.value.length
  if (count === 0) return 'Select groups...'
  if (count === 1) return groupNameById(newUserGroupIds.value[0]!)
  return `${count} groups selected`
})

function toggleNewUserGroup(gid: string) {
  const idx = newUserGroupIds.value.indexOf(gid)
  if (idx >= 0) newUserGroupIds.value.splice(idx, 1)
  else newUserGroupIds.value.push(gid)
}
const changePasswordUserId = ref<string | null>(null)
const changePasswordValue = ref('')
const changePasswordConfirm = ref('')
const passwordMismatch = computed(() =>
  changePasswordConfirm.value.length > 0 && changePasswordValue.value !== changePasswordConfirm.value
)
const changePasswordUsername = computed(() => {
  if (!changePasswordUserId.value) return ''
  return users.value.find(u => u.id === changePasswordUserId.value)?.username ?? ''
})

const isAdmin = computed(() => currentUser.value?.role === 'admin')

async function loadUsers() {
  try {
    const res = await api.listUsers()
    users.value = res.users
  } catch { /* error surfaced via api.error */ }
}

async function createNewUser() {
  if (!newUserUsername.value.trim() || !newUserPassword.value) return
  try {
    const user = await api.createUser({
      username: newUserUsername.value.trim(),
      password: newUserPassword.value,
      display_name: newUserDisplayName.value.trim() || undefined,
    })
    if (newUserGroupIds.value.length > 0) {
      await api.setUserGroups(user.id, newUserGroupIds.value)
    }
    newUserUsername.value = ''
    newUserPassword.value = ''
    newUserDisplayName.value = ''
    newUserGroupIds.value = []
    userGroupDropdownOpen.value = false
    showUserForm.value = false
    await loadUsers()
  } catch { /* error in api.error */ }
}

async function removeUser(id: string) {
  try {
    await api.deleteUser(id)
    // modal handles close
    await loadUsers()
  } catch { /* error in api.error */ }
}

async function changePassword(id: string) {
  if (!changePasswordValue.value) return
  try {
    await api.changeUserPassword(id, changePasswordValue.value)
    changePasswordUserId.value = null
    changePasswordValue.value = ''
    changePasswordConfirm.value = ''
  } catch { /* error in api.error */ }
}

async function toggleUserEnabled(id: string, enabled: boolean) {
  try {
    await api.toggleUser(id, enabled)
    await loadUsers()
  } catch { /* error in api.error */ }
}

// ── SRE agent enable + investigation budget ──
const agentBudgetLoaded = ref(false)
const agentEnabled = ref(false)
const agentToggleSaving = ref(false)
const agentTenantMode = ref<'all' | 'selected'>('all')
const agentAllowedTenants = ref<string[]>([])
const agentTenantSaving = ref(false)
const agentTenantSaved = ref(false)
const agentMaxToolSteps = ref<string>('')
const agentMaxLlmCalls = ref<string>('')
// Two-tier model/thinking policy (admin-defined). `agentModel` is the DEFAULT
// model (the one used when a user/button doesn't pick); `agentAllowedModels` is
// the menu of models users may pick + the per-model allowed thinking levels.
const agentModel = ref<string>('')
const agentProviderModels = ref<string[]>([])     // full provider model list (autocomplete pool)
const agentReasoningLevels = ref<string[]>([])    // minimal/low/medium/high
// Allowed-models policy keyed by id: id → allowed thinking levels.
const agentAllowed = ref<Record<string, string[]>>({})
// Autocomplete combobox state for adding allowed models.
const agentModelInput = ref<string>('')
const showModelMenu = ref<boolean>(false)

// Does a model id accept a thinking level? (gpt-5 / o-series.) Mirrors the server.
function modelIsReasoning(id: string): boolean {
  const m = id.trim().toLowerCase()
  return m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')
}
// The allowed ids, in the order they were added.
const agentAllowedIds = computed(() => Object.keys(agentAllowed.value))
// Provider models matching what's typed, excluding already-added ones.
const agentModelMatches = computed(() => {
  const q = agentModelInput.value.trim().toLowerCase()
  return agentProviderModels.value
    .filter(id => !(id in agentAllowed.value))
    .filter(id => !q || id.toLowerCase().includes(q))
    .slice(0, 8)
})

// Add a model to the allowlist. Reasoning models default to ALL thinking levels.
function addModel(id: string) {
  const v = id.trim()
  if (!v || v in agentAllowed.value) { agentModelInput.value = ''; return }
  agentAllowed.value = {
    ...agentAllowed.value,
    [v]: modelIsReasoning(v) ? [...agentReasoningLevels.value] : [],
  }
  if (!agentModel.value) agentModel.value = v   // first added becomes the default
  agentModelInput.value = ''
  showModelMenu.value = true   // keep open so several can be added in a row
  schedulePolicySave()
}
function removeModel(id: string) {
  const next = { ...agentAllowed.value }
  delete next[id]
  agentAllowed.value = next
  if (agentModel.value === id) agentModel.value = ''
  schedulePolicySave()
}
// Tab / Enter completes-and-adds the best match (or the typed value); Esc clears.
function onModelKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab' || e.key === 'Enter') {
    const top = agentModelMatches.value[0]
    const v = agentModelInput.value.trim()
    const pick = top && (!v || top.toLowerCase().startsWith(v.toLowerCase())) ? top : (v || top)
    if (pick) { e.preventDefault(); addModel(pick) }
  } else if (e.key === 'Escape') {
    agentModelInput.value = ''
    showModelMenu.value = false
  }
}
// Delay hiding so a mousedown on a menu item still registers.
function onModelBlur() {
  setTimeout(() => { showModelMenu.value = false }, 150)
}
function toggleAllowedLevel(id: string, level: string) {
  const cur = agentAllowed.value[id] || []
  const next = cur.includes(level) ? cur.filter(l => l !== level) : [...cur, level]
  agentAllowed.value = { ...agentAllowed.value, [id]: next }
  schedulePolicySave()
}

// Auto-save the allowed-models policy (debounced) whenever it changes, so the
// admin never has to hit a Save button for the model menu. Reuses the current
// budget values (which the server clamps) and the chosen default model.
const agentPolicySaving = ref(false)
const agentPolicySaved = ref(false)
let policySaveTimer: ReturnType<typeof setTimeout> | undefined
function schedulePolicySave() {
  if (!agentBudgetLoaded.value) return   // skip during initial load
  if (policySaveTimer) clearTimeout(policySaveTimer)
  policySaveTimer = setTimeout(savePolicy, 400)
}
async function savePolicy() {
  const steps = parseInt(agentMaxToolSteps.value, 10) || (agentBudgetDefaults.value?.max_tool_steps ?? 40)
  const calls = parseInt(agentMaxLlmCalls.value, 10) || (agentBudgetDefaults.value?.max_llm_calls ?? 55)
  const allowedModels = agentAllowedIds.value.map(id => ({
    id,
    reasoning: modelIsReasoning(id) ? (agentAllowed.value[id] || []) : [],
  }))
  agentPolicySaving.value = true
  agentBudgetError.value = null
  try {
    await api.setSreAgentSettings(steps, calls, agentModel.value.trim(), undefined, allowedModels)
    agentPolicySaved.value = true
    setTimeout(() => { agentPolicySaved.value = false }, 2000)
  } catch (e: any) {
    agentBudgetError.value = e.message || 'Failed to save models'
  } finally {
    agentPolicySaving.value = false
  }
}
const agentBudgetDefaults = ref<{ max_tool_steps: number; max_llm_calls: number } | null>(null)
const agentBudgetSaving = ref(false)
const agentBudgetSaved = ref(false)
const agentBudgetError = ref<string | null>(null)

const enabledAgentTenants = computed(() => tenants.value.filter(tenant => tenant.enabled))

function toggleAgentTenant(tenantName: string) {
  agentAllowedTenants.value = agentAllowedTenants.value.includes(tenantName)
    ? agentAllowedTenants.value.filter(name => name !== tenantName)
    : [...agentAllowedTenants.value, tenantName]
}

async function saveAgentTenantAccess() {
  agentTenantSaving.value = true
  agentTenantSaved.value = false
  agentBudgetError.value = null
  try {
    const saved = await api.setSreAgentTenantAccess(agentTenantMode.value, agentAllowedTenants.value)
    agentTenantMode.value = saved.tenant_mode
    agentAllowedTenants.value = saved.allowed_tenants
    agentTenantSaved.value = true
    await loadFeatures()
    setTimeout(() => { agentTenantSaved.value = false }, 2500)
  } catch (e: any) {
    agentBudgetError.value = e.message || 'Failed to save tenant access'
  } finally {
    agentTenantSaving.value = false
  }
}

async function loadAgentBudget() {
  if (!isAdmin.value) return
  try {
    const s = await api.getSreAgentSettings()
    agentEnabled.value = !!s.enabled
    agentTenantMode.value = s.tenant_mode === 'selected' ? 'selected' : 'all'
    agentAllowedTenants.value = s.allowed_tenants || []
    agentMaxToolSteps.value = String(s.max_tool_steps)
    agentMaxLlmCalls.value = String(s.max_llm_calls)
    agentModel.value = s.model || ''
    agentReasoningLevels.value = s.reasoning_levels || []
    // Seed the allowed-models policy from the saved setting.
    const allowed: Record<string, string[]> = {}
    for (const m of s.allowed_models || []) allowed[m.id] = m.reasoning || []
    agentAllowed.value = allowed
    // The checklist starts from the saved suggestions, augmented by anything
    // already allowed (so a saved id never disappears from the list).
    const seed = new Set<string>([...(s.model_suggestions || []), ...Object.keys(allowed)])
    agentProviderModels.value = Array.from(seed)
    agentBudgetDefaults.value = s.defaults
    agentBudgetLoaded.value = true
    // Pull the live provider model list (best-effort; merge with allowed ids).
    try {
      const m = await api.getSreAgentModels()
      if (m.models?.length) {
        const merged = new Set<string>([...m.models, ...Object.keys(allowed)])
        agentProviderModels.value = Array.from(merged)
      }
    } catch { /* keep static suggestions */ }
  } catch { /* non-admin or endpoint unavailable */ }
}

async function toggleAgentEnabled() {
  if (agentToggleSaving.value) return
  agentToggleSaving.value = true
  agentBudgetError.value = null
  const next = !agentEnabled.value
  try {
    const saved = await api.setSreAgentEnabled(next)
    agentEnabled.value = saved.enabled
    // Refresh the shared feature flags so the top-bar entry and all
    // Investigate buttons across the app react immediately.
    await loadFeatures()
  } catch (e: any) {
    agentBudgetError.value = e.message || 'Failed to save'
  } finally {
    agentToggleSaving.value = false
  }
}

async function saveAgentBudget() {
  const steps = parseInt(agentMaxToolSteps.value, 10)
  const calls = parseInt(agentMaxLlmCalls.value, 10)
  if (!Number.isFinite(steps) || !Number.isFinite(calls)) {
    agentBudgetError.value = 'Both values must be positive integers.'
    return
  }
  agentBudgetSaving.value = true
  agentBudgetError.value = null
  agentBudgetSaved.value = false
  try {
    // Build the allowed-models policy array from the checklist (reasoning only
    // for reasoning models; server re-validates).
    const allowedModels = agentAllowedIds.value.map(id => ({
      id,
      reasoning: modelIsReasoning(id) ? (agentAllowed.value[id] || []) : [],
    }))
    // Server clamps (tool steps 4–200; LLM calls steps+2–300) and returns the
    // effective values, which we reflect back into the inputs.
    const saved = await api.setSreAgentSettings(steps, calls, agentModel.value.trim(), undefined, allowedModels)
    agentMaxToolSteps.value = String(saved.max_tool_steps)
    agentMaxLlmCalls.value = String(saved.max_llm_calls)
    agentBudgetSaved.value = true
    setTimeout(() => { agentBudgetSaved.value = false }, 2500)
  } catch (e: any) {
    agentBudgetError.value = e.message || 'Failed to save'
  } finally {
    agentBudgetSaving.value = false
  }
}

// ── Metric Firewall state ──
const firewallRules = ref<MetricFirewallRule[]>([])
const firewallNotice = ref('')
let firewallNoticeTimer: ReturnType<typeof setTimeout> | undefined
function showFirewallNotice(msg: string) {
  firewallNotice.value = msg
  if (firewallNoticeTimer) clearTimeout(firewallNoticeTimer)
  firewallNoticeTimer = setTimeout(() => { firewallNotice.value = '' }, 3000)
}
const firewallLoaded = ref(false)
const showFirewallForm = ref(false)
const editingFirewallId = ref<string | null>(null)
const firewallFormError = ref<string | null>(null)

// Form fields
const fwName = ref('')
const fwNameTouched = ref(false)
const fwEnabled = ref(true)
const fwAction = ref<'allow' | 'block' | 'drop_label'>('block')
const fwMetricPattern = ref('')
const fwMetricRegex = ref(false)
const fwMatchLabelKey = ref('')
const fwMatchLabelValue = ref('')
const fwMatchLabelValueRegex = ref(false)
const fwDropLabelPattern = ref('')
const fwDropLabelRegex = ref(false)

// Auto-derive a rule name from the action + patterns until the user edits the
// name themselves (fwNameTouched). Pure UX nicety; server validates the name.
function fwSuggestName() {
  if (fwNameTouched.value) return
  const src = fwAction.value === 'drop_label'
    ? (fwDropLabelPattern.value || fwMetricPattern.value || fwMatchLabelKey.value)
    : (fwMetricPattern.value || fwMatchLabelKey.value)
  const slug = src.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 48)
  const prefix = fwAction.value === 'block' ? 'block' : fwAction.value === 'allow' ? 'allow' : 'strip'
  fwName.value = slug ? `${prefix}-${slug}` : ''
}

// Client-side regex lint only — the backend (Rust regex crate) re-validates and
// remains the authority; dialects differ slightly so this is a best-effort check.
function fwRegexProblem(pattern: string, isRegex: boolean): string | null {
  if (!isRegex || !pattern.trim()) return null
  try {
    new RegExp(pattern)
    return null
  } catch (e: any) {
    return (e?.message || 'invalid regex').replace(/^Invalid regular expression:\s*/i, '')
  }
}
const fwMetricRegexError = computed(() => fwRegexProblem(fwMetricPattern.value, fwMetricRegex.value))
const fwLabelRegexError = computed(() => fwRegexProblem(fwMatchLabelValue.value, fwMatchLabelValueRegex.value))
const fwDropRegexError = computed(() => fwRegexProblem(fwDropLabelPattern.value, fwDropLabelRegex.value))

// True when the form has no match criteria at all.
const fwNoCriteria = computed(() => !fwMetricPattern.value.trim() && !fwMatchLabelKey.value.trim())

// A block rule with no match criteria drops every metric series at ingest —
// that's allowlist mode, and the server only accepts it when at least one
// enabled allow rule exists.
const fwMatchesAll = computed(() => fwAction.value === 'block' && fwNoCriteria.value)

// Are there enabled allow rules (other than the one being edited)? Decides how
// the matches-all warning reads and mirrors the server-side invariant.
const fwHasOtherAllowRules = computed(() =>
  firewallRules.value.some(r => r.action === 'allow' && r.enabled === 1 && r.id !== editingFirewallId.value)
)

// Live plain-language preview of what the rule will do.
const fwPreview = computed(() => {
  const conds: string[] = []
  if (fwMetricPattern.value.trim()) {
    conds.push(`metric ${fwMetricRegex.value ? '~' : '='} ${fwMetricPattern.value.trim()}`)
  }
  if (fwMatchLabelKey.value.trim()) {
    if (fwMatchLabelValue.value.trim()) {
      conds.push(`${fwMatchLabelKey.value.trim()} ${fwMatchLabelValueRegex.value ? '~' : '='} ${fwMatchLabelValue.value.trim()}`)
    } else {
      conds.push(`has label "${fwMatchLabelKey.value.trim()}"`)
    }
  }
  const scope = conds.length ? conds.join('  and  ') : 'every series'
  if (fwAction.value === 'allow') {
    return { verb: 'Allow', detail: `${conds.length ? scope : '— (add criteria)'}  —  exempt from all Block rules` }
  }
  if (fwAction.value === 'block') {
    return { verb: 'Block', detail: scope }
  }
  const drop = fwDropLabelPattern.value.trim()
  const dropTxt = drop ? `label keys ${fwDropLabelRegex.value ? '~' : '='} ${drop}` : 'label keys — (not set yet)'
  return { verb: 'Strip', detail: `${dropTxt}  from  ${scope}` }
})

const fwCanSave = computed(() =>
  !!fwName.value.trim()
  && !fwMetricRegexError.value && !fwLabelRegexError.value && !fwDropRegexError.value
  && (fwAction.value !== 'drop_label' || !!fwDropLabelPattern.value.trim())
  // Allowing everything is the default — an allow rule needs criteria (server
  // rejects it too). A match-all block needs an existing allow rule.
  && (fwAction.value !== 'allow' || !fwNoCriteria.value)
  && (!fwMatchesAll.value || fwHasOtherAllowRules.value)
)

async function loadFirewallRules() {
  try {
    const res = await api.listMetricFirewall()
    firewallRules.value = res.rules
    firewallLoaded.value = true
  } catch { /* admin-only; non-admins get 403 */ }
}

function openFirewallForm(rule?: MetricFirewallRule) {
  firewallFormError.value = null
  // Editing an existing rule keeps its name; only fresh rules get auto-suggestions.
  fwNameTouched.value = !!rule
  if (rule) {
    editingFirewallId.value = rule.id
    fwName.value = rule.name
    fwEnabled.value = rule.enabled === 1
    fwAction.value = rule.action
    fwMetricPattern.value = rule.metric_pattern
    fwMetricRegex.value = rule.metric_regex === 1
    fwMatchLabelKey.value = rule.match_label_key
    fwMatchLabelValue.value = rule.match_label_value
    fwMatchLabelValueRegex.value = rule.match_label_value_regex === 1
    fwDropLabelPattern.value = rule.drop_label_pattern
    fwDropLabelRegex.value = rule.drop_label_regex === 1
  } else {
    editingFirewallId.value = null
    fwName.value = ''
    fwEnabled.value = true
    fwAction.value = 'block'
    fwMetricPattern.value = ''
    fwMetricRegex.value = false
    fwMatchLabelKey.value = ''
    fwMatchLabelValue.value = ''
    fwMatchLabelValueRegex.value = false
    fwDropLabelPattern.value = ''
    fwDropLabelRegex.value = false
  }
  showFirewallForm.value = true
}

function closeFirewallForm() {
  showFirewallForm.value = false
  editingFirewallId.value = null
  firewallFormError.value = null
  fwNameTouched.value = false
}

async function saveFirewallRule() {
  firewallFormError.value = null
  const input: MetricFirewallInput = {
    name: fwName.value.trim(),
    enabled: fwEnabled.value,
    action: fwAction.value,
    metric_pattern: fwMetricPattern.value.trim(),
    metric_regex: fwMetricRegex.value,
    match_label_key: fwMatchLabelKey.value.trim(),
    match_label_value: fwMatchLabelValue.value.trim(),
    match_label_value_regex: fwMatchLabelValueRegex.value,
    drop_label_pattern: fwDropLabelPattern.value.trim(),
    drop_label_regex: fwDropLabelRegex.value,
  }
  try {
    if (editingFirewallId.value) {
      await api.updateMetricFirewall(editingFirewallId.value, input)
    } else {
      await api.createMetricFirewall(input)
    }
    closeFirewallForm()
    await loadFirewallRules()
  } catch (e: any) {
    firewallFormError.value = e.message || 'Failed to save rule'
  }
}

async function removeFirewallRule(id: string) {
  const name = firewallRules.value.find(r => r.id === id)?.name || 'Rule'
  try {
    await api.deleteMetricFirewall(id)
    firewallRules.value = firewallRules.value.filter(r => r.id !== id)
    showFirewallNotice(`Deleted "${name}"`)
  } catch (e: any) {
    showFirewallNotice(`Failed to delete "${name}": ${e?.message || e}`)
  }
}

async function toggleFirewallRule(rule: MetricFirewallRule) {
  const input: MetricFirewallInput = {
    name: rule.name,
    enabled: rule.enabled !== 1,
    action: rule.action,
    metric_pattern: rule.metric_pattern,
    metric_regex: rule.metric_regex === 1,
    match_label_key: rule.match_label_key,
    match_label_value: rule.match_label_value,
    match_label_value_regex: rule.match_label_value_regex === 1,
    drop_label_pattern: rule.drop_label_pattern,
    drop_label_regex: rule.drop_label_regex === 1,
  }
  try {
    await api.updateMetricFirewall(rule.id, input)
    await loadFirewallRules()
  } catch { /* error in api.error */ }
}

function firewallMatchSummary(rule: MetricFirewallRule): string {
  const parts: string[] = []
  if (rule.metric_pattern) {
    parts.push(rule.metric_regex === 1 ? `metric ~ ${rule.metric_pattern}` : `metric = ${rule.metric_pattern}`)
  }
  if (rule.match_label_key) {
    if (rule.match_label_value) {
      const op = rule.match_label_value_regex === 1 ? '~' : '='
      parts.push(`${rule.match_label_key} ${op} ${rule.match_label_value}`)
    } else {
      parts.push(`label: ${rule.match_label_key}`)
    }
  }
  return parts.length ? parts.join(', ') : '(all series)'
}

onMounted(async () => {
  // Hydrate tab (and integration sub-path) from URL hash if present.
  const parsed = parseHash()
  if (parsed.tab) {
    activeTab.value = parsed.tab
    if (parsed.tab === 'integrations') {
      integrationsExpanded.value = true
      activeIntegration.value = integrationsMeta.some(m => m.key === parsed.sub) ? parsed.sub : ''
    }
    if (parsed.tab === 'agent') activeAgentSubtab.value = validAgentSubtab(parsed.sub)
  }

  window.addEventListener('hashchange', onHashChange)

  await Promise.all([loadKeys(), loadServiceLinks(), loadServiceSuggestions(), loadCustomSkills(), loadTenants(), loadGroups(), loadUsers(), loadSsoConfig(), loadAlertChannels()])
  await Promise.all([loadAllUserGroups(), loadAllTenantRetention(), loadAllTenantSignals(), loadExportMaxRows(), loadGlobalRetention()])
  if (isAdmin.value) loadDeployMarkersSetting()
  if (isAdmin.value) loadRumSetting()
  if (isAdmin.value) loadCloudwatchSetting()
  loadFeatures()
  loadLicense()
  // Deep-link directly onto #agent (or #firewall) skips switchTab — load here.
  if (activeTab.value === 'agent') loadAgentBudget()
  if (activeTab.value === 'firewall' && !firewallLoaded.value) loadFirewallRules()
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHashChange)
})

// ── API Keys ──
async function loadKeys() {
  try {
    const res = await api.listApiKeys()
    keys.value = res.keys
  } catch { /* error in api.error */ }
}

async function createKey() {
  if (!keyName.value.trim()) return
  try {
    const created = await api.createApiKey({ name: keyName.value.trim() })
    newlyCreated.value = created
    keyName.value = ''
    showForm.value = false
    await loadKeys()
  } catch { /* error in api.error */ }
}

async function removeKey(id: string) {
  try {
    await api.deleteApiKey(id)
    keys.value = keys.value.filter(k => k.id !== id)
    // modal handles close
    if (newlyCreated.value?.id === id) {
      newlyCreated.value = null
    }
  } catch { /* error in api.error */ }
}

async function copyKey() {
  if (!newlyCreated.value) return
  try {
    await navigator.clipboard.writeText(newlyCreated.value.key)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* clipboard fallback: user can manually copy */ }
}

function dismissCreated() {
  newlyCreated.value = null
  copied.value = false
}

// ── Service Links ──
async function loadServiceLinks() {
  try {
    const res = await api.listServiceLinks()
    serviceLinks.value = res.links
  } catch { /* error in api.error */ }
}

async function loadServiceSuggestions() {
  try {
    serviceSuggestions.value = await api.suggestValues('service_name')
  } catch { /* ignore */ }
}

async function createServiceLink() {
  if (!linkServiceName.value.trim() || !linkGithubRepo.value.trim()) return
  try {
    await api.createServiceLink({
      service_name: linkServiceName.value.trim(),
      github_repo: linkGithubRepo.value.trim(),
      default_branch: linkDefaultBranch.value.trim() || 'main',
      root_path: linkRootPath.value.trim(),
    })
    linkServiceName.value = ''
    linkGithubRepo.value = ''
    linkDefaultBranch.value = 'main'
    linkRootPath.value = ''
    showLinkForm.value = false
    await loadServiceLinks()
  } catch { /* error in api.error */ }
}

function closeLinkForm() {
  showLinkForm.value = false
  linkServiceName.value = ''
  linkGithubRepo.value = ''
  linkDefaultBranch.value = 'main'
  linkRootPath.value = ''
}

async function removeServiceLink(serviceName: string) {
  try {
    await api.deleteServiceLink(serviceName)
    serviceLinks.value = serviceLinks.value.filter(l => l.service_name !== serviceName)
    // modal handles close
  } catch { /* error in api.error */ }
}

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return ts }
}
</script>

<template>
  <div class="settings-page">
    <div class="settings-shell">
      <!-- ── Left section rail ── -->
      <aside
        class="settings-rail"
        role="tablist"
        aria-label="Settings sections"
        @keydown="onTabKeydown"
      >
        <div class="rail-brand">Settings</div>
        <div v-for="g in groupedTabs" :key="g.name" class="rail-group">
          <div class="rail-group-label">{{ g.name }}</div>
          <template v-for="t in g.items" :key="t.id">
            <button
              v-if="t.id === 'integrations'"
              :class="['rail-item', 'rail-item--parent', { active: activeTab === t.id }]"
              :tabindex="activeTab === t.id ? 0 : -1"
              role="tab"
              :aria-selected="activeTab === t.id"
              :aria-controls="`panel-${t.id}`"
              :aria-expanded="integrationsExpanded"
              @click="selectIntegrations"
            >
              <span class="rail-item-label">{{ t.label }}</span>
              <span
                class="rail-caret"
                :class="{ open: integrationsExpanded }"
                role="button"
                :aria-label="integrationsExpanded ? 'Collapse integrations' : 'Expand integrations'"
                @click.stop="integrationsExpanded = !integrationsExpanded"
              >›</span>
            </button>
            <button
              v-else
              :class="['rail-item', { active: activeTab === t.id }]"
              :tabindex="activeTab === t.id ? 0 : -1"
              role="tab"
              :aria-selected="activeTab === t.id"
              :aria-controls="`panel-${t.id}`"
              @click="setTab(t.id)"
            >{{ t.label }}</button>

            <!-- Second-level: one entry per integration card -->
            <div
              v-if="t.id === 'integrations'"
              :class="['rail-subgroup', { open: integrationsExpanded }]"
            >
              <button
                v-for="(s, i) in integrationSubItems"
                :key="s.key"
                :class="['rail-subitem', { active: activeTab === 'integrations' && activeIntegration === s.key }]"
                :style="{ '--i': i }"
                @click="selectIntegration(s.key)"
              >{{ s.label }}</button>
            </div>
          </template>
        </div>
      </aside>

      <!-- ── Content column ── -->
      <div class="settings-content">
        <header class="content-head">
          <h1 class="content-title">{{ activeTabDef.label }}</h1>
          <p class="content-hint">{{ activeHint }}</p>
        </header>

    <!-- ── Panels ── -->
    <!-- API Keys Section -->
    <div
      v-show="activeTab === 'keys'"
      :id="'panel-keys'"
      class="section"
      role="tabpanel"
      aria-labelledby="tab-keys"
    >
      <div class="section-card card">
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">API Keys</h2>
            <p class="card-desc text-secondary">
              Generate API keys for programmatic access. Keys are 64-character alphanumeric strings.
            </p>
          </div>
          <button class="btn-create" @click="showForm = !showForm">
            {{ showForm ? 'Cancel' : '+ Create API Key' }}
          </button>
        </div>

        <!-- Create Key Form -->
        <div v-if="showForm" class="create-form fade-in">
          <div class="form-row-inline">
            <div class="form-group-inline">
              <label class="form-label">Key Name</label>
              <input
                v-model="keyName"
                class="form-input mono"
                placeholder="e.g. ci-pipeline, grafana-read"
                @keyup.enter="createKey"
              />
            </div>
            <div class="form-actions-inline">
              <button class="btn btn-secondary" @click="showForm = false; keyName = ''">Cancel</button>
              <button class="btn btn-primary" @click="createKey" :disabled="!keyName.trim()">Create</button>
            </div>
          </div>
        </div>

        <!-- Newly Created Key Display -->
        <div v-if="newlyCreated" class="key-created fade-in">
          <div class="key-created-header">
            <span class="key-created-title">Key created: {{ newlyCreated.name }}</span>
            <button class="action-btn" @click="dismissCreated">&times;</button>
          </div>
          <div class="key-created-box">
            <code class="key-value mono">{{ newlyCreated.key }}</code>
            <button class="btn-copy" @click="copyKey">
              {{ copied ? 'Copied!' : 'Copy' }}
            </button>
          </div>
          <div class="key-created-warning">
            This key will only be shown once. Copy it now.
          </div>
        </div>

        <!-- Error State -->
        <div v-if="api.error.value" class="error-row">
          <span class="err-mark">!</span>
          <span>{{ api.error.value }}</span>
        </div>

        <!-- Keys Table -->
        <div v-if="keys.length > 0" class="keys-table">
          <div class="table-header">
            <div class="col-name">Name</div>
            <div class="col-key">Key</div>
            <div class="col-created">Created</div>
            <div class="col-actions">Actions</div>
          </div>
          <div v-for="k in keys" :key="k.id" class="table-row">
            <div class="col-name">{{ k.name }}</div>
            <div class="col-key mono text-muted">{{ k.prefix }}...</div>
            <div class="col-created mono text-secondary">{{ formatDate(k.created_at) }}</div>
            <div class="col-actions">
              <button class="action-btn action-btn-danger" @click="askDelete('key', k.id, k.name)">Delete</button>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else-if="!showForm && !newlyCreated" class="keys-empty">
          <div class="text-muted">No API keys</div>
          <div class="text-secondary fs-11">Create one to get started</div>
        </div>
      </div>
    </div>

    <!-- Auth Section -->
    <div
      v-show="activeTab === 'auth'"
      id="panel-auth"
      class="section"
      role="tabpanel"
      aria-labelledby="tab-auth"
    >
      <!-- Section A: Local Authentication -->
      <div class="section-card card">
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Local Authentication</h2>
            <p class="card-desc text-secondary">
              Local authentication is always available as a fallback, even when SSO is configured.
            </p>
          </div>
        </div>
        <div class="auth-status-row">
          <div class="auth-status-indicator auth-status-active"></div>
          <div>
            <div style="font-size: 12px; font-weight: 500; color: var(--text-primary);">Local auth is enabled</div>
            <div style="font-size: 11px; color: var(--text-muted);">Default admin: <span class="mono">admin</span></div>
          </div>
        </div>
      </div>

      <!-- Section B: Single Sign-On -->
      <div class="section-card card">
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Single Sign-On</h2>
            <p class="card-desc text-secondary">
              Authenticate users via your identity provider using OIDC or SAML 2.0.
            </p>
          </div>
        </div>

        <!-- SSO not configured: show configure button -->
        <div v-if="!ssoProvider.enabled" class="auth-sso-disabled">
          <p style="font-size: 12px; color: var(--text-secondary); line-height: 1.5; max-width: 52ch; margin-bottom: var(--sp-3);">
            SSO lets your team sign in with their existing identity provider (Google Workspace, Okta, Azure AD, etc.) instead of managing separate Rush passwords.
          </p>
          <button class="btn btn-primary" @click="openWizard">Configure SSO</button>
        </div>

        <!-- SSO enabled: provider info + reconfigure -->
        <div v-if="ssoProvider.enabled" class="auth-sso-enabled fade-in">
          <div class="auth-sso-summary">
            <div style="display: flex; align-items: center; gap: var(--sp-2);">
              <span style="font-size: 13px; font-weight: 500; color: var(--text-primary);">{{ ssoProvider.name || 'Unnamed provider' }}</span>
              <span class="cell-tag cell-tag-amber">{{ (ssoProvider.protocol || 'oidc').toUpperCase() }}</span>
            </div>
            <div style="display: flex; gap: var(--sp-2);">
              <button class="btn btn-secondary" @click="openWizard">Reconfigure</button>
              <label class="toggle">
                <input type="checkbox" v-model="ssoProvider.enabled" @change="saveSsoConfig" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <!-- Group Mappings -->
          <div class="auth-section-block">
            <div class="auth-section-label">IdP Group Mappings</div>
            <p class="auth-mappings-hint">Map groups from your identity provider to Rush permission groups. Users are assigned the matching group on sign-in.</p>

            <div v-if="ssoMappings.length > 0" class="auth-mappings-list">
              <div v-for="m in ssoMappings" :key="m.id" class="auth-mapping-row">
                <span class="auth-mapping-idp mono">{{ m.idp_group }}</span>
                <svg class="auth-mapping-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="17" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
                <span class="auth-mapping-rush"><span class="auth-mapping-tag">{{ groupNameById(m.rush_group_id) }}</span></span>
                <button class="auth-mapping-icon-btn" title="Edit mapping" @click="openMappingForm(m)" aria-label="Edit mapping">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="auth-mapping-icon-btn auth-mapping-delete" title="Remove mapping" @click="removeSsoMapping(m.id)" aria-label="Remove mapping">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
            <div v-else class="auth-mappings-empty">No group mappings configured yet.</div>

            <div class="auth-mappings-footer">
              <button class="btn btn-primary auth-mapping-add-btn" @click="openMappingForm()">+ Add Mapping</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- IdP Group Mapping Modal (centered pop-up) -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showMappingForm" class="delete-modal-overlay" @click.self="closeMappingForm">
          <div class="delete-modal mapping-modal" role="dialog" aria-label="IdP group mapping">
            <div class="mapping-modal-header">
              <span class="delete-modal-title">{{ editingMappingId ? 'Edit Group Mapping' : 'Add Group Mapping' }}</span>
              <button class="group-drawer-close" @click="closeMappingForm" aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <p class="text-secondary fs-11" style="line-height: 1.5; margin: 0; width: 100%;">
              Map a group from your identity provider to a Rush permission group. Users in this IdP group are assigned the Rush group on sign-in.
            </p>
            <div class="form-group-inline">
              <label class="form-label">IdP Group Name</label>
              <input
                v-model="mappingIdpGroup"
                class="form-input mono"
                placeholder="e.g. engineering"
                @keyup.enter="saveMappingForm"
              />
            </div>
            <div class="form-group-inline">
              <label class="form-label">Rush Group</label>
              <select v-model="mappingRushGroupId" class="form-input">
                <option value="" disabled>Select Rush group</option>
                <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
              </select>
            </div>
            <div class="delete-modal-actions">
              <button class="btn btn-secondary" @click="closeMappingForm">Cancel</button>
              <button
                class="btn btn-primary"
                @click="saveMappingForm"
                :disabled="!mappingIdpGroup || !mappingRushGroupId"
              >
                {{ editingMappingId ? 'Save' : 'Add Mapping' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- SSO Wizard Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="wizardOpen" class="delete-modal-overlay" @click.self="closeWizard">
          <div class="delete-modal wizard-modal">
            <!-- Step indicator -->
            <div v-if="wizardStep >= 2" class="wizard-step-indicator">
              <template v-for="s in wizardTotalSteps" :key="s">
                <div :class="['wizard-dot', { 'wizard-dot-active': guidedStepNumber >= s, 'wizard-dot-current': guidedStepNumber === s }]"></div>
                <div v-if="s < wizardTotalSteps" :class="['wizard-line', { 'wizard-line-active': guidedStepNumber > s }]"></div>
              </template>
            </div>

            <!-- Step 0: Choose Provider -->
            <template v-if="wizardStep === 0">
              <div class="wizard-title">Choose your identity provider</div>
              <div class="wizard-provider-grid">
                <button
                  v-for="p in providerCards"
                  :key="p.id"
                  :class="['wizard-provider-card', { 'wizard-provider-active': wizardProvider === p.id }]"
                  @click="selectProvider(p.id)"
                >
                  <span class="wizard-provider-icon">
                    <svg v-if="p.id === 'google'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
                    <svg v-else-if="p.id === 'okta'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
                    <svg v-else-if="p.id === 'azure'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/></svg>
                    <svg v-else-if="p.id === 'custom-oidc'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  </span>
                  <span class="wizard-provider-label">{{ p.label }}</span>
                  <span class="wizard-provider-sub">{{ p.subtitle }}</span>
                </button>
              </div>
            </template>

            <!-- Step 1: Choose Setup Method -->
            <template v-if="wizardStep === 1">
              <div class="wizard-title">How would you like to set up {{ wizardProviderName }}?</div>
              <div class="wizard-method-grid">
                <button class="wizard-method-card" @click="selectMethod('self')">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  <span class="wizard-method-label">I'll set it up myself</span>
                  <span class="wizard-method-desc">Walk through the configuration steps now</span>
                </button>
                <button class="wizard-method-card" @click="generateMagicLink">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  <span class="wizard-method-label">Generate a link for my security team</span>
                  <span class="wizard-method-desc">Share a one-time setup link (expires in 48 hours)</span>
                </button>
              </div>

              <!-- Magic link result (shown after generating) -->
              <div v-if="wizardMagicToken" class="wizard-magic-result fade-in">
                <div class="wizard-magic-info">Share this link with your security/IT team. They'll walk through the same setup wizard. The link expires in 48 hours or after SSO is saved.</div>
                <div class="wizard-magic-url-box">
                  <code class="key-value mono" style="font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis;">{{ wizardMagicToken.url }}</code>
                  <button class="btn-copy" @click="copyMagicLink">{{ wizardMagicCopied ? 'Copied!' : 'Copy' }}</button>
                </div>
              </div>

              <div class="wizard-nav">
                <button class="btn btn-secondary" @click="wizardBack">Back</button>
                <span></span>
              </div>
            </template>

            <!-- Step 2+: Guided Setup Steps -->
            <!-- ═══ Google Workspace SAML ═══ -->
            <template v-if="wizardStep >= 2 && wizardProvider === 'google'">
              <div class="wizard-step-label">Step {{ guidedStepNumber }} of {{ wizardTotalSteps }}</div>

              <div v-if="guidedStepNumber === 1" class="wizard-step-content">
                <div class="wizard-title">Create the SAML app in Google</div>
                <div class="wizard-instruction">
                  Go to <strong>admin.google.com</strong> &rarr; Apps &rarr; Web and mobile apps &rarr; Add app &rarr; <strong>Add custom SAML app</strong>.
                </div>
                <div class="wizard-instruction">Enter the app name:</div>
                <div class="wizard-copyable-box">
                  <code>Rush Observability</code>
                </div>
              </div>

              <div v-if="guidedStepNumber === 2" class="wizard-step-content">
                <div class="wizard-title">Enter your IdP details</div>
                <div class="wizard-instruction">In Google admin, download the certificate and copy the SSO URL, then paste them here:</div>
                <div class="form-group-inline">
                  <label class="form-label">IdP Certificate</label>
                  <textarea v-model="wizardCert" class="cert-area" :class="['form-input', 'mono', { 'input-error': wizardTouched.cert && wizardErrors.cert }]" rows="4" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" @blur="touchField('cert')"></textarea>
                  <div v-if="wizardTouched.cert && wizardErrors.cert" class="field-error">{{ wizardErrors.cert }}</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">SSO URL</label>
                  <input v-model="wizardSsoUrl" :class="['form-input', 'mono', { 'input-error': wizardTouched.ssoUrl && wizardErrors.ssoUrl }]" placeholder="https://accounts.google.com/o/saml2/idp?idpid=..." @blur="touchField('ssoUrl')" />
                  <div v-if="wizardTouched.ssoUrl && wizardErrors.ssoUrl" class="field-error">{{ wizardErrors.ssoUrl }}</div>
                </div>
              </div>

              <div v-if="guidedStepNumber === 3" class="wizard-step-content">
                <div class="wizard-title">Copy these values into Google admin</div>
                <div class="wizard-instruction">In the Google SAML app wizard, paste these values:</div>
                <div class="form-group-inline">
                  <label class="form-label">ACS URL</label>
                  <div class="wizard-copyable-box">
                    <code>{{ hostname }}/auth/sso/acs</code>
                    <button class="btn-copy btn-copy-sm" @click="copyText(hostname + '/auth/sso/acs')">Copy</button>
                  </div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Entity ID</label>
                  <div class="wizard-copyable-box">
                    <code>{{ hostname }}</code>
                    <button class="btn-copy btn-copy-sm" @click="copyText(hostname)">Copy</button>
                  </div>
                </div>
                <div class="wizard-instruction">Set Name ID format to <strong>Email</strong>.</div>
              </div>

              <div v-if="guidedStepNumber === 4" class="wizard-step-content">
                <div class="wizard-title">Configure attributes and claim mapping</div>
                <div class="wizard-instruction">In Google admin under <strong>Attributes</strong>, map your Google Directory fields to these App attribute names:</div>
                <div class="form-group-inline">
                  <label class="form-label">Email Claim</label>
                  <input v-model="wizardEmailClaim" :class="['form-input', 'mono', { 'input-error': wizardTouched.emailClaim && wizardErrors.emailClaim }]" placeholder="email" @blur="touchField('emailClaim')" />
                  <div v-if="wizardTouched.emailClaim && wizardErrors.emailClaim" class="field-error">{{ wizardErrors.emailClaim }}</div>
                  <div class="field-hint">Map <strong>Primary email</strong> → this App attribute name (required)</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">First Name Claim</label>
                  <input v-model="wizardFirstNameClaim" class="form-input mono" placeholder="first_name" />
                  <div class="field-hint">Map <strong>First name</strong> → this App attribute name (optional)</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Last Name Claim</label>
                  <input v-model="wizardLastNameClaim" class="form-input mono" placeholder="last_name" />
                  <div class="field-hint">Map <strong>Last name</strong> → this App attribute name (optional)</div>
                </div>
                <div class="wizard-instruction mt-2">Then open the <strong>Group membership</strong> section (separate from Attributes), select the Google Groups to include, and set the <strong>App attribute</strong> name to:</div>
                <div class="form-group-inline">
                  <label class="form-label">App attribute</label>
                  <div class="wizard-copyable-box">
                    <code>groups</code>
                  </div>
                </div>
                <div class="wizard-note">
                  <strong>Note:</strong> Each Google group you send only grants access if a group with the <em>same name</em> exists in Rush. Create the matching group under <strong>Settings &rarr; Groups</strong> first, otherwise members sign in with no permissions.
                </div>
                <div class="wizard-instruction mt-2">Finally, open the app's <strong>User access</strong> section. A new app defaults to <strong>OFF for everyone</strong> &mdash; turn it <strong>ON for everyone</strong> (or for the chosen org units/groups) so users can sign in.</div>
              </div>

              <div v-if="guidedStepNumber === 5" class="wizard-step-content">
                <div class="wizard-title">Review and save</div>
                <div class="wizard-review-summary">
                  <div class="wizard-review-row"><span class="wizard-review-label">Provider</span><span>Google Workspace (SAML)</span></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">ACS URL</span><code class="mono">{{ hostname }}/auth/sso/acs</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Entity ID</span><code class="mono">{{ hostname }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">SSO URL</span><span :class="wizardErrors.ssoUrl ? 'review-invalid' : 'review-valid'">{{ wizardErrors.ssoUrl ? '!' : '' }}</span><code class="mono break-all">{{ wizardSsoUrl || '(not set)' }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Certificate</span><span :class="wizardErrors.cert ? 'review-invalid' : 'review-valid'">{{ wizardErrors.cert ? '!' : '' }}</span><span>{{ wizardCert ? 'Provided' : 'Not set' }}</span></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Email Claim</span><code class="mono">{{ wizardEmailClaim }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">First Name</span><code class="mono">{{ wizardFirstNameClaim }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Last Name</span><code class="mono">{{ wizardLastNameClaim }}</code></div>
                </div>
              </div>
            </template>

            <!-- ═══ Okta SAML ═══ -->
            <template v-if="wizardStep >= 2 && wizardProvider === 'okta'">
              <div class="wizard-step-label">Step {{ guidedStepNumber }} of {{ wizardTotalSteps }}</div>

              <div v-if="guidedStepNumber === 1" class="wizard-step-content">
                <div class="wizard-title">Create the SAML app in Okta</div>
                <div class="wizard-instruction">In Okta Admin, go to <strong>Applications</strong> &rarr; <strong>Create App Integration</strong> &rarr; <strong>SAML 2.0</strong>.</div>
                <div class="wizard-instruction">On the <strong>General Settings</strong> step, enter the app name:</div>
                <div class="wizard-copyable-box"><code>Rush Observability</code></div>
              </div>

              <div v-if="guidedStepNumber === 2" class="wizard-step-content">
                <div class="wizard-title">Configure SAML in Okta</div>
                <div class="wizard-instruction">On Okta's <strong>Configure SAML</strong> step, set:</div>
                <div class="form-group-inline">
                  <label class="form-label">Single sign-on URL</label>
                  <div class="wizard-copyable-box">
                    <code>{{ hostname }}/auth/sso/acs</code>
                    <button class="btn-copy btn-copy-sm" @click="copyText(hostname + '/auth/sso/acs')">Copy</button>
                  </div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Audience URI (SP Entity ID)</label>
                  <div class="wizard-copyable-box">
                    <code>{{ hostname }}</code>
                    <button class="btn-copy btn-copy-sm" @click="copyText(hostname)">Copy</button>
                  </div>
                </div>
                <div class="wizard-instruction mt-2">Set <strong>Name ID format</strong> to <strong>EmailAddress</strong>, then click <strong>Next</strong> to finish creating the app.</div>
                <div class="wizard-note"><strong>Email and name need no SAML setup</strong> — Rush identifies the user from the SAML <strong>NameID</strong> (their email), so login works without any attribute statements.</div>
                <div class="wizard-instruction"><strong>Only if you use group-based roles:</strong> after the app is created, open it &rarr; <strong>Sign On</strong> tab &rarr; <strong>Attribute statements</strong> card &rarr; <strong>Show legacy configuration</strong> &rarr; under <strong>Group attribute statements</strong> add — Name <code>groups</code>, Name format <strong>Unspecified</strong>, Filter <strong>Matches regex</strong>, value <code>.*</code></div>
              </div>

              <div v-if="guidedStepNumber === 3" class="wizard-step-content">
                <div class="wizard-title">Enter your IdP details</div>
                <div class="wizard-instruction">In Okta, on the app's <strong>Sign On</strong> tab, expand the SAML <strong>Metadata details</strong> (or <strong>View SAML setup instructions</strong>) and copy these:</div>
                <div class="form-group-inline">
                  <label class="form-label">IdP Certificate</label>
                  <textarea v-model="wizardCert" class="cert-area" :class="['form-input', 'mono', { 'input-error': wizardTouched.cert && wizardErrors.cert }]" rows="4" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" @blur="touchField('cert')"></textarea>
                  <div class="field-hint">Okta's <strong>Signing Certificate</strong> — click <strong>Copy</strong> (or Download the .cert and paste its contents here).</div>
                  <div v-if="wizardTouched.cert && wizardErrors.cert" class="field-error">{{ wizardErrors.cert }}</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">SSO URL</label>
                  <input v-model="wizardSsoUrl" :class="['form-input', 'mono', { 'input-error': wizardTouched.ssoUrl && wizardErrors.ssoUrl }]" placeholder="https://your-org.okta.com/app/.../sso/saml" @blur="touchField('ssoUrl')" />
                  <div class="field-hint">Okta's <strong>Sign on URL</strong> (not the Metadata URL or Issuer).</div>
                  <div v-if="wizardTouched.ssoUrl && wizardErrors.ssoUrl" class="field-error">{{ wizardErrors.ssoUrl }}</div>
                </div>
              </div>

              <div v-if="guidedStepNumber === 4" class="wizard-step-content">
                <div class="wizard-title">Review and save</div>
                <div class="wizard-review-summary">
                  <div class="wizard-review-row"><span class="wizard-review-label">Provider</span><span>Okta (SAML)</span></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">SSO URL</span><span :class="wizardErrors.ssoUrl ? 'review-invalid' : 'review-valid'">{{ wizardErrors.ssoUrl ? '!' : '' }}</span><code class="mono break-all">{{ wizardSsoUrl || '(not set)' }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Entity ID</span><code class="mono">{{ hostname }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Certificate</span><span :class="wizardErrors.cert ? 'review-invalid' : 'review-valid'">{{ wizardErrors.cert ? '!' : '' }}</span><span>{{ wizardCert ? 'Provided' : 'Not set' }}</span></div>
                </div>
              </div>
            </template>

            <!-- ═══ Azure AD (same flow as Okta with minor label changes) ═══ -->
            <template v-if="wizardStep >= 2 && wizardProvider === 'azure'">
              <div class="wizard-step-label">Step {{ guidedStepNumber }} of {{ wizardTotalSteps }}</div>

              <div v-if="guidedStepNumber === 1" class="wizard-step-content">
                <div class="wizard-title">Create the SAML app in Azure AD</div>
                <div class="wizard-instruction">In Azure Portal, go to <strong>Azure Active Directory</strong> &rarr; <strong>Enterprise Applications</strong> &rarr; <strong>New Application</strong> &rarr; <strong>Create your own application</strong> &rarr; Non-gallery, SAML.</div>
              </div>

              <div v-if="guidedStepNumber === 2" class="wizard-step-content">
                <div class="wizard-title">Configure Basic SAML settings</div>
                <div class="form-group-inline">
                  <label class="form-label">Reply URL (ACS URL)</label>
                  <div class="wizard-copyable-box">
                    <code>{{ hostname }}/auth/sso/acs</code>
                    <button class="btn-copy btn-copy-sm" @click="copyText(hostname + '/auth/sso/acs')">Copy</button>
                  </div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Identifier (Entity ID)</label>
                  <div class="wizard-copyable-box">
                    <code>{{ hostname }}</code>
                    <button class="btn-copy btn-copy-sm" @click="copyText(hostname)">Copy</button>
                  </div>
                </div>
              </div>

              <div v-if="guidedStepNumber === 3" class="wizard-step-content">
                <div class="wizard-title">Add a group claim and configure attribute mapping</div>
                <div class="wizard-instruction">Under <strong>User Attributes & Claims</strong>, add a group claim that emits <strong>Security groups</strong> with the attribute name <code class="mono">groups</code>.</div>
                <div class="form-group-inline mt-2">
                  <label class="form-label">Email Claim</label>
                  <input v-model="wizardEmailClaim" :class="['form-input', 'mono', { 'input-error': wizardTouched.emailClaim && wizardErrors.emailClaim }]" placeholder="email" @blur="touchField('emailClaim')" />
                  <div v-if="wizardTouched.emailClaim && wizardErrors.emailClaim" class="field-error">{{ wizardErrors.emailClaim }}</div>
                  <div class="field-hint">The claim/attribute name containing the user's email address</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">First Name Claim</label>
                  <input v-model="wizardFirstNameClaim" class="form-input mono" placeholder="FirstName" />
                  <div class="field-hint">The claim for the user's first name (OIDC: first_name, SAML: FirstName)</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Last Name Claim</label>
                  <input v-model="wizardLastNameClaim" class="form-input mono" placeholder="LastName" />
                  <div class="field-hint">The claim for the user's last name (OIDC: last_name, SAML: LastName)</div>
                </div>
              </div>

              <div v-if="guidedStepNumber === 4" class="wizard-step-content">
                <div class="wizard-title">Enter your IdP details</div>
                <div class="wizard-instruction">Download the Base64 certificate and copy the Login URL from Azure:</div>
                <div class="form-group-inline">
                  <label class="form-label">IdP Certificate</label>
                  <textarea v-model="wizardCert" class="cert-area" :class="['form-input', 'mono', { 'input-error': wizardTouched.cert && wizardErrors.cert }]" rows="4" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" @blur="touchField('cert')"></textarea>
                  <div v-if="wizardTouched.cert && wizardErrors.cert" class="field-error">{{ wizardErrors.cert }}</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Login URL</label>
                  <input v-model="wizardSsoUrl" :class="['form-input', 'mono', { 'input-error': wizardTouched.ssoUrl && wizardErrors.ssoUrl }]" placeholder="https://login.microsoftonline.com/.../saml2" @blur="touchField('ssoUrl')" />
                  <div v-if="wizardTouched.ssoUrl && wizardErrors.ssoUrl" class="field-error">{{ wizardErrors.ssoUrl }}</div>
                </div>
              </div>

              <div v-if="guidedStepNumber === 5" class="wizard-step-content">
                <div class="wizard-title">Review and save</div>
                <div class="wizard-review-summary">
                  <div class="wizard-review-row"><span class="wizard-review-label">Provider</span><span>Azure AD (SAML)</span></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Login URL</span><span :class="wizardErrors.ssoUrl ? 'review-invalid' : 'review-valid'">{{ wizardErrors.ssoUrl ? '!' : '' }}</span><code class="mono break-all">{{ wizardSsoUrl || '(not set)' }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Entity ID</span><code class="mono">{{ hostname }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Certificate</span><span :class="wizardErrors.cert ? 'review-invalid' : 'review-valid'">{{ wizardErrors.cert ? '!' : '' }}</span><span>{{ wizardCert ? 'Provided' : 'Not set' }}</span></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Email Claim</span><code class="mono">{{ wizardEmailClaim }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">First Name</span><code class="mono">{{ wizardFirstNameClaim }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Last Name</span><code class="mono">{{ wizardLastNameClaim }}</code></div>
                </div>
              </div>
            </template>

            <!-- ═══ Custom OIDC ═══ -->
            <template v-if="wizardStep >= 2 && wizardProvider === 'custom-oidc'">
              <div class="wizard-step-label">Step {{ guidedStepNumber }} of {{ wizardTotalSteps }}</div>

              <div v-if="guidedStepNumber === 1" class="wizard-step-content">
                <div class="wizard-title">Enter your OIDC provider details</div>
                <div class="form-group-inline">
                  <label class="form-label">Provider Name</label>
                  <input v-model="wizardProviderName" :class="['form-input', { 'input-error': wizardTouched.providerName && wizardErrors.providerName }]" placeholder="e.g. Keycloak, Auth0" @blur="touchField('providerName')" />
                  <div v-if="wizardTouched.providerName && wizardErrors.providerName" class="field-error">{{ wizardErrors.providerName }}</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Issuer URL</label>
                  <input v-model="wizardIssuerUrl" :class="['form-input', 'mono', { 'input-error': wizardTouched.issuerUrl && wizardErrors.issuerUrl }]" placeholder="https://your-idp.example.com" @blur="touchField('issuerUrl')" />
                  <div v-if="wizardTouched.issuerUrl && wizardErrors.issuerUrl" class="field-error">{{ wizardErrors.issuerUrl }}</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Client ID</label>
                  <input v-model="wizardClientId" :class="['form-input', 'mono', { 'input-error': wizardTouched.clientId && wizardErrors.clientId }]" placeholder="client-id" @blur="touchField('clientId')" />
                  <div v-if="wizardTouched.clientId && wizardErrors.clientId" class="field-error">{{ wizardErrors.clientId }}</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Client Secret</label>
                  <input v-model="wizardClientSecret" type="password" autocomplete="off" :class="['form-input', 'mono', { 'input-error': wizardTouched.clientSecret && wizardErrors.clientSecret }]" placeholder="client-secret" @blur="touchField('clientSecret')" />
                  <div v-if="wizardTouched.clientSecret && wizardErrors.clientSecret" class="field-error">{{ wizardErrors.clientSecret }}</div>
                </div>
              </div>

              <div v-if="guidedStepNumber === 2" class="wizard-step-content">
                <div class="wizard-title">Configure scopes and claims</div>
                <div class="form-group-inline">
                  <label class="form-label">Scopes</label>
                  <input v-model="wizardOidcScopes" class="form-input mono" placeholder="openid profile email groups" />
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Groups Claim</label>
                  <input v-model="wizardGroupsClaim" :class="['form-input', 'mono', { 'input-error': wizardTouched.groupsClaim && wizardErrors.groupsClaim }]" placeholder="groups" @blur="touchField('groupsClaim')" />
                  <div v-if="wizardTouched.groupsClaim && wizardErrors.groupsClaim" class="field-error">{{ wizardErrors.groupsClaim }}</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Email Claim</label>
                  <input v-model="wizardEmailClaim" :class="['form-input', 'mono', { 'input-error': wizardTouched.emailClaim && wizardErrors.emailClaim }]" placeholder="email" @blur="touchField('emailClaim')" />
                  <div v-if="wizardTouched.emailClaim && wizardErrors.emailClaim" class="field-error">{{ wizardErrors.emailClaim }}</div>
                  <div class="field-hint">The claim/attribute name containing the user's email address</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">First Name Claim</label>
                  <input v-model="wizardFirstNameClaim" class="form-input mono" placeholder="first_name" />
                  <div class="field-hint">The claim for the user's first name (OIDC: first_name, SAML: FirstName)</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Last Name Claim</label>
                  <input v-model="wizardLastNameClaim" class="form-input mono" placeholder="last_name" />
                  <div class="field-hint">The claim for the user's last name (OIDC: last_name, SAML: LastName)</div>
                </div>
              </div>

              <div v-if="guidedStepNumber === 3" class="wizard-step-content">
                <div class="wizard-title">Review and save</div>
                <div class="wizard-review-summary">
                  <div class="wizard-review-row"><span class="wizard-review-label">Provider</span><span>{{ wizardProviderName || 'Custom OIDC' }}</span></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Issuer URL</span><span :class="wizardErrors.issuerUrl ? 'review-invalid' : 'review-valid'">{{ wizardErrors.issuerUrl ? '!' : '' }}</span><code class="mono break-all">{{ wizardIssuerUrl || '(not set)' }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Client ID</span><span :class="wizardErrors.clientId ? 'review-invalid' : 'review-valid'">{{ wizardErrors.clientId ? '!' : '' }}</span><code class="mono">{{ wizardClientId || '(not set)' }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Scopes</span><code class="mono">{{ wizardOidcScopes }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Groups Claim</span><code class="mono">{{ wizardGroupsClaim }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Email Claim</span><code class="mono">{{ wizardEmailClaim }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">First Name</span><code class="mono">{{ wizardFirstNameClaim }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Last Name</span><code class="mono">{{ wizardLastNameClaim }}</code></div>
                </div>
              </div>
            </template>

            <!-- ═══ Custom SAML ═══ -->
            <template v-if="wizardStep >= 2 && wizardProvider === 'custom-saml'">
              <div class="wizard-step-label">Step {{ guidedStepNumber }} of {{ wizardTotalSteps }}</div>

              <div v-if="guidedStepNumber === 1" class="wizard-step-content">
                <div class="wizard-title">Configure your IdP with these values</div>
                <div class="form-group-inline">
                  <label class="form-label">ACS URL</label>
                  <div class="wizard-copyable-box">
                    <code>{{ hostname }}/auth/sso/acs</code>
                    <button class="btn-copy btn-copy-sm" @click="copyText(hostname + '/auth/sso/acs')">Copy</button>
                  </div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Entity ID</label>
                  <div class="wizard-copyable-box">
                    <code>{{ hostname }}</code>
                    <button class="btn-copy btn-copy-sm" @click="copyText(hostname)">Copy</button>
                  </div>
                </div>
              </div>

              <div v-if="guidedStepNumber === 2" class="wizard-step-content">
                <div class="wizard-title">Enter your IdP details</div>
                <div class="form-group-inline">
                  <label class="form-label">IdP SSO URL</label>
                  <input v-model="wizardSsoUrl" :class="['form-input', 'mono', { 'input-error': wizardTouched.ssoUrl && wizardErrors.ssoUrl }]" placeholder="https://idp.example.com/saml/sso" @blur="touchField('ssoUrl')" />
                  <div v-if="wizardTouched.ssoUrl && wizardErrors.ssoUrl" class="field-error">{{ wizardErrors.ssoUrl }}</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">IdP Certificate</label>
                  <textarea v-model="wizardCert" class="cert-area" :class="['form-input', 'mono', { 'input-error': wizardTouched.cert && wizardErrors.cert }]" rows="4" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" @blur="touchField('cert')"></textarea>
                  <div v-if="wizardTouched.cert && wizardErrors.cert" class="field-error">{{ wizardErrors.cert }}</div>
                </div>
                <div class="form-group-inline mt-2">
                  <label class="form-label">Email Claim</label>
                  <input v-model="wizardEmailClaim" :class="['form-input', 'mono', { 'input-error': wizardTouched.emailClaim && wizardErrors.emailClaim }]" placeholder="email" @blur="touchField('emailClaim')" />
                  <div v-if="wizardTouched.emailClaim && wizardErrors.emailClaim" class="field-error">{{ wizardErrors.emailClaim }}</div>
                  <div class="field-hint">The claim/attribute name containing the user's email address</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">First Name Claim</label>
                  <input v-model="wizardFirstNameClaim" class="form-input mono" placeholder="FirstName" />
                  <div class="field-hint">The claim for the user's first name (OIDC: first_name, SAML: FirstName)</div>
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Last Name Claim</label>
                  <input v-model="wizardLastNameClaim" class="form-input mono" placeholder="LastName" />
                  <div class="field-hint">The claim for the user's last name (OIDC: last_name, SAML: LastName)</div>
                </div>
              </div>

              <div v-if="guidedStepNumber === 3" class="wizard-step-content">
                <div class="wizard-title">Review and save</div>
                <div class="wizard-review-summary">
                  <div class="wizard-review-row"><span class="wizard-review-label">Provider</span><span>Custom SAML</span></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">SSO URL</span><span :class="wizardErrors.ssoUrl ? 'review-invalid' : 'review-valid'">{{ wizardErrors.ssoUrl ? '!' : '' }}</span><code class="mono break-all">{{ wizardSsoUrl || '(not set)' }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Entity ID</span><code class="mono">{{ hostname }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Certificate</span><span :class="wizardErrors.cert ? 'review-invalid' : 'review-valid'">{{ wizardErrors.cert ? '!' : '' }}</span><span>{{ wizardCert ? 'Provided' : 'Not set' }}</span></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Email Claim</span><code class="mono">{{ wizardEmailClaim }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">First Name</span><code class="mono">{{ wizardFirstNameClaim }}</code></div>
                  <div class="wizard-review-row"><span class="wizard-review-label">Last Name</span><code class="mono">{{ wizardLastNameClaim }}</code></div>
                </div>
              </div>
            </template>

            <!-- Wizard navigation (for guided steps) -->
            <div v-if="wizardStep >= 2" class="wizard-nav">
              <button class="btn btn-secondary" @click="wizardBack">Back</button>
              <div style="display: flex; gap: var(--sp-2);">
                <button class="btn btn-secondary" @click="closeWizard">Cancel</button>
                <button
                  v-if="guidedStepNumber < wizardTotalSteps"
                  class="btn btn-primary"
                  @click="wizardNext"
                  :disabled="!wizardStepValid"
                >
                  Next
                </button>
                <button
                  v-if="guidedStepNumber === wizardTotalSteps"
                  class="btn btn-primary"
                  @click="wizardSave"
                  :disabled="wizardSaving || !wizardStepValid"
                >
                  {{ wizardSaving ? 'Saving...' : 'Save SSO' }}
                </button>
              </div>
            </div>

            <!-- Close button for step 0 -->
            <div v-if="wizardStep === 0" class="wizard-nav" style="justify-content: flex-end;">
              <button class="btn btn-secondary" @click="closeWizard">Cancel</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Service Links Section -->
    <div
      v-show="activeTab === 'links'"
      id="panel-links"
      class="section"
      role="tabpanel"
    >
      <div class="section-card card">
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Service Links</h2>
            <p class="card-desc text-secondary">
              Link services to GitHub repositories for code-aware root cause analysis.
            </p>
          </div>
          <button v-if="isAdmin" class="btn-create" @click="showLinkForm = true">+ Link Service</button>
        </div>

        <div v-if="!isAdmin" class="repo-access-note">
          Only tenant admins can add or remove repository links.
        </div>

        <!-- Links Table -->
        <div v-if="serviceLinks.length > 0" class="links-table">
          <div class="links-header">
            <div class="col-svc">Service</div>
            <div class="col-repo">Repository</div>
            <div class="col-path">Root Path</div>
            <div class="col-actions">Actions</div>
          </div>
          <div v-for="l in serviceLinks" :key="l.service_name" class="links-row">
            <div class="col-svc mono">{{ l.service_name }}</div>
            <div class="col-repo mono text-muted">{{ l.github_repo }}</div>
            <div class="col-path mono text-secondary">
              {{ l.root_path || '/' }}
              <span class="link-branch">{{ l.default_branch }}</span>
            </div>
            <div class="col-actions">
              <button v-if="isAdmin" class="action-btn action-btn-danger" @click="askDelete('link', l.service_name, l.service_name)">Delete</button>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="keys-empty">
          <div class="text-muted">No service links</div>
          <div class="text-secondary fs-11">Link a service to a GitHub repo to get started</div>
        </div>
      </div>

      <!-- Link Service Drawer (right slide-out) -->
      <Teleport to="body">
        <Transition name="group-drawer">
          <div v-if="showLinkForm && isAdmin" class="group-drawer-overlay" @click.self="closeLinkForm">
            <div class="group-drawer" role="dialog" aria-label="Link service">
              <div class="group-drawer-header">
                <span class="group-drawer-title">Link Service</span>
                <button class="group-drawer-close" @click="closeLinkForm" aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M18 6 6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <div class="group-drawer-body">
                <p class="text-secondary fs-11" style="line-height: 1.5; margin: 0 0 var(--sp-2)">
                  The SRE agent receives a temporary, read-only source snapshot. Repository code is never executed.
                </p>
                <div class="repo-access-note">
                  <strong>GitHub App access</strong>
                  This repository must be approved for the current tenant in the deployment's GitHub repository policy. Rush derives the installation and repository IDs; they cannot be supplied from the browser.
                </div>
                <div class="form-group-inline">
                  <label class="form-label">Service Name</label>
                  <input
                    v-model="linkServiceName"
                    class="form-input mono"
                    list="service-suggestions"
                    placeholder="e.g. api-gateway"
                  />
                  <datalist id="service-suggestions">
                    <option v-for="s in serviceSuggestions" :key="s" :value="s" />
                  </datalist>
                </div>
                <div class="form-group-inline mt-3">
                  <label class="form-label">GitHub Repo</label>
                  <input
                    v-model="linkGithubRepo"
                    class="form-input mono"
                    placeholder="e.g. org/repo"
                  />
                </div>
                <div class="form-group-inline mt-3">
                  <label class="form-label">Branch or ref</label>
                  <input
                    v-model="linkDefaultBranch"
                    class="form-input mono"
                    placeholder="main"
                  />
                </div>
                <div class="form-group-inline mt-3">
                  <label class="form-label">Root Path</label>
                  <input
                    v-model="linkRootPath"
                    class="form-input mono"
                    placeholder="e.g. services/api"
                    @keyup.enter="createServiceLink"
                  />
                </div>
                <div v-if="api.error.value && activeTab === 'links'" style="margin-top: 10px; font-size: 12px; color: var(--error)">{{ api.error.value }}</div>
              </div>
              <div class="group-drawer-footer">
                <button class="btn btn-secondary" @click="closeLinkForm">Cancel</button>
                <button
                  class="btn btn-primary"
                  @click="createServiceLink"
                  :disabled="!linkServiceName.trim() || !linkGithubRepo.trim()"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>
    </div>
    <!-- Integrations Section -->
    <div
      v-show="activeTab === 'integrations'"
      id="panel-integrations"
      class="section"
      role="tabpanel"
    >
      <!-- ── Overview table: what's available and what's on ── -->
      <div v-if="!activeIntegration" class="int-table">
        <div class="int-table-head">
          <span>Integration</span>
          <span>Status</span>
          <span class="int-col-go"></span>
        </div>
        <button
          v-for="row in integrationRows"
          :key="row.key"
          class="int-row"
          @click="selectIntegration(row.key)"
        >
          <span class="int-row-main">
            <span class="int-name">{{ row.label }}</span>
            <span class="int-desc">{{ row.desc }}</span>
          </span>
          <span class="int-status" :class="`int-status--${row.status}`">
            <span class="int-dot"></span>{{ row.statusLabel }}
          </span>
          <span class="int-go" aria-hidden="true">Manage ›</span>
        </button>
      </div>

      <!-- ── Per-integration page (deep-linkable: #integrations/<key>) ── -->
      <template v-else>
        <button class="int-back" @click="selectIntegrations">‹ All integrations</button>

      <div v-if="activeIntegration === 'postgresql'" id="integration-postgresql" class="set-card">
        <div class="set-card-head">
          <h2 class="card-title">PostgreSQL</h2>
          <p class="card-desc">Monitor PostgreSQL health, query workload, schema, connections, and maintenance from the control room.</p>
        </div>
        <div v-if="licenseLoading" class="set-row">
          <div class="set-row-text text-muted">Checking PostgreSQL entitlement…</div>
        </div>
        <template v-else-if="license?.valid && license.entitlements.includes('postgres')">
          <div class="set-row">
            <div class="set-row-text">
              <div class="set-row-label">PostgreSQL add-on enabled</div>
              <div class="set-row-desc">The license includes the PostgreSQL collector entitlement.</div>
            </div>
            <div class="set-row-control">
              <span class="lic-badge" style="color: var(--ok); border-color: var(--ok)">Entitled</span>
            </div>
          </div>
          <div class="set-row">
            <div class="set-row-text">
              <div class="set-row-label">Open control room</div>
              <div class="set-row-desc">View collector freshness, database health, queries, locks, schema, indexes, and vacuum signals.</div>
            </div>
            <div class="set-row-control">
              <router-link class="btn btn-primary" to="/integrations/postgresql/overview">Open PostgreSQL</router-link>
            </div>
          </div>
        </template>
        <div v-else class="set-helm-note">
          PostgreSQL is not included in the active license. Add the <code>postgres</code> entitlement to <code>RUSH_LICENSE_KEY</code> and restart query-api.
        </div>
      </div>

      <div v-else-if="activeIntegration === 'argocd'" id="integration-argocd" class="set-card">
        <div class="set-card-head">
          <h2 class="card-title">ArgoCD</h2>
          <p class="card-desc">Import Application health and sync status from ArgoCD into Rush. When enabled it appears in the <router-link to="/integrations">Integrations</router-link> area.</p>
        </div>
        <template v-if="featureOn('argocd')">
          <div class="set-row">
            <div class="set-row-text">
              <div class="set-row-label">Enable ArgoCD</div>
              <div class="set-row-desc">Adds ArgoCD to the Integrations area. Disabled hides it for all users.</div>
            </div>
            <div class="set-row-control">
              <label class="toggle">
                <input type="checkbox" v-model="argocdEnabled" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div v-if="argocdEnabled" class="set-row">
            <div class="set-row-text">
              <div class="set-row-label">Namespace</div>
              <div class="set-row-desc">Kubernetes namespace where ArgoCD is installed.</div>
            </div>
            <div class="set-row-control">
              <input v-model="argocdNamespace" class="form-input mono" placeholder="argocd" />
            </div>
          </div>
          <div class="set-save-bar">
            <span v-if="integrationsErr" class="save-error">{{ integrationsErr }}</span>
            <span v-if="integrationsSaved" class="save-confirmation">Saved</span>
            <button class="btn btn-primary" @click="saveIntegrations">Save</button>
          </div>
        </template>
        <div v-else class="set-helm-note">
          Disabled in the Helm chart. Set <code>argocd.enabled=true</code> (and redeploy) to manage this integration here.
        </div>
      </div>

      <div v-else-if="activeIntegration === 'fluxcd'" id="integration-fluxcd" class="set-card">
        <div class="set-card-head">
          <h2 class="card-title">FluxCD</h2>
          <p class="card-desc">Read Flux v2 Kustomizations, HelmReleases, and Sources from the cluster. When enabled it appears in the <router-link to="/integrations">Integrations</router-link> area.</p>
        </div>
        <template v-if="featureOn('fluxcd')">
          <div class="set-row">
            <div class="set-row-text">
              <div class="set-row-label">Enable FluxCD</div>
              <div class="set-row-desc">Adds FluxCD to the Integrations area. Disabled hides it for all users.</div>
            </div>
            <div class="set-row-control">
              <label class="toggle">
                <input type="checkbox" v-model="fluxcdEnabled" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div v-if="fluxcdEnabled" class="set-row">
            <div class="set-row-text">
              <div class="set-row-label">Namespace</div>
              <div class="set-row-desc">Default namespace where Flux is installed (resources are read cluster-wide).</div>
            </div>
            <div class="set-row-control">
              <input v-model="fluxcdNamespace" class="form-input mono" placeholder="flux-system" />
            </div>
          </div>
          <div class="set-save-bar">
            <span v-if="fluxErr" class="save-error">{{ fluxErr }}</span>
            <span v-if="fluxSaved" class="save-confirmation">Saved</span>
            <button class="btn btn-primary" @click="saveFlux">Save</button>
          </div>
        </template>
        <div v-else class="set-helm-note">
          Disabled in the Helm chart. Set <code>fluxcd.enabled=true</code> (and redeploy) to manage this integration here.
        </div>
      </div>

      <div v-else-if="activeIntegration === 'kubernetes'" id="integration-kubernetes" class="set-card">
        <div class="set-card-head">
          <h2 class="card-title">Kubernetes</h2>
          <p class="card-desc">Read-only browser for cluster workloads, networking, config, and cluster resources. When enabled it appears in the <router-link to="/integrations">Integrations</router-link> area.</p>
        </div>
        <template v-if="featureOn('kubernetes')">
          <div class="set-row">
            <div class="set-row-text">
              <div class="set-row-label">Enable Kubernetes</div>
              <div class="set-row-desc">Adds the Kubernetes browser to the Integrations area (cluster-wide, read-only). Disabled hides it for all users.</div>
            </div>
            <div class="set-row-control">
              <label class="toggle">
                <input type="checkbox" v-model="kubernetesEnabled" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="set-save-bar">
            <span v-if="k8sSaved" class="save-confirmation">Saved</span>
            <button class="btn btn-primary" @click="saveKubernetes">Save</button>
          </div>
        </template>
        <div v-else class="set-helm-note">
          Disabled in the Helm chart. Set <code>kubernetes.enabled=true</code> (and redeploy) to manage this integration here.
        </div>
      </div>

      <div v-else-if="activeIntegration === 'cloudwatch'" id="integration-cloudwatch" class="set-card">
        <div class="set-card-head">
          <h2 class="card-title">CloudWatch Logs</h2>
          <p class="card-desc">Ingest AWS CloudWatch Logs pushed via a Kinesis Data Firehose HTTP endpoint. Each batch routes to the tenant embedded in the endpoint URL; an access key is optional. When enabled it appears in the <router-link to="/integrations">Integrations</router-link> area.</p>
        </div>
        <div class="set-row">
          <div class="set-row-text">
            <div class="set-row-label">
              Enable CloudWatch Logs
              <span v-if="cloudwatchSaving" class="text-muted" style="font-weight:400; font-size:11px; margin-left:8px">Saving…</span>
              <span v-else-if="cloudwatchSaved" style="font-weight:400; font-size:11px; margin-left:8px; color: var(--ok)">Saved ✓</span>
            </div>
            <div class="set-row-desc">Allows Firehose to deliver CloudWatch Logs to Rush. Disabled rejects ingest and hides the integration. Changes save automatically.</div>
          </div>
          <div class="set-row-control">
            <label class="toggle">
              <input type="checkbox" v-model="cloudwatchEnabled" :disabled="cloudwatchSaving" @change="saveCloudwatch" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        <div v-if="cloudwatchEnabled" class="set-row">
          <div class="set-row-text">
            <div class="set-row-label">Choose a tenant</div>
            <div class="set-row-desc">Pick a tenant to see how to point a Firehose stream at it — the endpoint URL, any required header, and a ready-to-run AWS CLI example below all update for the selected tenant. This is just for these instructions; any enabled tenant can receive logs via its own URL.</div>
          </div>
          <div class="set-row-control">
            <select v-model="cloudwatchTenant" class="form-input">
              <option value="">Select a tenant…</option>
              <option v-for="t in tenants" :key="t.id" :value="t.name">{{ t.name }}</option>
            </select>
          </div>
        </div>

        <div v-if="cloudwatchEnabled && !cloudwatchTenantChosen" class="set-row set-row-block">
          <div class="set-row-desc">Select a tenant above to see its Firehose endpoint and setup steps.</div>
        </div>

        <template v-if="cloudwatchEnabled && cloudwatchTenantChosen">
          <div class="set-row set-row-block">
            <div class="set-row-text">
              <div class="set-row-label">Firehose endpoint URL</div>
              <div class="set-row-desc">
                The tenant is embedded in the path. Use this as the Firehose HTTP endpoint URL.
                <template v-if="!cloudwatchTenantProtected">
                  An access key is <strong>optional</strong> — you may set one on the Firehose stream for
                  defense-in-depth, but it isn't required and doesn't affect tenant routing.
                </template>
              </div>
              <div class="cw-code">
                <code>{{ cloudwatchUrlEndpoint }}</code>
                <button class="btn btn-sm" @click="copyCloudwatch(cloudwatchUrlEndpoint, 'b')">{{ cloudwatchCopied === 'b' ? 'Copied' : 'Copy' }}</button>
              </div>
            </div>
          </div>

          <div v-if="cloudwatchTenantProtected" class="set-row set-row-block">
            <div class="set-row-text">
              <div class="set-row-label">Required access-key header</div>
              <div class="set-row-desc">
                Tenant <strong class="mono">{{ cloudwatchTenant }}</strong> is auth-protected, so Firehose
                <strong>must</strong> send a tenant-scoped <router-link to="/settings#keys">API key</router-link>
                as its access key. In the Firehose HTTP-endpoint config, set the access key to a key for this
                tenant — Firehose sends it as the header below, which the endpoint requires and validates.
              </div>
              <div class="cw-code">
                <code>{{ cloudwatchAccessKeyHeader }}</code>
                <button class="btn btn-sm" @click="copyCloudwatch(cloudwatchAccessKeyHeader, 'h')">{{ cloudwatchCopied === 'h' ? 'Copied' : 'Copy' }}</button>
              </div>
            </div>
          </div>

          <div class="set-row set-row-block">
            <div class="set-row-text">
              <div class="set-row-label">AWS steps</div>
              <ol class="cw-steps">
                <li>Create a Kinesis Data Firehose delivery stream with an <strong>HTTP endpoint</strong> destination set to the URL above. <template v-if="cloudwatchTenantProtected">Set the access key to a tenant-scoped API key (required for this tenant).</template><template v-else>An access key is optional.</template></li>
                <li>Create a <strong>CloudWatch Logs subscription filter</strong> on each target log group whose destination is that Firehose stream.</li>
              </ol>
            </div>
          </div>

          <div class="set-row set-row-block">
            <div class="set-row-text">
              <div class="set-row-label">
                AWS CLI example
                <button class="btn btn-sm" style="margin-left:8px" @click="copyCloudwatch(cloudwatchCliExample, 'cli')">{{ cloudwatchCopied === 'cli' ? 'Copied' : 'Copy' }}</button>
              </div>
              <div class="set-row-desc">Replace the <code>&lt;…&gt;</code> placeholders (account id, region, IAM roles, backup bucket, log group). Pre-filled for tenant <strong class="mono">{{ cloudwatchTenant }}</strong>.</div>
              <pre class="cw-pre"><code>{{ cloudwatchCliExample }}</code></pre>
            </div>
          </div>
        </template>
      </div>
      </template>
    </div>

    <!-- License Section -->
    <div
      v-show="activeTab === 'license'"
      id="panel-license"
      class="section"
      role="tabpanel"
    >
      <div class="set-card">
        <div class="set-card-head">
          <h2 class="card-title">License</h2>
          <p class="card-desc">
            Set via the <code>RUSH_LICENSE_KEY</code> environment variable (a Kubernetes Secret in production).
            The server verifies it offline against an embedded public key.
          </p>
        </div>

        <div v-if="licenseLoading" class="set-row"><div class="set-row-text text-muted">Loading…</div></div>

        <template v-else-if="license">
          <div class="set-row">
            <div class="set-row-text">
              <div class="set-row-label">Status</div>
              <div class="set-row-desc">{{ license.reason || 'License verified and active.' }}</div>
            </div>
            <div class="set-row-control">
              <span class="lic-badge" :style="{
                color: license.status === 'active' ? 'var(--ok)' : license.status === 'expired' ? 'var(--warning)' : 'var(--text-muted)',
                borderColor: license.status === 'active' ? 'var(--ok)' : license.status === 'expired' ? 'var(--warning)' : 'var(--border-default)'
              }">{{ license.status.toUpperCase() }}</span>
            </div>
          </div>

          <div class="set-row">
            <div class="set-row-text"><div class="set-row-label">Customer</div></div>
            <div class="set-row-control mono">{{ license.customer || '—' }}</div>
          </div>
          <div class="set-row">
            <div class="set-row-text"><div class="set-row-label">Plan</div></div>
            <div class="set-row-control mono">{{ license.plan }}</div>
          </div>
          <div class="set-row">
            <div class="set-row-text"><div class="set-row-label">Expires</div></div>
            <div class="set-row-control mono">{{ license.expires_at ? new Date(license.expires_at).toLocaleString() : '—' }}</div>
          </div>
          <div class="set-row">
            <div class="set-row-text">
              <div class="set-row-label">Add-ons</div>
              <div class="set-row-desc">Paid add-ons unlocked by this license.</div>
            </div>
            <div class="set-row-control">
              <template v-if="license.entitlements.length">
                <span v-for="e in license.entitlements" :key="e" class="lic-chip">{{ e }}</span>
              </template>
              <span v-else class="text-muted" style="font-size: 12px">None</span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- General Section -->
    <div
      v-show="activeTab === 'general'"
      id="panel-general"
      class="section"
      role="tabpanel"
    >
      <div class="set-card">
        <div class="set-card-head">
          <h2 class="card-title">Data export</h2>
          <p class="card-desc">Controls how much data users can download from the Explore view.</p>
        </div>
        <div class="set-row">
          <div class="set-row-text">
            <div class="set-row-label">Max export rows</div>
            <div class="set-row-desc">
              Largest result set (logs or spans) a user can export — they may choose any size up to this limit.<template v-if="!isAdmin"> Only admins can change it.</template>
            </div>
          </div>
          <div class="set-row-control">
            <input
              v-model.number="exportMaxRows"
              type="number"
              min="1"
              class="form-input mono"
              :disabled="!isAdmin"
            />
          </div>
        </div>
        <div class="set-save-bar" v-if="isAdmin">
          <span v-if="exportMaxRowsError" class="save-error">{{ exportMaxRowsError }}</span>
          <span v-if="exportMaxRowsSaved" class="save-confirmation">Saved</span>
          <button class="btn btn-primary" @click="saveExportMaxRows" :disabled="exportMaxRowsSaving">
            {{ exportMaxRowsSaving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>

      <div class="set-card">
        <div class="set-card-head">
          <h2 class="card-title">Charts</h2>
          <p class="card-desc">Display options for service and metric charts.</p>
        </div>
        <div class="set-row">
          <div class="set-row-text">
            <div class="set-row-label">Deploy markers</div>
            <div class="set-row-desc">
              Draw vertical markers on service charts at each recorded deploy, so you can line up changes in traffic, errors, and latency with releases.<template v-if="!isAdmin"> Only admins can change it.</template>
            </div>
          </div>
          <div class="set-row-control">
            <label class="toggle" :title="deployMarkersEnabled ? 'Enabled' : 'Disabled'">
              <input type="checkbox" :checked="deployMarkersEnabled" :disabled="!isAdmin || deployMarkersSaving" @change="toggleDeployMarkers" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="set-card">
        <div class="set-card-head">
          <h2 class="card-title">Real User Monitoring</h2>
          <p class="card-desc">Browser monitoring (page views, web vitals, JS errors, session replay).</p>
        </div>
        <div class="set-row">
          <div class="set-row-text">
            <div class="set-row-label">RUM</div>
            <div class="set-row-desc">
              When off, the RUM section is hidden and the RUM ingest endpoints reject browser data.<template v-if="!isAdmin"> Only admins can change it.</template>
            </div>
          </div>
          <div class="set-row-control">
            <label class="toggle" :title="rumEnabled ? 'Enabled' : 'Disabled'">
              <input type="checkbox" :checked="rumEnabled" :disabled="!isAdmin || rumSaving" @change="toggleRum" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

    </div>

    <!-- Stats Section (Data & Routing) — embeds the former standalone Stats page -->
    <div
      v-if="activeTab === 'stats'"
      id="panel-stats"
      class="section"
      role="tabpanel"
    >
      <StatsView embedded />
    </div>

    <!-- Retention Section (Data & Routing) -->
    <div
      v-show="activeTab === 'retention'"
      id="panel-retention"
      class="section"
      role="tabpanel"
    >
      <div v-if="isAdmin" class="set-card">
        <div class="set-card-head">
          <h2 class="card-title">Retention</h2>
          <p class="card-desc">Global data retention caps. Tenants cannot exceed these limits — they are also the starting value when a tenant overrides a signal.</p>
        </div>
        <div class="set-row">
          <div class="set-row-text">
            <div class="set-row-label">Global default (days)</div>
            <div class="set-row-desc">Applies to any signal without its own cap below.</div>
          </div>
          <div class="set-row-control">
            <input
              v-model="retDefault"
              type="number"
              min="1"
              class="form-input mono"
            />
          </div>
        </div>
        <div class="set-row">
          <div class="set-row-text">
            <div class="set-row-label">Logs (max days)</div>
            <div class="set-row-desc">Maximum retention for log data.</div>
          </div>
          <div class="set-row-control">
            <input
              v-model="retLogs"
              type="number"
              min="1"
              class="form-input mono"
              :placeholder="globalRetention ? `inherit (${globalRetention.default_days}d)` : 'inherit'"
            />
          </div>
        </div>
        <div class="set-row">
          <div class="set-row-text">
            <div class="set-row-label">Metrics (max days)</div>
            <div class="set-row-desc">Maximum retention for metrics data.</div>
          </div>
          <div class="set-row-control">
            <input
              v-model="retMetrics"
              type="number"
              min="1"
              class="form-input mono"
              :placeholder="globalRetention ? `inherit (${globalRetention.default_days}d)` : 'inherit'"
            />
          </div>
        </div>
        <div class="set-row">
          <div class="set-row-text">
            <div class="set-row-label">APM (max days)</div>
            <div class="set-row-desc">Maximum retention for APM data (traces and RUM). Leave empty to inherit the global default.</div>
          </div>
          <div class="set-row-control">
            <input
              v-model="retApm"
              type="number"
              min="1"
              class="form-input mono"
              :placeholder="globalRetention ? `inherit (${globalRetention.default_days}d)` : 'inherit'"
            />
          </div>
        </div>
        <div class="set-row" v-if="globalRetention">
          <div class="set-row-text">
            <div class="set-row-label">Effective caps</div>
            <div class="set-row-desc">
              Resolved caps applied to tenants:
              logs <strong>{{ globalRetention.effective_logs }}d</strong>,
              metrics <strong>{{ globalRetention.effective_metrics }}d</strong>,
              APM <strong>{{ globalRetention.effective_apm }}d</strong>.
            </div>
          </div>
          <div class="set-row-control"></div>
        </div>
        <div class="set-save-bar">
          <span v-if="globalRetError" class="save-error">{{ globalRetError }}</span>
          <span v-if="globalRetSaved" class="save-confirmation">Saved</span>
          <button class="btn btn-primary" @click="saveGlobalRetention" :disabled="globalRetSaving">
            {{ globalRetSaving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
      <div v-else class="set-card">
        <div class="set-card-head">
          <p class="card-desc">Only admins can view or change retention settings.</p>
        </div>
      </div>
    </div>

    <!-- AI Agent Section -->
    <div
      v-show="activeTab === 'agent'"
      id="panel-agent"
      class="section"
      role="tabpanel"
    >
      <div v-if="isAdmin" class="agent-controlbar">
        <div class="agent-controlbar-copy">
          <div class="agent-status-line">
            <span class="agent-status-dot" :class="{ on: agentEnabled }"></span>
            <span class="agent-status-label">SRE Agent</span>
            <span class="agent-status-value">{{ agentEnabled ? 'Enabled' : 'Disabled' }}</span>
          </div>
          <p>Controls investigations and saved-session access across the workspace.</p>
        </div>
        <label class="toggle" :title="agentEnabled ? 'Disable SRE Agent' : 'Enable SRE Agent'">
          <input type="checkbox" :checked="agentEnabled" :disabled="agentToggleSaving" @change="toggleAgentEnabled" />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div
        class="agent-subnav"
        :class="{ 'agent-subnav--solo': !isAdmin }"
        role="tablist"
        aria-label="AI Agent settings"
        @keydown="onAgentSubtabKeydown"
      >
        <button
          v-for="subtab in agentSubtabs"
          v-show="!subtab.adminOnly || isAdmin"
          :id="`agent-tab-${subtab.id}`"
          :key="subtab.id"
          class="agent-subtab"
          :class="{ active: activeAgentSubtab === subtab.id }"
          role="tab"
          :tabindex="activeAgentSubtab === subtab.id ? 0 : -1"
          :aria-selected="activeAgentSubtab === subtab.id"
          :aria-controls="`agent-panel-${subtab.id}`"
          @click="selectAgentSubtab(subtab.id)"
        >
          <span class="agent-subtab-eyebrow">{{ subtab.eyebrow }}</span>
          <span class="agent-subtab-label">{{ subtab.label }}</span>
          <span class="agent-subtab-meta">{{ agentSubtabMeta(subtab.id) }}</span>
        </button>
      </div>

      <p v-if="agentBudgetError && activeAgentSubtab !== 'limits'" class="agent-inline-error" role="alert">
        {{ agentBudgetError }}
      </p>

      <div
        v-if="isAdmin"
        v-show="activeAgentSubtab === 'access'"
        id="agent-panel-access"
        class="section-card card agent-tabpanel"
        role="tabpanel"
        aria-labelledby="agent-tab-access"
      >
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Tenant access</h2>
            <p class="card-desc text-secondary">Choose which tenant contexts may start investigations or read saved sessions. This policy is enforced by query-api.</p>
          </div>
          <span v-if="agentEnabled" class="agent-access-count">
            {{ agentTenantMode === 'all' ? `${enabledAgentTenants.length} tenants` : `${agentAllowedTenants.length} selected` }}
          </span>
        </div>
        <div v-if="agentEnabled" class="agent-access-policy">
          <div class="agent-access-modes" role="radiogroup" aria-label="SRE agent tenant access">
            <label class="agent-access-mode" :class="{ active: agentTenantMode === 'all' }">
              <input v-model="agentTenantMode" type="radio" value="all" />
              <span><strong>All enabled tenants</strong><small>New tenants receive access automatically.</small></span>
            </label>
            <label class="agent-access-mode" :class="{ active: agentTenantMode === 'selected' }">
              <input v-model="agentTenantMode" type="radio" value="selected" />
              <span><strong>Selected tenants only</strong><small>Deny every tenant that is not explicitly checked.</small></span>
            </label>
          </div>
          <div v-if="agentTenantMode === 'selected'" class="agent-tenant-list">
            <label v-for="tenant in enabledAgentTenants" :key="tenant.id" class="agent-tenant-row">
              <input type="checkbox" :checked="agentAllowedTenants.includes(tenant.name)" @change="toggleAgentTenant(tenant.name)" />
              <span class="agent-tenant-name">{{ tenant.name }}</span>
              <span v-if="tenant.name === activeTenantName" class="agent-tenant-current">current</span>
            </label>
            <div v-if="enabledAgentTenants.length === 0" class="agent-tenant-empty">No enabled tenants are available.</div>
            <div v-else-if="agentAllowedTenants.length === 0" class="agent-tenant-warning">No tenants selected. The agent will remain unavailable everywhere.</div>
          </div>
          <div class="agent-access-save">
            <span v-if="agentTenantSaved" class="save-confirmation">Saved</span>
            <button class="btn btn-primary" :disabled="agentTenantSaving" @click="saveAgentTenantAccess">
              {{ agentTenantSaving ? 'Saving…' : 'Save tenant access' }}
            </button>
          </div>
        </div>
        <div v-else class="agent-disabled-panel">Enable the SRE Agent above to configure tenant access.</div>
      </div>

      <div
        v-if="isAdmin"
        v-show="activeAgentSubtab === 'models'"
        id="agent-panel-models"
        class="section-card card agent-tabpanel"
        role="tabpanel"
        aria-labelledby="agent-tab-models"
      >
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Model policy</h2>
            <p class="card-desc text-secondary">Define the models and reasoning levels people can choose for an investigation.</p>
          </div>
          <span v-if="agentPolicySaving" class="agent-save-state">Saving…</span>
          <span v-else-if="agentPolicySaved" class="agent-save-state saved">Saved ✓</span>
        </div>
        <div v-if="agentEnabled" class="create-form agent-model-form">
          <label class="form-label" for="agent-model-input">Allowed models</label>
          <p class="card-desc text-secondary">Type a model name and press Tab or Enter. Reasoning models can be restricted to specific thinking levels; the server enforces this policy.</p>
          <div class="agent-model-combo">
            <input
              id="agent-model-input"
              v-model="agentModelInput"
              class="form-input mono"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="Type a model name…"
              @keydown="onModelKeydown"
              @input="showModelMenu = true"
              @focus="showModelMenu = true"
              @blur="onModelBlur"
            />
            <ul v-if="showModelMenu && agentModelMatches.length" class="agent-model-menu">
              <li v-for="(id, i) in agentModelMatches" :key="id" :class="{ active: i === 0 }" class="mono" @mousedown.prevent="addModel(id)">{{ id }}</li>
            </ul>
          </div>
          <div v-if="agentAllowedIds.length" class="agent-model-added">
            <div v-for="id in agentAllowedIds" :key="id" class="agent-model-row">
              <div class="agent-model-row-head">
                <span class="mono">{{ id }}</span>
                <button type="button" class="agent-model-remove" @click="askDelete('model', id, id)">Remove</button>
              </div>
              <div v-if="modelIsReasoning(id)" class="agent-level-list">
                <span class="text-muted fs-11">thinking:</span>
                <label v-for="lvl in agentReasoningLevels" :key="lvl" class="agent-level-pick">
                  <input type="checkbox" :checked="(agentAllowed[id] || []).includes(lvl)" @change="toggleAllowedLevel(id, lvl)" />
                  <span>{{ lvl }}</span>
                </label>
              </div>
            </div>
          </div>
          <p v-else class="text-muted fs-12">No models added — investigations use the provider default.</p>
          <div class="agent-default-model">
            <label class="form-label">Default model <span class="text-muted">used when a user doesn't pick</span></label>
            <select v-model="agentModel" class="form-input mono" @change="schedulePolicySave">
              <option value="">(first allowed)</option>
              <option v-for="id in agentAllowedIds" :key="id" :value="id">{{ id }}</option>
            </select>
          </div>
        </div>
        <div v-else class="agent-disabled-panel">Enable the SRE Agent above to configure model policy.</div>
      </div>

      <div
        v-if="isAdmin"
        v-show="activeAgentSubtab === 'limits'"
        id="agent-panel-limits"
        class="section-card card agent-tabpanel"
        role="tabpanel"
        aria-labelledby="agent-tab-limits"
      >
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Investigation limits</h2>
            <p class="card-desc text-secondary">Bound per-investigation cost. Lower limits are cheaper, but may produce preliminary reports.</p>
          </div>
        </div>
        <div class="create-form agent-budget-form">
          <div class="form-group-inline">
            <label class="form-label">Max tool calls <span class="text-muted">default {{ agentBudgetDefaults?.max_tool_steps ?? 40 }}</span></label>
            <input v-model="agentMaxToolSteps" type="number" min="4" max="200" class="form-input mono" placeholder="40" />
          </div>
          <div class="form-group-inline">
            <label class="form-label">Max LLM calls <span class="text-muted">default {{ agentBudgetDefaults?.max_llm_calls ?? 55 }}</span></label>
            <input v-model="agentMaxLlmCalls" type="number" min="6" max="300" class="form-input mono" placeholder="55" />
          </div>
          <div class="form-actions-inline">
            <button class="btn btn-primary" :disabled="agentBudgetSaving" @click="saveAgentBudget">
              {{ agentBudgetSaving ? 'Saving…' : agentBudgetSaved ? 'Saved ✓' : 'Save limits' }}
            </button>
          </div>
          <p v-if="agentBudgetError" class="fw-field-err agent-budget-note">{{ agentBudgetError }}</p>
          <p v-else class="fw-hint agent-budget-note">Tool calls are investigation actions such as log searches and trace queries. LLM calls include retries and self-review, and must be at least tool calls + 2. Changes apply to new investigations immediately.</p>
        </div>
      </div>

      <div
        v-show="activeAgentSubtab === 'skills'"
        id="agent-panel-skills"
        class="section-card card agent-tabpanel"
        role="tabpanel"
        aria-labelledby="agent-tab-skills"
      >
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Custom skills</h2>
            <p class="card-desc text-secondary">
              Custom skills the investigation agent loads dynamically alongside built-in playbooks.
            </p>
          </div>
          <button class="btn-create" @click="openSkillDialog()">+ Add skill</button>
        </div>

        <!-- Empty state -->
        <div v-if="customSkills.length === 0" class="keys-empty">
          <div class="text-muted">No custom skills yet</div>
          <div class="text-secondary fs-11">
            <a class="empty-link" @click="openSkillDialog()">Create one</a>
            or duplicate a built-in playbook below.
          </div>
        </div>

        <!-- Custom skills list -->
        <div v-else class="skill-list">
          <div v-for="skill in customSkills" :key="skill.id" class="skill-row">
            <div class="skill-main">
              <div class="skill-name">
                <span class="skill-name-text mono">{{ skill.name }}</span>
                <span v-if="!skill.enabled" class="skill-disabled">disabled</span>
              </div>
              <div class="skill-title">{{ skill.title }}</div>
              <div class="skill-description">{{ skill.description }}</div>
              <div class="skill-meta">
                <span class="skill-meta-item">by {{ skill.created_by || 'unknown' }}</span>
                <span class="skill-meta-item">updated {{ formatSkillDate(skill.updated_at) }}</span>
                <span class="skill-meta-item">{{ skill.allowed_tools.length }} tools</span>
              </div>
            </div>
            <div class="skill-actions">
              <button class="action-btn" @click="openSkillDialog(skill)">Edit</button>
              <button class="action-btn action-btn-danger" @click="askDelete('skill', skill.id, skill.name)">Delete</button>
            </div>
          </div>
        </div>

        <!-- Built-in skills reference -->
        <div class="builtin-skills-reference">
          <div class="builtin-skills-title">Built-in skills (clone to customize)</div>
          <div class="builtin-skill-list">
            <div v-for="b in builtInSkillTemplates" :key="b.name" class="builtin-skill-row">
              <div class="builtin-skill-info">
                <span class="builtin-skill-name mono">{{ b.name }}</span>
                <span class="builtin-skill-desc">{{ b.description }}</span>
              </div>
              <button class="action-btn" @click="cloneBuiltIn(b)">Duplicate</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tenants Section -->
    <div
      v-show="activeTab === 'tenants'"
      id="panel-tenants"
      class="section"
      role="tabpanel"
      aria-labelledby="tab-tenants"
    >
      <div class="section-card card">
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Tenants</h2>
            <p class="card-desc text-secondary">
              Isolate data between teams or customers with separate tenants.
            </p>
          </div>
          <button class="btn-create" @click="openTenantForm">+ Create Tenant</button>
        </div>

        <!-- Error State -->
        <div v-if="api.error.value && activeTab === 'tenants'" class="error-row">
          <span class="err-mark">!</span>
          <span>{{ api.error.value }}</span>
        </div>

        <!-- Tenants Table -->
        <div v-if="tenants.length > 0" class="grid-table tenant-grid">
          <div class="grid-head">
            <div>Name</div>
            <div>ID</div>
            <div>Retention</div>
            <div>Locked</div>
            <div>Enabled</div>
            <div>Signals</div>
            <div>Actions</div>
          </div>
          <div v-for="t in tenants" :key="t.id" class="grid-row" :class="{ 'grid-row-dim': !t.enabled }">
            <div class="grid-cell">
              <span class="cell-avatar">{{ t.name.charAt(0).toUpperCase() }}</span>
              <span class="mono fw-600">{{ t.name }}</span>
              <span v-if="t.id === 'default'" class="cell-tag cell-tag-amber">DEFAULT</span>
            </div>
            <div class="grid-cell mono text-muted">{{ t.id }}</div>
            <div class="grid-cell">
              <span v-if="retentionBadges(t.id).length === 0" class="text-muted fs-11">global default</span>
              <span v-else style="display: flex; gap: 4px; flex-wrap: wrap">
                <span v-for="b in retentionBadges(t.id)" :key="b" class="cell-tag cell-tag-muted" style="font-size: 10px">{{ b }}</span>
              </span>
            </div>
            <div class="grid-cell">
              <label
                class="toggle"
                :title="t.auth_required ? 'Locked — requires API key or session' : 'Open — X-Rush-Tenant header accepted'"
              >
                <input type="checkbox" :checked="t.auth_required" @change="api.setTenantAuthRequired(t.id, !t.auth_required).then(() => loadTenants())" />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="grid-cell">
              <label class="toggle" :title="t.enabled ? 'Enabled' : 'Disabled — ingest and queries blocked'">
                <input type="checkbox" :checked="t.enabled" @change="toggleTenantEnabled(t.id, !t.enabled)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="grid-cell">
              <div class="signal-cell">
                <label
                  v-for="sig in SIGNAL_DEFS"
                  :key="sig.key"
                  class="signal-toggle"
                  :title="`${sig.label} ingest ${signalEnabled(t.id, sig.key) ? 'enabled' : 'disabled — accepted but dropped'}`"
                >
                  <input
                    type="checkbox"
                    :checked="signalEnabled(t.id, sig.key)"
                    @change="toggleTenantSignal(t.id, sig.key, !signalEnabled(t.id, sig.key))"
                  />
                  <span>{{ sig.label }}</span>
                  <span
                    v-if="!signalEnabled(t.id, sig.key) && signalDropped(t.id, sig.key) > 0"
                    class="signal-dropped"
                  >{{ formatDropped(signalDropped(t.id, sig.key)) }} dropped (24h)</span>
                </label>
              </div>
            </div>
            <div class="grid-cell grid-actions">
              <button class="action-btn" @click="openRetentionModal(t)">Retention</button>
              <template v-if="t.id !== 'default'">
                <button class="action-btn action-btn-danger" @click="askDelete('tenant', t.id, t.name)">Delete</button>
              </template>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else-if="!showTenantForm" class="keys-empty">
          <div class="text-muted">No tenants found.</div>
          <div class="text-secondary fs-11">Create a tenant to isolate data between teams.</div>
        </div>
      </div>

      <!-- Create Tenant Drawer (right slide-out) -->
      <Teleport to="body">
        <Transition name="group-drawer">
          <div v-if="showTenantForm" class="group-drawer-overlay" @click.self="closeTenantForm">
            <div class="group-drawer" role="dialog" aria-label="Create tenant">
              <div class="group-drawer-header">
                <span class="group-drawer-title">Create Tenant</span>
                <button class="group-drawer-close" @click="closeTenantForm" aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M18 6 6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <div class="group-drawer-body">
                <p class="text-secondary fs-11" style="line-height: 1.5; margin: 0 0 var(--sp-2)">
                  Isolate data between teams or customers with a separate tenant.
                </p>
                <div class="form-group-inline">
                  <label class="form-label">Tenant Name</label>
                  <input
                    v-model="tenantName"
                    class="form-input mono"
                    :class="{ 'form-input-warn': tenantNameTaken }"
                    placeholder="e.g. security, platform-team"
                    @keyup.enter="createTenant"
                  />
                  <p v-if="tenantNameTaken" class="fw-field-err">A tenant named "{{ tenantName.trim() }}" already exists — names must be unique.</p>
                </div>

                <div class="group-drawer-section">
                  <label class="form-label">Retention (optional)</label>
                  <p class="text-secondary fs-11" style="line-height: 1.5; margin: 4px 0 var(--sp-2)">
                    Tenant-only overrides. Leave empty to inherit the global default; values above the global cap are clamped down on save.
                  </p>
                  <div class="form-group-inline">
                    <label class="form-label">
                      Logs (days)
                      <span v-if="globalRetention" class="text-muted" style="font-weight: 400; margin-left: 6px; font-size: 11px">max {{ globalRetention.effective_logs }}d</span>
                    </label>
                    <input
                      v-model="retentionLogs"
                      type="number"
                      min="1"
                      :max="globalRetention?.effective_logs"
                      class="form-input mono"
                      :class="{ 'form-input-warn': retentionOver('logs') != null }"
                      :placeholder="globalRetention ? `inherit (${globalRetention.effective_logs} max)` : 'global default'"
                    />
                    <p v-if="retentionOver('logs') != null" class="retention-warn">⚠ Exceeds the global max of {{ retentionOver('logs') }}d — will be capped to {{ retentionOver('logs') }}d on save.</p>
                  </div>
                  <div class="form-group-inline mt-3">
                    <label class="form-label">
                      Traces (days)
                      <span v-if="globalRetention" class="text-muted" style="font-weight: 400; margin-left: 6px; font-size: 11px">max {{ globalRetention.effective_apm }}d</span>
                    </label>
                    <input
                      v-model="retentionTraces"
                      type="number"
                      min="1"
                      :max="globalRetention?.effective_apm"
                      class="form-input mono"
                      :class="{ 'form-input-warn': retentionOver('traces') != null }"
                      :placeholder="globalRetention ? `inherit (${globalRetention.effective_apm} max)` : 'global default'"
                    />
                    <p v-if="retentionOver('traces') != null" class="retention-warn">⚠ Exceeds the global max of {{ retentionOver('traces') }}d — will be capped to {{ retentionOver('traces') }}d on save.</p>
                  </div>
                  <div class="form-group-inline mt-3">
                    <label class="form-label">
                      Metrics (days)
                      <span v-if="globalRetention" class="text-muted" style="font-weight: 400; margin-left: 6px; font-size: 11px">max {{ globalRetention.effective_metrics }}d</span>
                    </label>
                    <input
                      v-model="retentionMetrics"
                      type="number"
                      min="1"
                      :max="globalRetention?.effective_metrics"
                      class="form-input mono"
                      :class="{ 'form-input-warn': retentionOver('metrics') != null }"
                      :placeholder="globalRetention ? `inherit (${globalRetention.effective_metrics} max)` : 'global default'"
                    />
                    <p v-if="retentionOver('metrics') != null" class="retention-warn">⚠ Exceeds the global max of {{ retentionOver('metrics') }}d — will be capped to {{ retentionOver('metrics') }}d on save.</p>
                  </div>
                </div>

                <div class="group-drawer-section">
                  <label class="form-label">Ingest Signals</label>
                  <p class="text-secondary fs-11" style="line-height: 1.5; margin: 4px 0 var(--sp-2)">
                    Disabled signals are silently accepted (2xx) but dropped. All enabled by default.
                  </p>
                  <div class="signal-create-grid">
                    <label class="signal-toggle"><input type="checkbox" v-model="newSignalLogs" /><span>Logs</span></label>
                    <label class="signal-toggle"><input type="checkbox" v-model="newSignalApm" /><span>APM</span></label>
                    <label class="signal-toggle"><input type="checkbox" v-model="newSignalMetrics" /><span>Metrics</span></label>
                    <label class="signal-toggle"><input type="checkbox" v-model="newSignalRum" /><span>RUM</span></label>
                  </div>
                </div>

                <div v-if="api.error.value && activeTab === 'tenants'" style="margin-top: 10px; font-size: 12px; color: var(--error)">{{ api.error.value }}</div>
              </div>
              <div class="group-drawer-footer">
                <button class="btn btn-secondary" @click="closeTenantForm">Cancel</button>
                <button class="btn btn-primary" @click="createTenant" :disabled="!tenantName.trim() || creatingTenant || tenantNameTaken">{{ creatingTenant ? 'Creating…' : 'Create' }}</button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- Retention Edit Drawer (right slide-out) -->
      <Teleport to="body">
        <Transition name="group-drawer">
          <div v-if="showRetentionModal" class="group-drawer-overlay" @click.self="closeRetentionModal">
            <div class="group-drawer" role="dialog" aria-label="Retention policy">
              <div class="group-drawer-header">
                <span class="group-drawer-title">Retention · <span class="mono">{{ retentionEditTenantName }}</span></span>
                <button class="group-drawer-close" @click="closeRetentionModal" aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M18 6 6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <div class="group-drawer-body">
                <p class="text-secondary fs-11" style="line-height: 1.5; margin: 0 0 var(--sp-2)">
                  Set per-signal retention for this tenant. Leave a field empty to inherit the global default. Values are capped at the global maximum — anything higher is clamped down to the cap on save.
                </p>

                <div class="form-group-inline">
                  <label class="form-label">
                    Logs retention (days)
                    <span v-if="globalRetention" class="text-muted" style="font-weight: 400; margin-left: 6px; font-size: 11px">max {{ globalRetention.effective_logs }}d</span>
                  </label>
                  <input
                    v-model="retentionLogs"
                    type="number"
                    min="1"
                    :max="globalRetention?.effective_logs"
                    class="form-input mono"
                    :class="{ 'form-input-warn': retentionOver('logs') != null }"
                    :placeholder="globalRetention ? `inherit (${globalRetention.effective_logs} max)` : 'global default'"
                  />
                  <p v-if="retentionOver('logs') != null" class="retention-warn">⚠ Exceeds the global max of {{ retentionOver('logs') }}d — will be capped to {{ retentionOver('logs') }}d on save.</p>
                </div>
                <div class="form-group-inline mt-3">
                  <label class="form-label">
                    Traces retention (days)
                    <span v-if="globalRetention" class="text-muted" style="font-weight: 400; margin-left: 6px; font-size: 11px">max {{ globalRetention.effective_apm }}d</span>
                  </label>
                  <input
                    v-model="retentionTraces"
                    type="number"
                    min="1"
                    :max="globalRetention?.effective_apm"
                    class="form-input mono"
                    :class="{ 'form-input-warn': retentionOver('traces') != null }"
                    :placeholder="globalRetention ? `inherit (${globalRetention.effective_apm} max)` : 'global default'"
                  />
                  <p v-if="retentionOver('traces') != null" class="retention-warn">⚠ Exceeds the global max of {{ retentionOver('traces') }}d — will be capped to {{ retentionOver('traces') }}d on save.</p>
                </div>
                <div class="form-group-inline mt-3">
                  <label class="form-label">
                    Metrics retention (days)
                    <span v-if="globalRetention" class="text-muted" style="font-weight: 400; margin-left: 6px; font-size: 11px">max {{ globalRetention.effective_metrics }}d</span>
                  </label>
                  <input
                    v-model="retentionMetrics"
                    type="number"
                    min="1"
                    :max="globalRetention?.effective_metrics"
                    class="form-input mono"
                    :class="{ 'form-input-warn': retentionOver('metrics') != null }"
                    :placeholder="globalRetention ? `inherit (${globalRetention.effective_metrics} max)` : 'global default'"
                  />
                  <p v-if="retentionOver('metrics') != null" class="retention-warn">⚠ Exceeds the global max of {{ retentionOver('metrics') }}d — will be capped to {{ retentionOver('metrics') }}d on save.</p>
                </div>

                <div v-if="retentionSaveError" style="margin-top: 10px; font-size: 12px; color: var(--error)">{{ retentionSaveError }}</div>
              </div>
              <div class="group-drawer-footer">
                <button class="btn btn-secondary" @click="closeRetentionModal">Cancel</button>
                <button class="btn btn-primary" @click="saveRetention" :disabled="retentionSaving">
                  {{ retentionSaving ? 'Saving…' : 'Save' }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>
    </div>

    <!-- Groups Section -->
    <div
      v-show="activeTab === 'groups'"
      id="panel-groups"
      class="section"
      role="tabpanel"
      aria-labelledby="tab-groups"
    >
      <div class="section-card card">
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Groups</h2>
            <p class="card-desc text-secondary">
              Groups bundle scopes, permissions, and tenant bindings into assignable units.
            </p>
          </div>
          <button v-if="isAdmin" class="btn-create" @click="openGroupForm()">+ Create Group</button>
        </div>

        <!-- Error State -->
        <div v-if="api.error.value && activeTab === 'groups'" class="error-row">
          <span class="err-mark">!</span>
          <span>{{ api.error.value }}</span>
        </div>

        <!-- Groups Table -->
        <div v-if="groups.length > 0" class="grid-table group-grid">
          <div class="grid-head">
            <div>Name</div>
            <div>Scopes</div>
            <div>Permissions</div>
            <div>Tenants</div>
            <div>System</div>
            <div>Actions</div>
          </div>
          <div v-for="g in groups" :key="g.id" class="grid-row">
            <div class="grid-cell">
              <span class="cell-avatar">{{ g.name.charAt(0).toUpperCase() }}</span>
              <span class="mono fw-600">{{ g.name }}</span>
            </div>
            <div class="grid-cell">
              <span v-for="s in g.scopes" :key="s" class="cell-tag cell-tag-muted" style="margin-right: 4px">{{ s }}</span>
            </div>
            <div class="grid-cell">
              <span v-for="p in g.permissions" :key="p" class="cell-tag" :class="p === 'write' ? 'cell-tag-amber' : 'cell-tag-muted'" style="margin-right: 4px">{{ p }}</span>
            </div>
            <div class="grid-cell">
              <span v-if="g.tenant_ids.length === 0" class="text-muted">none</span>
              <span v-for="tid in g.tenant_ids" :key="tid" class="cell-tag cell-tag-muted" style="margin-right: 4px">{{ tenantDisplayName(tid) }}</span>
            </div>
            <div class="grid-cell">
              <span v-if="g.system" class="cell-tag cell-tag-amber">SYSTEM</span>
              <span v-else class="text-muted">-</span>
            </div>
            <div class="grid-cell grid-actions">
              <button v-if="isAdmin" class="action-btn" @click="openGroupForm(g)">Edit</button>
              <button
                v-if="isAdmin && !g.system"
                class="action-btn action-btn-danger"
                @click="askDelete('group', g.id, g.name)"
              >
                Delete
              </button>
              <span v-if="g.system && isAdmin" class="text-muted">-</span>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="keys-empty">
          <div class="text-muted">No groups found.</div>
          <div class="text-secondary fs-11">Create a group to manage permissions.</div>
        </div>
      </div>
    </div>

    <!-- Users Section -->
    <div
      v-show="activeTab === 'users'"
      id="panel-users"
      class="section"
      role="tabpanel"
      aria-labelledby="tab-users"
    >
      <div class="section-card card">
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Users</h2>
            <p class="card-desc text-secondary">
              Manage local user accounts for authentication and access control.
            </p>
          </div>
          <button v-if="isAdmin" class="btn-create" @click="showUserForm = true">
            + Create User
          </button>
        </div>

        <!-- Error State -->
        <div v-if="api.error.value && activeTab === 'users'" class="error-row">
          <span class="err-mark">!</span>
          <span>{{ api.error.value }}</span>
        </div>

        <!-- Users Table -->
        <div v-if="users.length > 0" class="grid-table user-grid">
          <div class="grid-head">
            <div>User</div>
            <div>Groups</div>
            <div>Enabled</div>
            <div>Actions</div>
          </div>
          <template v-for="u in users" :key="u.id">
            <div class="grid-row" :class="{ 'grid-row-dim': !u.enabled }">
              <div class="grid-cell">
                <span class="cell-avatar">{{ (u.display_name || u.username).charAt(0).toUpperCase() }}</span>
                <span class="mono fw-600">{{ u.username }}</span>
                <span v-if="u.display_name && u.display_name !== u.username" class="text-muted fs-11">{{ u.display_name }}</span>
              </div>
              <div class="grid-cell">
                <span
                  v-for="gid in (userGroupMap[u.id] || [])"
                  :key="gid"
                  class="cell-tag cell-tag-muted"
                  style="margin-right: 4px; font-size: 10px"
                >{{ groupNameById(gid) }}</span>
                <span v-if="!(userGroupMap[u.id] || []).length" class="text-muted fs-11">none</span>
              </div>
              <div class="grid-cell">
                <label v-if="isAdmin" class="toggle">
                  <input type="checkbox" :checked="u.enabled" @change="toggleUserEnabled(u.id, !u.enabled)" />
                  <span class="toggle-slider"></span>
                </label>
                <span v-else :style="{ color: u.enabled ? 'var(--ok)' : 'var(--text-muted)' }">{{ u.enabled ? 'Yes' : 'No' }}</span>
              </div>
              <div class="grid-cell grid-actions">
                <button v-if="isAdmin" class="action-btn" @click="openEditUserGroups(u.id)">Groups</button>
                <button class="action-btn" @click="changePasswordUserId = u.id; changePasswordValue = ''">Password</button>
                <template v-if="u.username !== 'admin' && isAdmin">
                  <button class="action-btn action-btn-danger" @click="askDelete('user', u.id, u.username)">Delete</button>
                </template>
                <span v-else class="text-muted">-</span>
              </div>
            </div>
          </template>
        </div>

        <!-- Empty State -->
        <div v-else class="keys-empty">
          <div class="text-muted">No users found.</div>
          <div class="text-secondary fs-11">Create a user to get started.</div>
        </div>
      </div>
    </div>

    <!-- ── Alerting panel ── -->
    <div
      v-show="activeTab === 'alerting'"
      id="panel-alerting"
      class="section"
      role="tabpanel"
      aria-labelledby="tab-alerting"
    >
      <div class="section-card card">
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Notification Channels</h2>
            <p class="card-desc text-secondary">
              Configure where alerts are sent. Channels are shared across all alert rules.
            </p>
          </div>
          <button class="btn-create" @click="showChannelForm = !showChannelForm; editingChannel = undefined">
            {{ showChannelForm && !editingChannel ? 'Cancel' : '+ Add Channel' }}
          </button>
        </div>

        <!-- Inline add form -->
        <div v-if="showChannelForm" style="padding: 0 var(--sp-4) var(--sp-4)">
          <ChannelForm
            :channel="editingChannel"
            @save="saveAlertChannel"
            @cancel="cancelChannelForm"
          />
        </div>

        <!-- Channel list -->
        <div v-if="!alertChannelsLoaded" class="keys-empty text-muted">Loading…</div>
        <div v-else-if="alertChannels.length === 0 && !showChannelForm" class="keys-empty">
          <div class="text-muted">No channels configured yet.</div>
          <div class="text-secondary fs-11">Add a channel to start routing alerts.</div>
        </div>
        <div v-else class="channels-table">
          <div class="channels-header">
            <div class="col-ch-name">Channel</div>
            <div class="col-ch-type">Type</div>
            <div class="col-ch-status">Status</div>
            <div class="col-ch-actions">Actions</div>
          </div>
          <div
            v-for="ch in alertChannels"
            :key="ch.id"
            class="channels-row"
          >
            <div class="col-ch-name">
              <span
                class="ch-badge mono"
                :title="channelTypeLabel(ch.channel_type)"
              >{{ channelTypeIcon(ch.channel_type) }}</span>
              <span class="ch-name">{{ ch.name }}</span>
            </div>
            <div class="col-ch-type text-secondary">{{ channelTypeLabel(ch.channel_type) }}</div>
            <div class="col-ch-status">
              <span :class="['ch-status', ch.enabled ? 'ch-status-on' : 'ch-status-off']">
                <span class="ch-dot"></span>{{ ch.enabled ? 'Enabled' : 'Disabled' }}
              </span>
            </div>
            <div class="col-ch-actions">
              <button
                class="action-btn"
                :disabled="testingChannelId === ch.id"
                @click="testAlertChannel(ch.id)"
              >{{ testingChannelId === ch.id ? '…' : 'Test' }}</button>
              <button class="action-btn" @click="startEditChannel(ch)">Edit</button>
              <button class="action-btn action-btn-danger" @click="askDelete('channel', ch.id, ch.name)">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Metric Firewall panel ── -->
    <div
      v-show="activeTab === 'firewall'"
      id="panel-firewall"
      class="section"
      role="tabpanel"
      aria-labelledby="tab-firewall"
    >
      <div v-if="isAdmin" class="section-card card">
        <div class="card-header">
          <div class="card-header-text">
            <h2 class="card-title">Metric Firewall</h2>
            <p class="card-desc text-secondary">
              Rules run at ingest time. <strong>Allow</strong> exempts matching series from all Block rules; <strong>Block</strong> drops matching series entirely; <strong>Strip labels</strong> removes matching label keys before storage. For allowlist mode, create Allow rules then one Block rule with no criteria.
            </p>
          </div>
          <button class="btn-create" @click="openFirewallForm()">+ Add Rule</button>
        </div>

        <div v-if="firewallNotice" class="fw-notice fade-in">{{ firewallNotice }}</div>

        <!-- Rules table -->
        <div v-if="firewallRules.length > 0" class="grid-table firewall-grid">
          <div class="grid-head">
            <div>Name</div>
            <div>Action</div>
            <div>Match</div>
            <div>Strip label</div>
            <div>Enabled</div>
            <div>Actions</div>
          </div>
          <div v-for="rule in firewallRules" :key="rule.id" class="grid-row">
            <div class="grid-cell mono fw-600">{{ rule.name }}</div>
            <div class="grid-cell">
              <span class="cell-tag" :class="rule.action === 'block' ? 'cell-tag-danger' : rule.action === 'allow' ? 'cell-tag-ok' : 'cell-tag-amber'">
                {{ rule.action === 'block' ? 'Block' : rule.action === 'allow' ? 'Allow' : 'Strip labels' }}
              </span>
            </div>
            <div class="grid-cell text-secondary mono" style="font-size:11px">
              {{ firewallMatchSummary(rule) }}
            </div>
            <div class="grid-cell mono text-muted" style="font-size:11px">
              <template v-if="rule.drop_label_pattern">
                {{ rule.drop_label_pattern }}<span v-if="rule.drop_label_regex === 1" class="text-muted"> (regex)</span>
              </template>
              <span v-else class="text-muted">—</span>
            </div>
            <div class="grid-cell">
              <label class="toggle">
                <input type="checkbox" :checked="rule.enabled === 1" @change="toggleFirewallRule(rule)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="grid-cell grid-actions">
              <button class="action-btn" @click="openFirewallForm(rule)">Edit</button>
              <button class="action-btn action-btn-danger" @click="askDelete('firewall rule', rule.id, rule.name)">Delete</button>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="fw-empty">
          <div class="fw-empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>
            </svg>
          </div>
          <div class="fw-empty-title">No firewall rules</div>
          <div class="fw-empty-desc">Block metric series or strip sensitive labels at ingest before they reach storage.</div>
          <button class="btn btn-primary" @click="openFirewallForm()">Create first rule</button>
        </div>
      </div>
      <div v-else class="set-card">
        <div class="set-card-head">
          <p class="card-desc">Only admins can view or change firewall rules.</p>
        </div>
      </div>

      <!-- Firewall Rule Drawer -->
      <Teleport to="body">
        <Transition name="group-drawer">
          <div v-if="showFirewallForm" class="group-drawer-overlay" @click.self="closeFirewallForm">
            <div class="group-drawer group-drawer-wide" role="dialog" aria-label="Firewall rule">
              <div class="group-drawer-header">
                <span class="group-drawer-title">{{ editingFirewallId ? 'Edit Rule' : 'New Firewall Rule' }}</span>
                <button class="group-drawer-close" @click="closeFirewallForm" aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M18 6 6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              <div class="group-drawer-body fw-wizard-body">

                <!-- Step 1: Action -->
                <div class="fw-step">
                  <div class="fw-step-hd">
                    <span class="fw-step-num">01</span>
                    <span class="fw-step-title">What should this rule do?</span>
                  </div>
                  <div class="fw-action-cards">
                    <button
                      type="button"
                      class="fw-action-card"
                      :class="{ active: fwAction === 'block' }"
                      @click="fwAction = 'block'; fwSuggestName()"
                    >
                      <div class="fw-action-bar fw-action-bar-block"></div>
                      <div class="fw-action-body">
                        <div class="fw-action-title">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                            <circle cx="12" cy="12" r="9"/><path d="M5.5 5.5l13 13"/>
                          </svg>
                          Block series
                        </div>
                        <div class="fw-action-desc">Matching series are dropped at ingest — never stored.</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      class="fw-action-card"
                      :class="{ active: fwAction === 'allow' }"
                      @click="fwAction = 'allow'; fwSuggestName()"
                    >
                      <div class="fw-action-bar fw-action-bar-allow"></div>
                      <div class="fw-action-body">
                        <div class="fw-action-title">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>
                          </svg>
                          Allow series
                        </div>
                        <div class="fw-action-desc">Matching series are exempt from all Block rules — allowlist mode.</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      class="fw-action-card"
                      :class="{ active: fwAction === 'drop_label' }"
                      @click="fwAction = 'drop_label'; fwSuggestName()"
                    >
                      <div class="fw-action-bar fw-action-bar-drop"></div>
                      <div class="fw-action-body">
                        <div class="fw-action-title">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>
                            <line x1="9" y1="12" x2="15" y2="12"/>
                          </svg>
                          Strip labels
                        </div>
                        <div class="fw-action-desc">Series are kept, but matching label keys are removed before storage.</div>
                      </div>
                    </button>
                  </div>
                  <p v-if="fwAction === 'allow'" class="fw-hint" style="margin-top:8px">
                    Allowlist mode: add Allow rules for what to keep, then one Block rule with no criteria to block everything else. Allow beats Block; Strip labels still applies.
                  </p>
                </div>

                <!-- Step 2: Match criteria -->
                <div class="fw-step">
                  <div class="fw-step-hd">
                    <span class="fw-step-num">02</span>
                    <span class="fw-step-title">Which series should match?</span>
                    <span class="fw-step-chip">{{ fwAction === 'allow' ? 'criteria required' : 'leave empty to match all' }}</span>
                  </div>

                  <div class="fw-field">
                    <div class="fw-field-hd">
                      <label class="fw-field-label">Metric name</label>
                      <div class="fw-seg" role="group" aria-label="Metric match mode">
                        <button type="button" :class="{ active: !fwMetricRegex }" @click="fwMetricRegex = false">exact</button>
                        <button type="button" :class="{ active: fwMetricRegex }" @click="fwMetricRegex = true">regex</button>
                      </div>
                      <RegexHelp v-if="fwMetricRegex" />
                    </div>
                    <input
                      v-model="fwMetricPattern"
                      @input="fwSuggestName()"
                      class="form-input mono"
                      :class="{ 'form-input-warn': fwMetricRegexError }"
                      :placeholder="fwMetricRegex ? 'e.g. ^node_.*' : 'e.g. http_requests_total'"
                    />
                    <p v-if="fwMetricRegexError" class="fw-field-err">Invalid regex: {{ fwMetricRegexError }}</p>
                  </div>

                  <div class="fw-field">
                    <div class="fw-field-hd">
                      <label class="fw-field-label">Label filter <span class="fw-optional">(optional)</span></label>
                      <div class="fw-seg" role="group" aria-label="Label value match mode">
                        <button type="button" :class="{ active: !fwMatchLabelValueRegex }" @click="fwMatchLabelValueRegex = false">exact</button>
                        <button type="button" :class="{ active: fwMatchLabelValueRegex }" @click="fwMatchLabelValueRegex = true">regex</button>
                      </div>
                      <RegexHelp v-if="fwMatchLabelValueRegex" />
                    </div>
                    <div class="fw-label-pair">
                      <input v-model="fwMatchLabelKey" @input="fwSuggestName()" class="form-input mono" placeholder="key" />
                      <span class="fw-label-eq mono">{{ fwMatchLabelValueRegex ? '~' : '=' }}</span>
                      <input
                        v-model="fwMatchLabelValue"
                        class="form-input mono"
                        :class="{ 'form-input-warn': fwLabelRegexError }"
                        placeholder="value (any)"
                      />
                    </div>
                    <p v-if="fwLabelRegexError" class="fw-field-err">Invalid regex: {{ fwLabelRegexError }}</p>
                  </div>
                </div>

                <!-- Step 3: Label keys to strip (drop_label only) -->
                <div v-if="fwAction === 'drop_label'" class="fw-step">
                  <div class="fw-step-hd">
                    <span class="fw-step-num">03</span>
                    <span class="fw-step-title">Which label keys to strip?</span>
                  </div>
                  <div class="fw-field">
                    <div class="fw-field-hd">
                      <label class="fw-field-label">Label key pattern</label>
                      <div class="fw-seg" role="group" aria-label="Drop label match mode">
                        <button type="button" :class="{ active: !fwDropLabelRegex }" @click="fwDropLabelRegex = false">exact</button>
                        <button type="button" :class="{ active: fwDropLabelRegex }" @click="fwDropLabelRegex = true">regex</button>
                      </div>
                      <RegexHelp v-if="fwDropLabelRegex" />
                    </div>
                    <input
                      v-model="fwDropLabelPattern"
                      @input="fwSuggestName()"
                      class="form-input mono"
                      :class="{ 'form-input-warn': fwDropRegexError }"
                      :placeholder="fwDropLabelRegex ? 'e.g. internal_.*' : 'e.g. pod_uid'"
                    />
                    <p v-if="fwDropRegexError" class="fw-field-err">Invalid regex: {{ fwDropRegexError }}</p>
                    <p v-else-if="!fwDropLabelPattern.trim()" class="fw-hint">Required — specify at least one label key to strip.</p>
                  </div>
                </div>

                <!-- Live preview -->
                <div class="fw-preview-wrap" :class="{ 'fw-preview-alert': fwMatchesAll || (fwAction === 'allow' && fwNoCriteria) }">
                  <div class="fw-preview-chip">Preview</div>
                  <div class="fw-preview-row">
                    <span
                      class="fw-preview-verb"
                      :class="fwAction === 'block' ? 'fw-preview-verb-block' : fwAction === 'allow' ? 'fw-preview-verb-allow' : 'fw-preview-verb-drop'"
                    >{{ fwPreview.verb }}</span>
                    <span class="mono fw-preview-detail">{{ fwPreview.detail }}</span>
                  </div>
                  <div v-if="fwMatchesAll && fwHasOtherAllowRules" class="fw-preview-warn-text">
                    ⚠ Allowlist mode — this blocks every series <strong>except</strong> those matching your enabled Allow rules.
                  </div>
                  <div v-else-if="fwMatchesAll" class="fw-preview-warn-text">
                    ⚠ No match criteria — this would block <strong>every metric series</strong> at ingest. Create at least one enabled Allow rule first (allowlist mode), or add a metric/label match.
                  </div>
                  <div v-else-if="fwAction === 'allow' && fwNoCriteria" class="fw-preview-warn-text">
                    ⚠ Allow rules need a metric name or label filter — allowing everything is already the default.
                  </div>
                </div>

                <!-- Step N: Name + activate -->
                <div class="fw-step fw-step-final">
                  <div class="fw-step-hd">
                    <span class="fw-step-num">{{ fwAction === 'drop_label' ? '04' : '03' }}</span>
                    <span class="fw-step-title">Name & activate</span>
                  </div>
                  <div class="fw-field">
                    <label class="fw-field-label">Rule name</label>
                    <input
                      v-model="fwName"
                      @input="fwNameTouched = true"
                      class="form-input mono"
                      placeholder="auto-named from the rule"
                    />
                    <p v-if="!fwNameTouched && fwName" class="fw-hint">Suggested from the rule — edit to rename.</p>
                  </div>
                </div>

                <div v-if="firewallFormError" class="fw-form-err">{{ firewallFormError }}</div>
              </div>

              <div class="group-drawer-footer">
                <button class="btn btn-secondary" @click="closeFirewallForm">Cancel</button>
                <button class="btn btn-primary" @click="saveFirewallRule" :disabled="!fwCanSave">
                  {{ editingFirewallId ? 'Save Changes' : 'Create Rule' }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>
    </div>

    <SkillEditDialog
      :open="skillDialogOpen"
      :skill="editingSkill"
      :template="dialogTemplate"
      @close="closeSkillDialog"
      @saved="onSkillSaved"
    />

    <!-- ═══ Delete confirmation modal ═══ -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="deleteModal" class="delete-modal-overlay" @click.self="deleteModal = null">
          <div class="delete-modal">
            <div class="delete-modal-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <circle cx="12" cy="12" r="10" opacity="0.2"/>
                <path d="M12 8v4M12 16h.01"/>
              </svg>
            </div>
            <div class="delete-modal-title">Delete {{ deleteModal.type }}?</div>
            <div class="delete-modal-desc">
              Are you sure you want to delete
              <strong class="mono">{{ deleteModal.label }}</strong>?
              This action cannot be undone.
            </div>
            <div class="delete-modal-actions">
              <button class="btn btn-secondary" @click="deleteModal = null">Cancel</button>
              <button class="btn btn-danger" @click="confirmDelete">Delete</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ Channel test result modal ═══ -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="testModal" class="delete-modal-overlay" @click.self="testModal = null">
          <div class="delete-modal">
            <div :class="['delete-modal-icon', testModal.ok ? 'icon-ok' : '']">
              <svg v-if="testModal.ok" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" opacity="0.2"/>
                <path d="m8 12 3 3 5-6"/>
              </svg>
              <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <circle cx="12" cy="12" r="10" opacity="0.2"/>
                <path d="M12 8v4M12 16h.01"/>
              </svg>
            </div>
            <div class="delete-modal-title">{{ testModal.ok ? 'Test notification sent' : 'Test failed' }}</div>
            <div class="delete-modal-desc">
              <strong class="mono">{{ testModal.name }}</strong> — {{ testModal.message }}
            </div>
            <div class="delete-modal-actions">
              <button class="btn btn-primary" @click="testModal = null">Close</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ Change password modal ═══ -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="changePasswordUserId" class="delete-modal-overlay" @click.self="changePasswordUserId = null">
          <div class="delete-modal">
            <div class="delete-modal-icon icon-amber">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div class="delete-modal-title">Change password</div>
            <div class="delete-modal-desc">
              Set a new password for <strong class="mono">{{ changePasswordUsername }}</strong>.
            </div>
            <div class="modal-stack">
              <input
                v-model="changePasswordValue"
                type="password"
                autocomplete="new-password"
                class="form-input mono"
                placeholder="New password"
              />
              <input
                v-model="changePasswordConfirm"
                type="password"
                autocomplete="new-password"
                class="form-input mono"
                placeholder="Confirm password"
                :class="{ 'input-error': passwordMismatch }"
                @keyup.enter="!passwordMismatch && changePasswordValue && changePassword(changePasswordUserId!)"
              />
              <div v-if="passwordMismatch" class="pw-mismatch">Passwords do not match</div>
            </div>
            <div class="delete-modal-actions">
              <button class="btn btn-secondary" @click="changePasswordUserId = null; changePasswordValue = ''; changePasswordConfirm = ''">Cancel</button>
              <button class="btn btn-primary" :disabled="!changePasswordValue || passwordMismatch || !changePasswordConfirm" @click="changePassword(changePasswordUserId!)">Save</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Edit user groups modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="editUserGroupsId" class="delete-modal-overlay" @click.self="editUserGroupsId = null">
          <div class="delete-modal">
            <div class="delete-modal-icon icon-amber">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div class="delete-modal-title">Edit groups</div>
            <div class="delete-modal-desc">
              Assign groups for <strong class="mono">{{ editUserGroupsUsername }}</strong>.
            </div>
            <div class="modal-stack">
              <label v-for="g in groups" :key="g.id" class="checkbox-label" style="padding: 4px 0">
                <input type="checkbox" :checked="editUserGroupIds.includes(g.id)" @change="toggleUserGroup(g.id)" />
                <span class="mono">{{ g.name }}</span>
                <span v-if="g.system" class="cell-tag cell-tag-amber" style="font-size: 9px; margin-left: 4px">SYSTEM</span>
              </label>
            </div>
            <div class="delete-modal-actions">
              <button class="btn btn-secondary" @click="editUserGroupsId = null">Cancel</button>
              <button class="btn btn-primary" @click="saveUserGroups">Save</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ User drawer ═══ -->
    <Teleport to="body">
      <div v-if="userGroupDropdownOpen" class="tenant-multiselect-backdrop" @click="userGroupDropdownOpen = false"></div>
      <Transition name="group-drawer">
        <div v-if="showUserForm && isAdmin" class="group-drawer-overlay" @click.self="showUserForm = false; newUserGroupIds = []; userGroupDropdownOpen = false">
          <div class="group-drawer">
            <div class="group-drawer-header">
              <span class="group-drawer-title">Create User</span>
              <button class="group-drawer-close" @click="showUserForm = false; newUserGroupIds = []; userGroupDropdownOpen = false" aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div class="group-drawer-body">
              <div class="form-group-inline">
                <label class="form-label">Username</label>
                <input
                  v-model="newUserUsername"
                  class="form-input mono"
                  placeholder="e.g. jdoe"
                  @keyup.enter="createNewUser"
                />
              </div>
              <div class="form-group-inline mt-3">
                <label class="form-label">Password</label>
                <input
                  v-model="newUserPassword"
                  type="password"
                  autocomplete="new-password"
                  class="form-input mono"
                  placeholder="Password"
                />
              </div>
              <div class="form-group-inline mt-3">
                <label class="form-label">Display Name</label>
                <input
                  v-model="newUserDisplayName"
                  class="form-input mono"
                  placeholder="e.g. Jane Doe"
                />
              </div>
              <div class="group-drawer-section">
                <label class="form-label">Groups</label>
                <div class="tenant-multiselect" @click.stop>
                  <button type="button" class="tenant-multiselect-trigger" @click="userGroupDropdownOpen = !userGroupDropdownOpen">
                    <span :class="newUserGroupIds.length === 0 ? 'text-muted' : ''">{{ userGroupSelectionLabel }}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" :style="{ transform: userGroupDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }">
                      <path d="M6 9l6 6 6-6"/>
                    </svg>
                  </button>
                  <div v-if="userGroupDropdownOpen" class="tenant-multiselect-menu">
                    <label v-for="g in groups" :key="g.id" class="tenant-multiselect-item">
                      <input type="checkbox" :checked="newUserGroupIds.includes(g.id)" @change="toggleNewUserGroup(g.id)" />
                      <span class="mono">{{ g.name }}</span>
                      <span v-if="g.system" class="cell-tag cell-tag-amber" style="font-size: 9px; margin-left: auto">SYSTEM</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div class="group-drawer-footer">
              <button class="btn btn-secondary" @click="showUserForm = false; newUserGroupIds = []; userGroupDropdownOpen = false">Cancel</button>

              <button
                class="btn btn-primary"
                @click="createNewUser"
                :disabled="!newUserUsername.trim() || !newUserPassword"
              >
                Create User
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ Group drawer ═══ -->
    <Teleport to="body">
      <div v-if="tenantDropdownOpen" class="tenant-multiselect-backdrop" @click="tenantDropdownOpen = false"></div>
      <Transition name="group-drawer">
        <div v-if="showGroupForm && isAdmin" class="group-drawer-overlay" @click.self="closeGroupForm">
          <div class="group-drawer">
            <div class="group-drawer-header">
              <span class="group-drawer-title">{{ editingGroupId ? 'Edit Group' : 'Create Group' }}</span>
              <button class="group-drawer-close" @click="closeGroupForm" aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div class="group-drawer-body">
              <div class="form-group-inline">
                <label class="form-label">Name</label>
                <input
                  v-model="groupName"
                  class="form-input mono"
                  :disabled="!!editingGroupId"
                  placeholder="e.g. platform-eng, security"
                  @keyup.enter="saveGroup"
                />
              </div>
              <div class="form-group-inline mt-3">
                <label class="form-label">Description</label>
                <input
                  v-model="groupDescription"
                  class="form-input"
                  placeholder="Optional description"
                />
              </div>
              <div class="group-drawer-section">
                <label class="form-label">Scopes</label>
                <div class="group-drawer-checks">
                  <label v-for="s in allScopes" :key="s" class="checkbox-label">
                    <input type="checkbox" :checked="groupScopes.includes(s)" @change="toggleScope(s)" />
                    <span class="mono">{{ s }}</span>
                  </label>
                </div>
              </div>
              <div class="group-drawer-section">
                <label class="form-label">Permissions</label>
                <div class="group-drawer-checks">
                  <label v-for="p in allPermissions" :key="p" class="checkbox-label">
                    <input type="checkbox" :checked="groupPermissions.includes(p)" @change="togglePermission(p)" />
                    <span class="mono">{{ p }}</span>
                  </label>
                </div>
              </div>
              <div class="group-drawer-section">
                <label class="form-label">Tenant Access</label>
                <div v-if="tenants.length > 0" class="tenant-multiselect" @click.stop>
                  <button
                    type="button"
                    class="tenant-multiselect-trigger"
                    @click="tenantDropdownOpen = !tenantDropdownOpen"
                  >
                    <span :class="groupTenantIds.length === 0 && !allTenantsSelected ? 'text-muted' : ''">
                      {{ tenantSelectionLabel }}
                    </span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" :style="{ transform: tenantDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }">
                      <path d="M6 9l6 6 6-6"/>
                    </svg>
                  </button>
                  <div v-if="tenantDropdownOpen" class="tenant-multiselect-menu">
                    <label class="tenant-multiselect-item tenant-multiselect-all">
                      <input type="checkbox" :checked="allTenantsSelected" @change="toggleAllTenants" />
                      <span style="font-weight: 600">All tenants</span>
                    </label>
                    <div class="tenant-multiselect-divider"></div>
                    <label v-for="t in tenants" :key="t.id" class="tenant-multiselect-item">
                      <input type="checkbox" :checked="groupTenantIds.includes(t.id)" @change="toggleGroupTenant(t.id)" />
                      <span class="mono">{{ t.name }}</span>
                      <span v-if="!t.enabled" class="cell-tag cell-tag-muted" style="margin-left: auto; font-size: 10px">disabled</span>
                    </label>
                  </div>
                </div>
                <div v-else class="text-muted fs-11">No tenants available.</div>
              </div>
            </div>
            <div class="group-drawer-footer">
              <button class="btn btn-secondary" @click="closeGroupForm">Cancel</button>
              <button
                class="btn btn-primary"
                @click="saveGroup"
                :disabled="!editingGroupId && !groupName.trim()"
              >
                {{ editingGroupId ? 'Save Changes' : 'Create Group' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
      </div><!-- /.settings-content -->
    </div><!-- /.settings-shell -->
  </div>
</template>

<style scoped src="../styles/views/SettingsView.css"></style>
