import { ref } from 'vue'
import { useTenant } from './useTenant'
import { authenticatedFetch } from './authSession'
import type {
  AuthUser,
  TraceResponse,
  QueryRequest,
  RushEvent,
  CountBucket,
  ServiceEntry,
  GroupResponse,
  TimeseriesResponse,
  Dashboard,
  DashboardVariable,
  DashboardWithWidgets,
  DashboardTemplate,
  DashboardExport,
  Widget,
  NotificationChannel,
  NotificationLogEntry,
  Slo,
  SloEvent,
  DeployMarker,
  Filter,
  ServiceGraph,
  LatencyHistogram,
  EndpointsResponse,
  ServiceErrorsResponse,
  LicenseStatus,
  PromVectorResponse,
  PromMatrixResponse,
  ApiKey,
  ApiKeyCreated,
  ServiceLink,
  LogRecord,
  StatsResponse,
  PartitionStorageResponse,
  UsageResponse,
  LabelBreakdownResponse,
  UsageMeteringSummary,
  UsageMeteringBreakdown,
  UsageMeteringTenantsResponse,
  AnomalyRule,
  AnomalyEvent,
  AnomalyEventWithRule,
  CorrelationResponse,
  AIAnalysisResponse,
  RumRecord,
  RumVitalsSummary,
  RumPageStats,
  RumErrorGroup,
  RumSessionSummary,
  RumAppEntry,
  ArgoApp,
  ArgoAppDetail,
  ArgoAppSet,
  FluxResource,
  FluxSource,
  FluxResourceDetail,
  K8sSummary,
  K8sResource,
  K8sResourceDetail,
  CustomSkill,
  CreateCustomSkillRequest,
  UpdateCustomSkillRequest,
  DetectionRule,
  DetectionEvent,
  Group,
  Tenant,
  TenantRetention,
  TenantSignals,
  SignalFlags,
  GlobalRetention,
  User,
  SsoProvider,
  IdpGroupMapping,
  SsoStatus,
  SetupToken,
  SetupTokenValidation,
  InvestigationSession,
  InvestigationTurn,
  InvestigationTemplate,
  BubbleUpRequest,
  BubbleUpResponse,
  Monitor,
  MonitorEvent,
  MonitorPreview,
  MaintenanceWindow,
  CreateMaintenanceWindowRequest,
  Funnel,
  FunnelStep,
  FunnelResult,
  MetricFirewallRule,
  MetricFirewallInput,
  AuditListResponse,
  AuditQueryParams,
  AuditVerifyResponse,
} from '../types'

const API_BASE = '/api/v1'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { activeTenant } = useTenant()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Rush-Tenant': activeTenant.value,
  }
  // Merge any caller-supplied headers on top
  if (options?.headers) {
    const incoming = options.headers as Record<string, string>
    Object.assign(headers, incoming)
  }
  const res = await authenticatedFetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'same-origin',
    headers,
  }, {
    // Invalid credentials and an already-ended manual logout are expected 401s;
    // neither should be presented as an expired in-app session.
    ignoreUnauthorized: path === '/auth/login' || path === '/auth/logout',
  })
  if (!res.ok) {
    const text = await res.text()
    // Extract only a safe "message" field from JSON bodies; never surface raw server
    // text (may contain stack traces, SQL, internal paths) directly to the UI.
    let userMessage: string
    try {
      const json = JSON.parse(text)
      userMessage = typeof json.message === 'string' ? json.message : `Request failed (${res.status})`
    } catch {
      userMessage = `Request failed (${res.status})`
    }
    console.debug('[API] error response:', res.status, text)
    throw new Error(userMessage)
  }
  // Tolerate empty bodies (e.g. 204 No Content from DELETE endpoints) — res.json()
  // would otherwise throw "Unexpected end of JSON input" and make a successful
  // delete look like a failure to the caller.
  const body = await res.text()
  return (body ? JSON.parse(body) : null) as T
}

