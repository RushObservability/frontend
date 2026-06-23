<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useLicense } from '../composables/useLicense'
import { useFeatures } from '../composables/useFeatures'
import { getAddon, availableAddons } from '../integrations/catalog'
import { isAddonEnabled } from '../composables/useIntegrationEnabled'
import '../styles/views/IntegrationsView.css'

const route = useRoute()
const router = useRouter()
const api = useApi()
const { loaded, loadLicense, hasEntitlement } = useLicense()
const { features, loadFeatures } = useFeatures()
// A free add-on is platform-enabled per the backend (Helm/env → /api/v1/features).
const featureOn = (k: string) => !!(features.value as Record<string, boolean | undefined>)[k]

// Rail = free add-ons that are both Helm-enabled and toggled on, plus licensed ones.
const addons = computed(() => availableAddons(hasEntitlement, featureOn, isAddonEnabled))

// ── Resolve current add-on + page from the route ──
const addonKey = computed(() => (route.params.addon as string) || '')
const pageKey = computed(() => (route.params.page as string) || '')
const addon = computed(() => getAddon(addonKey.value))
// Available = (free → Helm-enabled + toggled on) | (licensed → entitled).
const available = computed(() =>
  !!addon.value &&
  (addon.value.free
    ? featureOn(addon.value.key) && isAddonEnabled(addon.value)
    : !!addon.value.entitlement && hasEntitlement(addon.value.entitlement)),
)
// A free add-on disabled in the Helm chart (feature off) → show a hint to enable it there.
const helmDisabled = computed(() => !!addon.value?.free && !featureOn(addon.value!.key))
const activePage = computed(() => {
  const a = addon.value
  if (!a) return undefined
  return a.pages.find((p) => p.key === pageKey.value) ?? a.pages[0]
})

// ── Server discovery (e.g. which Postgres instances are reporting) ──
const servers = ref<string[]>([])
const serversLoaded = ref(false)
const selectedServer = computed(() => (route.query.server as string) || servers.value[0] || '')

async function loadServers() {
  serversLoaded.value = false
  servers.value = []
  const metric = addon.value?.serverDiscoveryMetric
  if (!metric) { serversLoaded.value = true; return }
  try {
    const res = await api.promQuery(metric)
    const set = new Set<string>()
    for (const s of res.result) {
      const name = s.metric.service_name
      if (name) set.add(name)
    }
    servers.value = Array.from(set).sort()
  } catch { /* leave empty → setup guide */ }
  serversLoaded.value = true
}

function selectServer(name: string) {
  // Changing instance resets the db scope (databases differ per instance).
  const q = { ...route.query, server: name }
  delete (q as Record<string, unknown>).db
  delete (q as Record<string, unknown>).host
  router.replace({ params: route.params, query: q })
}

// ── Database scope (within the selected instance) ──
// A database is identified by host + db (same name can exist on different hosts).
const dbs = ref<Array<{ host: string; db: string }>>([])
const selectedHost = computed(() => (route.query.host as string) || '')
const selectedDb = computed(() => (route.query.db as string) || '') // '' = All
const selectedPair = computed(() =>
  selectedHost.value || selectedDb.value ? `${selectedHost.value}\t${selectedDb.value}` : '',
)

async function loadDbs() {
  dbs.value = []
  const metric = addon.value?.dbDiscoveryMetric
  if (!metric || !selectedServer.value) return
  try {
    const res = await api.promQuery(`${metric}{service_name="${selectedServer.value}"}`)
    const seen = new Set<string>()
    const pairs: Array<{ host: string; db: string }> = []
    for (const s of res.result) {
      const host = s.metric.host || ''
      const db = s.metric.db || ''
      if (!db) continue
      const k = `${host}\t${db}`
      if (!seen.has(k)) { seen.add(k); pairs.push({ host, db }) }
    }
    dbs.value = pairs.sort((a, b) => (a.host + a.db).localeCompare(b.host + b.db))
  } catch { /* leave empty → no db selector */ }
}

// Value is "host\tdb"; empty clears both (All databases).
function selectDb(value: string) {
  const [host, db] = value ? value.split('\t') : ['', '']
  router.replace({ params: route.params, query: { ...route.query, host: host || undefined, db: db || undefined } })
}

function go(addonK: string, pageK?: string) {
  const a = getAddon(addonK)
  const page = pageK || a?.pages[0]?.key || 'overview'
  router.push({ name: 'integration-page', params: { addon: addonK, page } })
}

// ── Default routing: land on the first entitled add-on / first page ──
function ensureRoute() {
  if (!loaded.value) return
  if (!addonKey.value) {
    const first = addons.value[0]
    if (first) router.replace({ name: 'integration-page', params: { addon: first.key, page: first.pages[0].key } })
    return
  }
  if (addon.value && !pageKey.value) {
    router.replace({ name: 'integration-page', params: { addon: addon.value.key, page: addon.value.pages[0].key } })
  }
}

onMounted(async () => {
  if (!loaded.value) await loadLicense()
  await loadFeatures()
  ensureRoute()
  await loadServers()
  await loadDbs()
})

watch(() => addonKey.value, async () => { ensureRoute(); await loadServers(); await loadDbs() })
watch(() => selectedServer.value, loadDbs)
watch(loaded, ensureRoute)
</script>

<template>
  <div class="integrations-shell">
    <!-- Left rail: entitled add-ons -->
    <aside class="integrations-rail" aria-label="Add-ons">
      <div class="rail-brand">Integrations</div>
      <div class="rail-group">
        <button
          v-for="a in addons"
          :key="a.key"
          :class="['rail-item', { active: a.key === addonKey }]"
          @click="go(a.key)"
        >
          {{ a.label }}
        </button>
        <div v-if="!addons.length" class="rail-empty">
          No add-ons entitled. Add an entitlement to your license to enable one.
        </div>
      </div>
    </aside>

    <!-- Main pane -->
    <section class="integrations-main">
      <template v-if="addon && available">
        <header class="integrations-head">
          <div class="head-left">
            <h1 class="content-title">{{ addon.label }}</h1>
          </div>
          <div class="head-selects">
            <div v-if="servers.length > 1" class="server-select">
              <label>Instance</label>
              <select :value="selectedServer" @change="selectServer(($event.target as HTMLSelectElement).value)">
                <option v-for="s in servers" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
            <div v-if="dbs.length" class="server-select">
              <label>Database</label>
              <select :value="selectedPair" @change="selectDb(($event.target as HTMLSelectElement).value)">
                <option value="">All databases</option>
                <option v-for="d in dbs" :key="d.host + d.db" :value="`${d.host}\t${d.db}`">{{ d.host }} / {{ d.db }}</option>
              </select>
            </div>
          </div>
        </header>

        <!-- Page sub-nav -->
        <nav class="page-tabs" role="tablist">
          <router-link
            v-for="p in addon.pages"
            :key="p.key"
            :to="{ name: 'integration-page', params: { addon: addon.key, page: p.key }, query: route.query }"
            :class="['page-tab', { active: p.key === activePage?.key }]"
          >{{ p.label }}</router-link>
        </nav>

        <!-- Page content / setup guide -->
        <div class="page-body">
          <component
            v-if="serversLoaded && !servers.length && addon.setupComponent"
            :is="addon.setupComponent"
          />
          <component
            v-else-if="activePage && addon.serverDiscoveryMetric"
            :is="activePage.component"
            :server="selectedServer"
            :host="selectedHost"
            :db="selectedDb"
          />
          <component v-else-if="activePage" :is="activePage.component" />
        </div>
      </template>

      <div v-else-if="helmDisabled" class="integrations-empty">
        <h2>{{ addon?.label }} is disabled in the Helm chart</h2>
        <p>
          This integration is controlled by your deployment. Set
          <code>{{ addonKey }}.enabled=true</code> in the Helm values and redeploy to enable it.
        </p>
      </div>

      <div v-else-if="loaded" class="integrations-empty">
        <h2>Integration not available</h2>
        <p>This add-on isn’t part of your license, or doesn’t exist.</p>
      </div>
    </section>
  </div>
</template>