export function useApi() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function getTrace(traceId: string): Promise<TraceResponse> {
    loading.value = true
    error.value = null
    try {
      return await request<TraceResponse>(`/traces/${traceId}`)
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function queryEvents(
    req: QueryRequest
  ): Promise<{ rows: RushEvent[]; total: number; next_cursor?: string }> {
    loading.value = true
    error.value = null
    try {
      return await request(`/query`, {
        method: 'POST',
        body: JSON.stringify(req),
      })
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function queryCount(
    req: Omit<QueryRequest, 'group_by' | 'aggregation' | 'limit' | 'offset'> & {
      interval?: string
    }
  ): Promise<CountBucket[]> {
    loading.value = true
    error.value = null
    try {
      return await request(`/query/count`, {
        method: 'POST',
        body: JSON.stringify(req),
      })
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function getServices(): Promise<{ services: ServiceEntry[] }> {
    loading.value = true
    error.value = null
    try {
      return await request(`/services`)
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function suggestValues(
    field: string,
    prefix?: string
  ): Promise<string[]> {
    const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''
    return await request(`/suggest/${encodeURIComponent(field)}${params}`)
  }

  async function queryGroup(req: QueryRequest): Promise<GroupResponse> {
    const raw = await request<{ groups: Array<Record<string, unknown>> }>(`/query/group`, {
      method: 'POST',
      body: JSON.stringify(req),
    })
    // The backend keys each group row by the grouped FIELD NAME (to support
    // multi-group-by), e.g. { service_name: "gateway", count: 123 }. Normalize
    // to the GroupResult { key, count } shape every consumer expects (facet
    // counts, BreakdownPanel) — reading `.key` off the raw row is undefined.
    const field = req.group_by?.[0] ?? 'key'
    const groups = (raw.groups ?? []).map((g) => ({
      key: String(g[field] ?? g.key ?? ''),
      count: typeof g.count === 'number' ? g.count : Number(g.count) || 0,
    }))
    return {
      field,
      groups,
      total: groups.reduce((sum, g) => sum + g.count, 0),
    }
  }

  async function queryTimeseries(req: {
    time_range: { from: string; to: string }
    filters: Filter[]
    interval?: string
    group_by?: string
  }): Promise<TimeseriesResponse> {
    return await request(`/query/timeseries`, {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  // Investigation responses are streamed as SSE, so they cannot use request(),
  // which consumes JSON bodies. Keep the transport here so this data-bearing
  // endpoint cannot accidentally omit the active tenant scope.
  async function openInvestigationStream(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const { activeTenant } = useTenant()
    return await authenticatedFetch(`${API_BASE}/investigate`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Rush-Tenant': activeTenant.value,
      },
      body: JSON.stringify(body),
      signal,
    })
  }

  // ── Dashboard API ──

  async function listDashboards(): Promise<{ dashboards: Dashboard[] }> {
    return await request('/dashboards')
  }

  async function getDashboard(id: string): Promise<DashboardWithWidgets> {
    return await request(`/dashboards/${id}`)
  }

  async function createDashboard(data: {
    name: string; description?: string; visibility?: string; tags?: string[]; variables?: DashboardVariable[]
  }): Promise<Dashboard> {
    return await request('/dashboards', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function updateDashboard(id: string, data: {
    name: string; description?: string; visibility?: string; tags?: string[]; variables?: DashboardVariable[]
  }): Promise<Dashboard> {
    return await request(`/dashboards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async function deleteDashboard(id: string): Promise<void> {
    await request(`/dashboards/${id}`, { method: 'DELETE' })
  }

  async function exportDashboard(id: string): Promise<DashboardExport> {
    return await request(`/dashboards/${id}/export`)
  }

  async function importDashboard(data: DashboardExport): Promise<Dashboard> {
    return await request('/dashboards/import', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function listDashboardTemplates(): Promise<{ templates: DashboardTemplate[] }> {
    return await request('/dashboard-templates')
  }

  async function createFromTemplate(templateId: string, name: string): Promise<Dashboard> {
    return await request(`/dashboard-templates/${templateId}/create`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  async function createWidget(dashId: string, data: Partial<Widget>): Promise<Widget> {
    return await request(`/dashboards/${dashId}/widgets`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function updateWidget(dashId: string, wid: string, data: Partial<Widget>): Promise<Widget> {
    return await request(`/dashboards/${dashId}/widgets/${wid}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async function deleteWidget(dashId: string, wid: string): Promise<void> {
    await request(`/dashboards/${dashId}/widgets/${wid}`, { method: 'DELETE' })
  }

  // ── Alert & Channel API ──

  async function listChannels(): Promise<{ channels: NotificationChannel[] }> {
    return await request('/channels')
  }

  async function createChannel(data: { name: string; channel_type: string; config: Record<string, unknown> }): Promise<NotificationChannel> {
    return await request('/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function updateChannel(id: string, data: { name: string; config: Record<string, unknown>; enabled: boolean }): Promise<NotificationChannel> {
    return await request(`/channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async function deleteChannel(id: string): Promise<void> {
    await request(`/channels/${id}`, { method: 'DELETE' })
  }

  async function testChannel(id: string): Promise<{ ok: boolean; message: string }> {
    return await request(`/channels/${id}/test`, {
      method: 'POST',
    })
  }

  async function notifyChannel(id: string, payload: Record<string, unknown>): Promise<void> {
    await request(`/channels/${id}/notify`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async function listNotificationLog(): Promise<{ entries: NotificationLogEntry[] }> {
    return await request('/notifications/log')
  }

  // Legacy alert-rules API removed — Monitors (listMonitors/…) is the single
  // alerting system. Notification channels live below and are still shared.

  // ── Maintenance Windows ──

  async function listMaintenanceWindows(): Promise<{ windows: MaintenanceWindow[] }> {
    return await request('/maintenance-windows')
  }

  async function createMaintenanceWindow(data: CreateMaintenanceWindowRequest): Promise<{ id: string; ok: boolean }> {
    return await request('/maintenance-windows', { method: 'POST', body: JSON.stringify(data) })
  }

  async function deleteMaintenanceWindow(id: string): Promise<void> {
    await request(`/maintenance-windows/${id}`, { method: 'DELETE' })
  }

  // ── Trace Funnels ──

  async function listFunnels(): Promise<{ funnels: Funnel[] }> {
    return await request('/funnels')
  }

  async function createFunnel(data: { name: string; steps: FunnelStep[] }): Promise<{ id: string; ok: boolean }> {
    return await request('/funnels', { method: 'POST', body: JSON.stringify(data) })
  }

  async function deleteFunnel(id: string): Promise<void> {
    await request(`/funnels/${id}`, { method: 'DELETE' })
  }

  async function runFunnel(id: string, from: string, to: string): Promise<FunnelResult> {
    return await request(`/funnels/${id}/run`, { method: 'POST', body: JSON.stringify({ from, to }) })
  }

  // ── SLO API ──

  async function listSlos(): Promise<{ slos: Slo[] }> {
    return await request('/slos')
  }

  async function createSlo(data: Record<string, unknown>): Promise<Slo> {
    return await request('/slos', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function getSlo(id: string): Promise<{ slo: Slo; events: SloEvent[] }> {
    return await request(`/slos/${id}`)
  }

  async function updateSlo(id: string, data: Record<string, unknown>): Promise<Slo> {
    return await request(`/slos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async function deleteSlo(id: string): Promise<void> {
    await request(`/slos/${id}`, { method: 'DELETE' })
  }

  async function listSloEvents(id: string): Promise<{ events: SloEvent[] }> {
    return await request(`/slos/${id}/events`)
  }

  // ── Service Graph API ──

  async function serviceGraph(minutes?: number): Promise<ServiceGraph> {
    const qs = minutes ? `?minutes=${minutes}` : ''
    return await request(`/services/graph${qs}`)
  }

  async function serviceLatencyHistogram(service: string, minutes?: number): Promise<LatencyHistogram> {
    const qs = new URLSearchParams({ service })
    if (minutes) qs.set('minutes', String(minutes))
    return await request(`/services/latency-histogram?${qs.toString()}`)
  }

  async function serviceEndpoints(service: string, minutes?: number, mode?: string): Promise<EndpointsResponse> {
    const qs = new URLSearchParams({ service })
    if (minutes) qs.set('minutes', String(minutes))
    if (mode) qs.set('mode', mode)
    return await request(`/services/endpoints?${qs.toString()}`)
  }

  async function serviceErrors(service: string, minutes?: number, mode?: string): Promise<ServiceErrorsResponse> {
    const qs = new URLSearchParams({ service })
    if (minutes) qs.set('minutes', String(minutes))
    if (mode) qs.set('mode', mode)
    return await request(`/services/errors?${qs.toString()}`)
  }

  // ── License ──
  async function getLicense(): Promise<LicenseStatus> {
    return await request('/license')
  }

  async function submitExplain(server: string, query: string, db = ''): Promise<{ id: string }> {
    return await request('/integrations/postgres/explain', {
      method: 'POST',
      body: JSON.stringify({ server, db, query }),
    })
  }

  async function getExplainJob(id: string): Promise<{ status: string; db: string; plan_json: string; error: string }> {
    return await request(`/integrations/postgres/explain/${id}`)
  }

  // ── Deploy API ──

  async function listDeploys(params?: { service_name?: string; from?: string; to?: string }): Promise<{ deploys: DeployMarker[] }> {
    const qs = new URLSearchParams()
    if (params?.service_name) qs.set('service_name', params.service_name)
    if (params?.from) qs.set('from', params.from)
    if (params?.to) qs.set('to', params.to)
    const query = qs.toString()
    return await request(`/deploys${query ? '?' + query : ''}`)
  }

  async function createDeploy(data: Record<string, unknown>): Promise<{ id: string }> {
    return await request('/deploys', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ── API Key API ──

  async function listApiKeys(): Promise<{ keys: ApiKey[] }> {
    return await request('/api-keys')
  }

  async function createApiKey(data: { name: string }): Promise<ApiKeyCreated> {
    return await request('/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function deleteApiKey(id: string): Promise<void> {
    await request(`/api-keys/${id}`, { method: 'DELETE' })
  }

  // ── Service Link API ──

  async function listServiceLinks(): Promise<{ links: ServiceLink[] }> {
    return await request('/service-links')
  }

  async function createServiceLink(data: {
    service_name: string
    github_repo: string
    default_branch?: string
    root_path?: string
  }): Promise<ServiceLink> {
    return await request('/service-links', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function deleteServiceLink(serviceName: string): Promise<void> {
    await request(`/service-links/${encodeURIComponent(serviceName)}`, { method: 'DELETE' })
  }

  // ── Log API ──

  async function queryLogs(req: {
    time_range: { from: string; to: string }
    filters: Filter[]
    limit?: number
    offset?: number
    search?: string
    slim?: boolean
  }): Promise<{ rows: LogRecord[]; total: number }> {
    loading.value = true
    error.value = null
    try {
      return await request('/logs', {
        method: 'POST',
        body: JSON.stringify(req),
      })
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function getLogDetail(row: LogRecord): Promise<LogRecord> {
    if (row.TimestampNs === undefined || row.BlockNumber === undefined || row.BlockOffset === undefined || row.BodyHash === undefined) {
      throw new Error('log detail locator is missing')
    }
    return await request('/logs/detail', {
      method: 'POST',
      body: JSON.stringify({
        timestamp_ns: row.TimestampNs,
        block_number: row.BlockNumber,
        block_offset: row.BlockOffset,
        body_hash: row.BodyHash,
        service_name: row.ServiceName,
        severity_text: row.SeverityText,
        trace_id: row.TraceId,
        span_id: row.SpanId,
      }),
    })
  }

  async function groupLogs(req: {
    time_range: { from: string; to: string }
    filters: Filter[]
    group_by: string[]
    limit?: number
    search?: string
  }): Promise<GroupResponse> {
    const raw = await request<{ groups: Array<Record<string, unknown>> }>(`/logs/group`, {
      method: 'POST',
      body: JSON.stringify(req),
    })
    const field = req.group_by?.[0] ?? 'key'
    const groups = (raw.groups ?? []).map((g) => ({
      key: String(g[field] ?? g.key ?? ''),
      count: typeof g.count === 'number' ? g.count : Number(g.count) || 0,
    }))
    return {
      field,
      groups,
      total: groups.reduce((sum, g) => sum + g.count, 0),
    }
  }

  async function getLogHistogram(req: {
    time_range: { from: string; to: string }
    filters?: Filter[]
    search?: string
  }): Promise<{ interval_secs: number; buckets: Array<{ ts: number; count: number }> }> {
    return await request('/logs/histogram', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async function countLogs(req: {
    time_range: { from: string; to: string }
    filters: Filter[]
    interval?: string
    search?: string
  }): Promise<CountBucket[]> {
    loading.value = true
    error.value = null
    try {
      return await request('/logs/count', {
        method: 'POST',
        body: JSON.stringify(req),
      })
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  // ── Stats API ──

  async function getStats(req: {
    time_range?: { from: string; to: string }
  }): Promise<StatsResponse> {
    return await request('/stats', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  /** Durable ingest-buffer depth + backend (admin-only). */
  async function getIngestBuffer(): Promise<{ backend: string; pending_bytes: number; pending_count: number; max_bytes: number; used_pct: number; oldest_age_secs: number; committed_total: number }> {
    return await request('/ingest/buffer')
  }

  /** Per-partition tiered-storage view: local vs object store + move/delete timing (admin-only). */
  async function getStoragePartitions(): Promise<PartitionStorageResponse> {
    return await request('/stats/partitions')
  }

  // ── Usage API ──

  async function getUsage(params?: {
    signal_type?: string
    days?: number
    limit?: number
  }): Promise<UsageResponse> {
    const qs = new URLSearchParams()
    if (params?.signal_type) qs.set('signal_type', params.signal_type)
    if (params?.days) qs.set('days', String(params.days))
    if (params?.limit) qs.set('limit', String(params.limit))
    const query = qs.toString()
    return await request(`/usage${query ? '?' + query : ''}`)
  }

  async function getLabelBreakdown(metric: string): Promise<LabelBreakdownResponse> {
    return await request(`/usage/cardinality/${encodeURIComponent(metric)}`)
  }

  // ── Usage Metering API (per-tenant ingest volume) ──

  async function getUsageMeteringSummary(params?: {
    from?: string
    to?: string
    global?: boolean
  }): Promise<UsageMeteringSummary> {
    const qs = new URLSearchParams()
    if (params?.from) qs.set('from', params.from)
    if (params?.to) qs.set('to', params.to)
    if (params?.global) qs.set('global', 'true')
    const query = qs.toString()
    return await request(`/usage/summary${query ? '?' + query : ''}`)
  }

  async function getUsageMeteringBreakdown(params?: {
    from?: string
    to?: string
    interval?: string
    signal?: string
  }): Promise<UsageMeteringBreakdown> {
    const qs = new URLSearchParams()
    if (params?.from) qs.set('from', params.from)
    if (params?.to) qs.set('to', params.to)
    if (params?.interval) qs.set('interval', params.interval)
    if (params?.signal) qs.set('signal', params.signal)
    const query = qs.toString()
    return await request(`/usage/breakdown${query ? '?' + query : ''}`)
  }

  async function getUsageMeteringTenants(params?: {
    from?: string
    to?: string
    sort_by?: string
    limit?: number
  }): Promise<UsageMeteringTenantsResponse> {
    const qs = new URLSearchParams()
    if (params?.from) qs.set('from', params.from)
    if (params?.to) qs.set('to', params.to)
    if (params?.sort_by) qs.set('sort_by', params.sort_by)
    if (params?.limit) qs.set('limit', String(params.limit))
    const query = qs.toString()
    return await request(`/usage/tenants${query ? '?' + query : ''}`)
  }

  // ── Anomaly Rule API ──

  async function listAnomalyRules(): Promise<{ rules: AnomalyRule[] }> {
    return await request('/anomaly-rules')
  }

  async function createAnomalyRule(data: Record<string, unknown>): Promise<AnomalyRule> {
    return await request('/anomaly-rules', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function getAnomalyRule(id: string): Promise<{ rule: AnomalyRule; events: AnomalyEvent[] }> {
    return await request(`/anomaly-rules/${id}`)
  }

  async function updateAnomalyRule(id: string, data: Record<string, unknown>): Promise<AnomalyRule> {
    return await request(`/anomaly-rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async function deleteAnomalyRule(id: string): Promise<void> {
    await request(`/anomaly-rules/${id}`, { method: 'DELETE' })
  }

  async function listAllAnomalyEvents(): Promise<{ events: AnomalyEventWithRule[] }> {
    return await request('/anomaly-events')
  }

  async function getAnomalyEvent(eventId: string): Promise<AnomalyEvent> {
    return await request(`/anomaly-events/${eventId}`)
  }

  async function getEventCorrelations(eventId: string): Promise<CorrelationResponse> {
    return await request(`/anomaly-events/${eventId}/correlations`)
  }

  async function analyzeAnomalyEvent(eventId: string, additionalContext?: string): Promise<AIAnalysisResponse> {
    return await request(`/anomaly-events/${eventId}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ additional_context: additionalContext || '' }),
    })
  }

  // ── RUM API ──

  async function rumApps(): Promise<{ apps: RumAppEntry[] }> {
    return await request('/rum/apps')
  }

  async function queryRumEvents(req: {
    time_range: { from: string; to: string }
    filters: Filter[]
    limit?: number
    offset?: number
  }): Promise<{ rows: RumRecord[]; total: number }> {
    return await request('/rum/query', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async function rumVitals(req: {
    time_range: { from: string; to: string }
    filters: Filter[]
  }): Promise<{ vitals: RumVitalsSummary[] }> {
    return await request('/rum/vitals', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async function rumPages(req: {
    time_range: { from: string; to: string }
    filters: Filter[]
    limit?: number
  }): Promise<{ pages: RumPageStats[] }> {
    return await request('/rum/pages', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async function rumErrors(req: {
    time_range: { from: string; to: string }
    filters: Filter[]
    limit?: number
  }): Promise<{ errors: RumErrorGroup[] }> {
    return await request('/rum/errors', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async function rumSessions(req: {
    time_range: { from: string; to: string }
    filters: Filter[]
    limit?: number
    offset?: number
  }): Promise<{ sessions: RumSessionSummary[] }> {
    return await request('/rum/sessions', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async function rumSession(id: string): Promise<{ events: RumRecord[] }> {
    return await request(`/rum/session/${encodeURIComponent(id)}`)
  }

  async function rumReplay(sessionId: string): Promise<{ events: unknown[] }> {
    return await request(`/rum/replay/${encodeURIComponent(sessionId)}`)
  }

  async function rumReplayAvailable(appName: string): Promise<string[]> {
    const res = await request<{ session_ids: string[] }>(`/rum/replay/available/${encodeURIComponent(appName)}`)
    return res.session_ids || []
  }

  // ── ArgoCD API ──

  async function getArgoApps(): Promise<ArgoApp[]> {
    const res = await request<{ applications: ArgoApp[] }>('/argocd/applications')
    return res.applications || []
  }

  async function getArgoApp(name: string): Promise<ArgoAppDetail> {
    return await request<ArgoAppDetail>(`/argocd/applications/${encodeURIComponent(name)}`)
  }

  async function getArgoAppSets(): Promise<ArgoAppSet[]> {
    const res = await request<{ applicationsets: ArgoAppSet[] }>('/argocd/applicationsets')
    return res.applicationsets || []
  }

  // ── FluxCD (v2) API ──

  async function getFluxResources(): Promise<FluxResource[]> {
    const res = await request<{ resources: FluxResource[] }>('/fluxcd/resources')
    return res.resources || []
  }

  async function getFluxSources(): Promise<FluxSource[]> {
    const res = await request<{ sources: FluxSource[] }>('/fluxcd/sources')
    return res.sources || []
  }

  async function getFluxResource(kind: string, name: string): Promise<FluxResourceDetail> {
    return await request<FluxResourceDetail>(
      `/fluxcd/resources/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`,
    )
  }

  // ── Kubernetes (read-only) API ──

  async function getK8sSummary(): Promise<K8sSummary> {
    return await request<K8sSummary>('/kubernetes/summary')
  }

  async function getK8sNamespaces(): Promise<K8sResource[]> {
    const res = await request<{ namespaces: K8sResource[] }>('/kubernetes/namespaces')
    return res.namespaces || []
  }

  async function getK8sResources(kind: string, namespace?: string): Promise<K8sResource[]> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    const res = await request<{ resources: K8sResource[] }>(`/kubernetes/resources/${encodeURIComponent(kind)}${qs}`)
    return res.resources || []
  }

  async function getK8sResource(kind: string, namespace: string, name: string): Promise<K8sResourceDetail> {
    const ns = namespace || '_'
    return await request<K8sResourceDetail>(
      `/kubernetes/resources/${encodeURIComponent(kind)}/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`,
    )
  }

  // ── Custom Skills API ──

  async function listCustomSkills(): Promise<CustomSkill[]> {
    const res = await request<{ skills: CustomSkill[] }>('/custom-skills')
    return res.skills || []
  }

  async function getCustomSkill(id: string): Promise<CustomSkill> {
    return await request<CustomSkill>(`/custom-skills/${encodeURIComponent(id)}`)
  }

  async function createCustomSkill(req: CreateCustomSkillRequest): Promise<CustomSkill> {
    return await request<CustomSkill>('/custom-skills', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async function updateCustomSkill(id: string, req: UpdateCustomSkillRequest): Promise<CustomSkill> {
    return await request<CustomSkill>(`/custom-skills/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(req),
    })
  }

  async function deleteCustomSkill(id: string): Promise<void> {
    await request(`/custom-skills/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  // ── Detection API ──

  async function listDetectionRules(): Promise<{ rules: DetectionRule[] }> {
    return await request('/detection/rules')
  }

  async function getDetectionRule(id: string): Promise<DetectionRule> {
    return await request(`/detection/rules/${encodeURIComponent(id)}`)
  }

  async function createDetectionRule(data: Record<string, unknown>): Promise<DetectionRule> {
    return await request('/detection/rules', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function updateDetectionRule(id: string, data: Record<string, unknown>): Promise<DetectionRule> {
    return await request(`/detection/rules/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async function deleteDetectionRule(id: string): Promise<void> {
    await request(`/detection/rules/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async function testDetectionRule(id: string): Promise<{ rows: any[] }> {
    return await request(`/detection/rules/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    })
  }

  async function listDetectionEvents(): Promise<{ events: DetectionEvent[] }> {
    return await request('/detection/events')
  }

  // ── Group API ──

  async function listGroups(): Promise<{ groups: Group[] }> {
    return await request('/groups')
  }

  async function createGroup(data: {
    name: string
    description?: string
    scopes?: string[]
    permissions?: string[]
  }): Promise<Group> {
    return await request('/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function updateGroup(id: string, data: {
    description?: string
    scopes?: string[]
    permissions?: string[]
  }): Promise<Group> {
    return await request(`/groups/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async function deleteGroup(id: string): Promise<void> {
    await request(`/groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async function setGroupTenants(id: string, tenantIds: string[]): Promise<Group> {
    return await request(`/groups/${encodeURIComponent(id)}/tenants`, {
      method: 'PUT',
      body: JSON.stringify({ tenant_ids: tenantIds }),
    })
  }

  async function getUserGroups(userId: string): Promise<{ group_ids: string[] }> {
    return await request(`/users/${encodeURIComponent(userId)}/groups`)
  }

  async function setUserGroups(userId: string, groupIds: string[]): Promise<{ group_ids: string[] }> {
    return await request(`/users/${encodeURIComponent(userId)}/groups`, {
      method: 'PUT',
      body: JSON.stringify({ group_ids: groupIds }),
    })
  }

  // ── Tenant API ──

  async function listTenants(): Promise<{ tenants: Tenant[] }> {
    return await request('/tenants')
  }

  async function createTenant(name: string, opts?: { signals?: Partial<SignalFlags> }): Promise<Tenant> {
    const body: Record<string, unknown> = { name }
    if (opts?.signals) body.signals = opts.signals
    return await request('/tenants', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async function deleteTenant(id: string): Promise<void> {
    await request(`/tenants/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async function toggleTenant(id: string, enabled: boolean): Promise<Tenant> {
    return await request<Tenant>(`/tenants/${encodeURIComponent(id)}/toggle`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
  }

  async function setTenantAuthRequired(id: string, auth_required: boolean): Promise<Tenant> {
    return await request<Tenant>(`/tenants/${encodeURIComponent(id)}/auth`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_required }),
    })
  }

  async function getTenantRetention(tenantId: string): Promise<TenantRetention> {
    return await request<TenantRetention>(`/tenants/${encodeURIComponent(tenantId)}/retention`)
  }

  async function setTenantRetention(tenantId: string, retention: TenantRetention): Promise<TenantRetention> {
    return await request<TenantRetention>(`/tenants/${encodeURIComponent(tenantId)}/retention`, {
      method: 'PUT',
      body: JSON.stringify(retention),
    })
  }

  async function deleteTenantRetention(tenantId: string, signal: string): Promise<void> {
    await request(`/tenants/${encodeURIComponent(tenantId)}/retention/${encodeURIComponent(signal)}`, { method: 'DELETE' })
  }

  async function getTenantSignals(tenantId: string): Promise<TenantSignals> {
    return await request<TenantSignals>(`/tenants/${encodeURIComponent(tenantId)}/signals`)
  }

  async function setTenantSignals(tenantId: string, signals: Partial<SignalFlags>): Promise<TenantSignals> {
    return await request<TenantSignals>(`/tenants/${encodeURIComponent(tenantId)}/signals`, {
      method: 'PUT',
      body: JSON.stringify(signals),
    })
  }

  async function getGlobalRetention(): Promise<GlobalRetention> {
    return await request<GlobalRetention>('/retention/global')
  }

  async function setGlobalRetention(payload: { default_days: number; logs_days: number; metrics_days: number; apm_days: number }): Promise<GlobalRetention> {
    return await request<GlobalRetention>('/retention/global', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  // ── User API ──

  async function listUsers(): Promise<{ users: User[] }> {
    return await request('/users')
  }

  async function createUser(data: {
    username: string
    password: string
    display_name?: string
  }): Promise<User> {
    return await request('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function deleteUser(id: string): Promise<void> {
    await request(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async function changeUserPassword(id: string, password: string): Promise<void> {
    await request(`/users/${encodeURIComponent(id)}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    })
  }

  async function toggleUser(id: string, enabled: boolean): Promise<User> {
    return await request<User>(`/users/${encodeURIComponent(id)}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    })
  }

  // ── Auth API ──

  async function login(username: string, password: string): Promise<{ user: AuthUser; token: string }> {
    return await request<{ user: AuthUser; token: string }>('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  }

  async function logout(): Promise<void> {
    await request('/auth/logout', { method: 'POST' })
  }

  async function getMe(): Promise<AuthUser> {
    const res = await request<{ user: AuthUser }>('/auth/me')
    return res.user
  }

  // ── SSO API ──

  async function getSsoStatus(): Promise<SsoStatus> {
    return await request<SsoStatus>('/sso/status')
  }

  async function listSsoProviders(): Promise<{ providers: SsoProvider[] }> {
    return await request('/sso/providers')
  }

  async function saveSsoProvider(data: Partial<SsoProvider> & { client_secret?: string }): Promise<{ id: string; ok: boolean }> {
    return await request('/sso/providers', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function deleteSsoProvider(id: string): Promise<void> {
    await request(`/sso/providers/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async function listIdpGroupMappings(): Promise<{ mappings: IdpGroupMapping[] }> {
    return await request('/sso/mappings')
  }

  async function createIdpGroupMapping(data: {
    idp_group: string
    rush_group_id: string
    provider_id?: string
  }): Promise<{ id: string; ok: boolean }> {
    return await request('/sso/mappings', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function updateIdpGroupMapping(id: string, data: {
    idp_group: string
    rush_group_id: string
  }): Promise<{ ok: boolean }> {
    return await request(`/sso/mappings/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async function deleteIdpGroupMapping(id: string): Promise<void> {
    await request(`/sso/mappings/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async function createSetupToken(provider?: string, hostname?: string): Promise<SetupToken> {
    return await request<SetupToken>('/sso/setup-token', {
      method: 'POST',
      body: JSON.stringify({ purpose: 'sso_setup', provider: provider || '', hostname: hostname || '' }),
    })
  }

  async function validateSetupToken(token: string): Promise<SetupTokenValidation> {
    return await request<SetupTokenValidation>(`/sso/setup-token/${encodeURIComponent(token)}/validate`)
  }

  async function completeSetupToken(token: string): Promise<void> {
    await request(`/sso/setup-token/${encodeURIComponent(token)}/complete`, {
      method: 'POST',
    })
  }

  // ── Prometheus API ──

  function promHeaders(): Record<string, string> {
    const { activeTenant } = useTenant()
    return { 'X-Rush-Tenant': activeTenant.value }
  }

  async function promQuery(query: string, time?: number): Promise<PromVectorResponse> {
    const params = new URLSearchParams({ query })
    if (time !== undefined) params.set('time', String(time))
    const res = await authenticatedFetch(`/prom/api/v1/query?${params}`, { headers: promHeaders() })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    const json = await res.json()
    return json.data as PromVectorResponse
  }

  async function promQueryRange(
    query: string, start: number, end: number, step: number
  ): Promise<PromMatrixResponse> {
    const params = new URLSearchParams({
      query,
      start: String(start),
      end: String(end),
      step: String(step),
    })
    const res = await authenticatedFetch(`/prom/api/v1/query_range?${params}`, { headers: promHeaders() })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    const json = await res.json()
    return json.data as PromMatrixResponse
  }

  async function promLabels(match?: string): Promise<string[]> {
    const qs = match ? `?match[]=${encodeURIComponent(match)}` : ''
    const res = await authenticatedFetch(`/prom/api/v1/labels${qs}`, { headers: promHeaders() })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    const json = await res.json()
    return json.data as string[]
  }

  async function promLabelValues(label: string, match?: string): Promise<string[]> {
    const qs = match ? `?match[]=${encodeURIComponent(match)}` : ''
    const res = await authenticatedFetch(`/prom/api/v1/label/${encodeURIComponent(label)}/values${qs}`, { headers: promHeaders() })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    const json = await res.json()
    return json.data as string[]
  }

  // ── Investigation Session API (sre-agent) ──

  // request() already prefixes API_BASE (/api/v1) — this must stay EMPTY or
  // requests go out as /api/v1/api/v1/... and 404, making the SRE Agent page
  // report the agent as down. (Vite/nginx route /api/v1/sessions and
  // /api/v1/investigation-templates to the sre-agent service.)
  const SRE_AGENT_BASE = ''

  async function listInvestigationSessions(tenantId?: string, limit?: number): Promise<{ sessions: InvestigationSession[] }> {
    const qs = new URLSearchParams()
    if (tenantId) qs.set('tenant_id', tenantId)
    if (limit) qs.set('limit', String(limit))
    const query = qs.toString()
    return await request(`${SRE_AGENT_BASE}/sessions${query ? '?' + query : ''}`)
  }

  async function getInvestigationSession(id: string): Promise<{ session: InvestigationSession; turns: InvestigationTurn[] }> {
    return await request(`${SRE_AGENT_BASE}/sessions/${encodeURIComponent(id)}`)
  }

  async function deleteInvestigationSession(id: string): Promise<void> {
    await request(`${SRE_AGENT_BASE}/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async function listInvestigationTemplates(): Promise<{ templates: InvestigationTemplate[] }> {
    return await request(`${SRE_AGENT_BASE}/investigation-templates`)
  }

  // ── BubbleUp API ──

  async function bubbleUp(data: BubbleUpRequest): Promise<BubbleUpResponse> {
    return await request('/bubbleup', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ── Monitor API ──

  async function listMonitors(): Promise<{ monitors: Monitor[] }> {
    return await request('/monitors')
  }

  async function getMonitor(id: string): Promise<{ monitor: Monitor; events: MonitorEvent[] }> {
    return await request(`/monitors/${id}`)
  }

  async function createMonitor(data: Record<string, unknown>): Promise<Monitor> {
    return await request('/monitors', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function updateMonitor(id: string, data: Record<string, unknown>): Promise<Monitor> {
    return await request(`/monitors/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async function deleteMonitor(id: string): Promise<void> {
    await request(`/monitors/${id}`, { method: 'DELETE' })
  }

  async function listMonitorEvents(id: string): Promise<{ events: MonitorEvent[] }> {
    return await request(`/monitors/${id}/events`)
  }

  async function previewMonitor(config: Record<string, unknown>): Promise<MonitorPreview> {
    const { type, eval_window_secs, ...queryFields } = config
    return await request('/monitors/preview', {
      method: 'POST',
      body: JSON.stringify({
        type,
        query_config: queryFields,
        eval_window_secs: eval_window_secs || 300,
        group_by: (queryFields as Record<string, unknown>).group_by || [],
      }),
    })
  }

  async function muteMonitor(id: string): Promise<void> {
    await request(`/monitors/${id}/mute`, { method: 'POST' })
  }

  async function unmuteMonitor(id: string): Promise<void> {
    await request(`/monitors/${id}/unmute`, { method: 'POST' })
  }

  async function monitorAutocomplete(params: {
    type: string
    prefix?: string
    metric?: string
  }): Promise<{ suggestions: string[] }> {
    const q = new URLSearchParams({ type: params.type })
    if (params.prefix) q.set('prefix', params.prefix)
    if (params.metric) q.set('metric', params.metric)
    return await request(`/monitors/autocomplete?${q.toString()}`)
  }

  async function monitorSuggest(data: Record<string, unknown>): Promise<{ suggestions: { text: string; severity: string }[] }> {
    return await request('/monitors/suggest', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ── Feature flags / app settings ──

  async function getFeatures(): Promise<{ argocd: boolean; sre_agent: boolean; export_max_rows: number; deploy_markers: boolean; rum: boolean }> {
    return await request('/features')
  }

  async function getDeployMarkersSetting(): Promise<{ enabled: boolean }> {
    return await request('/settings/deploy-markers')
  }

  async function setDeployMarkersEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
    return await request('/settings/deploy-markers', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    })
  }

  async function getRumSetting(): Promise<{ enabled: boolean }> {
    return await request('/settings/rum')
  }

  async function setRumEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
    return await request('/settings/rum', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    })
  }

  async function getCloudwatchSetting(): Promise<{ enabled: boolean; default_tenant: string }> {
    return await request('/settings/cloudwatch')
  }

  async function setCloudwatchSetting(enabled: boolean, defaultTenant?: string): Promise<{ enabled: boolean; default_tenant: string }> {
    return await request('/settings/cloudwatch', {
      method: 'PUT',
      body: JSON.stringify(defaultTenant === undefined ? { enabled } : { enabled, default_tenant: defaultTenant }),
    })
  }

  async function setExportMaxRows(value: number): Promise<{ export_max_rows: number }> {
    return await request('/settings/export-max-rows', {
      method: 'PUT',
      body: JSON.stringify({ value }),
    })
  }

  // ── SRE agent investigation budget (admin) ──

  async function getSreAgentSettings(): Promise<{ enabled: boolean; tenant_mode: 'all' | 'selected'; allowed_tenants: string[]; model: string; allowed_models: Array<{ id: string; reasoning: string[] }>; model_suggestions: string[]; reasoning_effort: string; reasoning_levels: string[]; model_is_reasoning: boolean; max_tool_steps: number; max_llm_calls: number; defaults: { max_tool_steps: number; max_llm_calls: number } }> {
    return await request('/settings/sre-agent')
  }

  async function setSreAgentSettings(maxToolSteps: number, maxLlmCalls: number, model?: string, reasoningEffort?: string, allowedModels?: Array<{ id: string; reasoning: string[] }>): Promise<{ max_tool_steps: number; max_llm_calls: number }> {
    const body: Record<string, unknown> = { max_tool_steps: maxToolSteps, max_llm_calls: maxLlmCalls }
    if (model !== undefined) body.model = model
    if (reasoningEffort !== undefined) body.reasoning_effort = reasoningEffort
    if (allowedModels !== undefined) body.allowed_models = allowedModels
    return await request('/settings/sre-agent', {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }

  // Pull the live model list from the configured LLM provider (falls back to suggestions).
  async function getSreAgentModels(): Promise<{ models: string[]; source: string }> {
    return await request('/settings/sre-agent/models')
  }

  // User-facing model/thinking menu: the admin-defined policy. Any authenticated
  // user can read it to populate the investigation pickers (not admin-only).
  async function getSreAgentOptions(): Promise<{ models: Array<{ id: string; reasoning: string[] }>; default_model: string }> {
    return await request('/sre-agent/options')
  }

  async function setSreAgentEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
    return await request('/settings/sre-agent', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    })
  }

  async function setSreAgentTenantAccess(tenantMode: 'all' | 'selected', allowedTenants: string[]): Promise<{ ok: boolean; tenant_mode: 'all' | 'selected'; allowed_tenants: string[] }> {
    return await request('/settings/sre-agent', {
      method: 'PUT',
      body: JSON.stringify({ tenant_mode: tenantMode, allowed_tenants: allowedTenants }),
    })
  }

  // ── Metric Firewall API ──

  async function listMetricFirewall(): Promise<{ rules: MetricFirewallRule[] }> {
    return await request('/metric-firewall')
  }

  async function createMetricFirewall(input: MetricFirewallInput): Promise<MetricFirewallRule> {
    return await request('/metric-firewall', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async function updateMetricFirewall(id: string, input: MetricFirewallInput): Promise<MetricFirewallRule> {
    return await request(`/metric-firewall/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }

  async function deleteMetricFirewall(id: string): Promise<void> {
    await request(`/metric-firewall/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  // ── Explore export (CSV/JSON file download) ──

  async function exportExplore(opts: {
    signal: 'logs' | 'spans'
    time_range: { from: string; to: string }
    filters: Filter[]
    limit: number
    search?: string
    format: 'csv' | 'json'
    query_text?: string
  }): Promise<{ blob: Blob; filename: string }> {
    const { activeTenant } = useTenant()
    const path = opts.signal === 'logs' ? '/logs/export' : '/query/export'
    const res = await authenticatedFetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Rush-Tenant': activeTenant.value },
      body: JSON.stringify({
        time_range: opts.time_range,
        filters: opts.filters,
        limit: opts.limit,
        search: opts.search,
        format: opts.format,
        query_text: opts.query_text,
      }),
    })
    if (!res.ok) {
      let msg = `Export failed (${res.status})`
      try { const j = JSON.parse(await res.text()); if (typeof j.message === 'string') msg = j.message } catch { /* noop */ }
      throw new Error(msg)
    }
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') || ''
    const m = cd.match(/filename="?([^"]+)"?/)
    const filename = m ? m[1]! : `rush-${opts.signal}.${opts.format}`
    return { blob, filename }
  }

  // ── Audit log API (admin-only, tamper-evident) ──

  async function getAuditEvents(params?: AuditQueryParams): Promise<AuditListResponse> {
    const qs = new URLSearchParams()
    if (params?.from) qs.set('from', params.from)
    if (params?.to) qs.set('to', params.to)
    if (params?.actor) qs.set('actor', params.actor)
    if (params?.action) qs.set('action', params.action)
    if (params?.resource_type) qs.set('resource_type', params.resource_type)
    if (params?.outcome) qs.set('outcome', params.outcome)
    if (params?.tenant_id) qs.set('tenant_id', params.tenant_id)
    if (params?.q) qs.set('q', params.q)
    if (params?.limit != null) qs.set('limit', String(params.limit))
    if (params?.offset != null) qs.set('offset', String(params.offset))
    const query = qs.toString()
    return await request(`/audit${query ? '?' + query : ''}`)
  }

  async function verifyAuditChain(): Promise<AuditVerifyResponse> {
    return await request('/audit/verify')
  }

  return {
    loading, error,
    login, logout, getMe,
    getAuditEvents, verifyAuditChain,
    getTrace, queryEvents, queryCount, queryTimeseries, openInvestigationStream, getServices, serviceGraph, serviceLatencyHistogram, serviceEndpoints, serviceErrors, getLicense, submitExplain, getExplainJob, suggestValues, queryGroup,
    queryLogs, getLogDetail, countLogs, groupLogs, getLogHistogram,
    listDashboards, getDashboard, createDashboard, updateDashboard, deleteDashboard,
    exportDashboard, importDashboard, listDashboardTemplates, createFromTemplate,
    createWidget, updateWidget, deleteWidget,
    listChannels, createChannel, updateChannel, deleteChannel, testChannel, notifyChannel, listNotificationLog,
    listMaintenanceWindows, createMaintenanceWindow, deleteMaintenanceWindow,
    listFunnels, createFunnel, deleteFunnel, runFunnel,
    listSlos, createSlo, getSlo, updateSlo, deleteSlo, listSloEvents,
    listAnomalyRules, createAnomalyRule, getAnomalyRule, updateAnomalyRule, deleteAnomalyRule, listAllAnomalyEvents, getAnomalyEvent, getEventCorrelations, analyzeAnomalyEvent,
    listDeploys, createDeploy,
    listApiKeys, createApiKey, deleteApiKey,
    listServiceLinks, createServiceLink, deleteServiceLink,
    getStats,
    getStoragePartitions,
    getIngestBuffer,
    getUsage, getLabelBreakdown,
    getUsageMeteringSummary, getUsageMeteringBreakdown, getUsageMeteringTenants,
    rumApps, queryRumEvents, rumVitals, rumPages, rumErrors, rumSessions, rumSession, rumReplay, rumReplayAvailable,
    promQuery, promQueryRange, promLabels, promLabelValues,
    getArgoApps, getArgoApp, getArgoAppSets,
    getFluxResources, getFluxSources, getFluxResource,
    getK8sSummary, getK8sNamespaces, getK8sResources, getK8sResource,
    listCustomSkills, getCustomSkill, createCustomSkill, updateCustomSkill, deleteCustomSkill,
    listDetectionRules, getDetectionRule, createDetectionRule, updateDetectionRule, deleteDetectionRule, testDetectionRule, listDetectionEvents,
    getSsoStatus, listSsoProviders, saveSsoProvider, deleteSsoProvider, listIdpGroupMappings, createIdpGroupMapping, updateIdpGroupMapping, deleteIdpGroupMapping, createSetupToken, validateSetupToken, completeSetupToken,
    listGroups, createGroup, updateGroup, deleteGroup, setGroupTenants, getUserGroups, setUserGroups,
    listTenants, createTenant, deleteTenant, toggleTenant, setTenantAuthRequired, getTenantRetention, setTenantRetention, deleteTenantRetention, getTenantSignals, setTenantSignals, getGlobalRetention, setGlobalRetention,
    listUsers, createUser, deleteUser, changeUserPassword, toggleUser,
    listInvestigationSessions, getInvestigationSession, deleteInvestigationSession, listInvestigationTemplates,
    bubbleUp,
    listMonitors, getMonitor, createMonitor, updateMonitor, deleteMonitor, listMonitorEvents, previewMonitor, muteMonitor, unmuteMonitor, monitorAutocomplete, monitorSuggest,
    getFeatures, setExportMaxRows, getSreAgentSettings, setSreAgentSettings, getSreAgentModels, getSreAgentOptions, setSreAgentEnabled, setSreAgentTenantAccess, getDeployMarkersSetting, setDeployMarkersEnabled, getRumSetting, setRumEnabled, getCloudwatchSetting, setCloudwatchSetting, exportExplore,
    listMetricFirewall, createMetricFirewall, updateMetricFirewall, deleteMetricFirewall,
  }
}
