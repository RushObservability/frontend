// ── Auth types ──

export interface AuthUser {
  id: string
  username: string
  display_name: string
  tenant_id: string
  role: string
}

export interface RushEvent {
  timestamp: number
  trace_id: string
  span_id: string
  parent_span_id: string
  service_name: string
  service_version: string
  environment: string
  host_name: string
  http_method: string
  http_path: string
  http_status_code: number
  duration_ns: number
  status: string
  attributes: string
  event_timestamps: number[]
  event_names: string[]
  event_attributes: string[]
  link_trace_ids: string[]
  link_span_ids: string[]
}

export interface SpanNode {
  span_id: string
  parent_span_id: string
  service_name: string
  service_version: string
  http_method: string
  http_path: string
  http_status_code: number
  duration_ns: number
  status: string
  timestamp: string
  attributes: Record<string, unknown>
  events: SpanEvent[]
  children: SpanNode[]
}

export interface SpanEvent {
  timestamp: string
  name: string
  attributes: Record<string, unknown>
}

export interface TraceResponse {
  trace_id: string
  spans: SpanNode[]
  span_count: number
  duration_ns: number
  services: string[]
}

export interface Filter {
  field: string
  op: string
  value: string | number | boolean
}

export interface QueryRequest {
  time_range: { from: string; to: string }
  filters: Filter[]
  group_by?: string[]
  aggregation?: string
  limit?: number
  offset?: number
  search?: string
  /**
   * Optional keyset-pagination cursor (opaque token from a prior response's
   * `next_cursor`). When set, the backend pages via a (timestamp, span_id) predicate
   * instead of OFFSET. Additive: omitting it preserves the existing offset behavior.
   * The Explore UI currently leaves this unset (stays on offset paging).
   */
  cursor?: string
  /**
   * Optional column projection. `'list'` returns only the ~10 columns the Explore
   * table renders (slim rows, lower bandwidth). Omitting it returns the full wide row
   * (with attributes/events/links) exactly as before — required by the Explore list's
   * span-event derivation and detail panel, so the UI leaves this unset.
   */
  columns?: 'list'
}

export interface CountBucket {
  bucket: string
  count: number
  error_count: number
}

export interface ServiceEntry {
  service_name: string
  http_path: string
  http_method: string
  last_seen: string
  request_count: number
}

export interface GroupResult {
  key: string
  count: number
}

export interface GroupResponse {
  field: string
  groups: GroupResult[]
  total: number
}

export interface QueryFilter {
  id: string
  field: string
  op: string
  value: string
}

export interface SavedQuery {
  id: string
  name: string
  filters: QueryFilter[]
  groupBy: string
  timePreset: number
  createdAt: number
}

// ── Log types ──

export interface LogRecord {
  Timestamp: number
  TraceId: string
  SpanId: string
  SeverityText: string
  SeverityNumber: number
  ServiceName: string
  Body: string
  ResourceAttributes: Record<string, string>
  ScopeName: string
  LogAttributes: Record<string, string>
  TimestampNs?: string
  BlockNumber?: string
  BlockOffset?: string
  BodyHash?: string
}

// ── Stats types ──

export interface SignalStats {
  total_events: number
  events_per_sec: number
  events_today: number
}

export interface MetricStats {
  total_datapoints: number
  datapoints_per_sec: number
  datapoints_today: number
  unique_series: number
}

export interface TableStorage {
  table_name: string
  total_rows: number
  bytes_on_disk: number
  compressed_bytes: number
  uncompressed_bytes: number
  bytes_local: number
  bytes_object_store: number
}

export interface StatsResponse {
  spans: SignalStats
  logs: SignalStats
  metrics: MetricStats
  storage: TableStorage[]
  object_store_enabled: boolean
  usage?: StatsUsage
}

// ── Per-partition tiered storage (Settings → Storage tiers) ──
export interface PartitionStorage {
  table: string
  signal: string            // logs | traces | metrics | other
  partition: string
  rows: number
  bytes_total: number
  bytes_local: number
  bytes_object_store: number
  tier: 'local' | 'cold' | 'mixed'
  move_after_days: number
  retention_days: number
  delete_at?: number        // epoch seconds (ground truth)
  move_at_estimate?: number // epoch seconds (estimate)
}

export interface PartitionStorageResponse {
  object_store_enabled: boolean
  now: number               // server epoch seconds
  partitions: PartitionStorage[]
}

// ── Prometheus types ──

export interface PromMetric { [key: string]: string }
export interface PromVectorResult { metric: PromMetric; value: [number, string] }
export interface PromMatrixResult { metric: PromMetric; values: [number, string][] }
export interface PromVectorResponse { resultType: 'vector'; result: PromVectorResult[] }
export interface PromMatrixResponse { resultType: 'matrix'; result: PromMatrixResult[] }

// ── Dashboard types ──

export type WidgetType = 'timeseries' | 'bar' | 'table' | 'counter'

export interface WidgetPosition {
  col: number
  row: number
  col_span: number
  row_span: number
}

/** One independently executable query inside a dashboard panel. */
export interface WidgetPanelQuery {
  /** Stable Grafana-style reference used in the editor and future expressions (A, B, C...). */
  ref_id: string
  source: 'spans' | 'metrics' | 'logs'
  /** Human-friendly legend label. Empty falls back to the query/series name. */
  alias?: string
  /** Optional series color; charts fall back to the shared palette. */
  color?: string
  /** Y-axis used by this query's series in time-series panels. */
  axis?: 'left' | 'right'
  /** Hidden queries remain configured but are not executed or rendered. */
  hidden?: boolean
  filters: Filter[]
  group_by?: string[]
  aggregation?: string
  interval?: string
  limit?: number
  promql?: string
}

export interface WidgetQueryConfig {
  time_range_minutes: number
  /** Multi-query panels. When absent, legacy top-level fields below remain supported. */
  queries?: WidgetPanelQuery[]
  filters: Filter[]
  group_by?: string[]
  aggregation?: string
  interval?: string
  limit?: number
  promql?: string
  /** Query backend: 'spans' (default) = span query API; 'metrics' = PromQL; 'logs' = logs API. */
  source?: 'spans' | 'metrics' | 'logs'
}

// ── Dashboard template variables (Grafana-style) ──
export type DashboardVariableType = 'query' | 'static' | 'textbox'

export interface DashboardVariable {
  /** Token name used in queries as $name / ${name}. */
  name: string
  /** Optional human label for the dropdown; defaults to name. */
  label?: string
  type: DashboardVariableType
  /** For type 'query': the span field whose distinct values populate the dropdown (e.g. service_name). */
  field?: string
  /** For type 'static': the selectable values. */
  options?: string[]
  /** Initial selected value. */
  default?: string
  /** Add an "All" option (drops the filter / expands to .* in PromQL). */
  include_all?: boolean
}

/** Sentinel stored in the selected-values map when a variable's "All" option is chosen. */
export const VAR_ALL = '$__all'

export interface Widget {
  id: string
  dashboard_id: string
  title: string
  widget_type: WidgetType
  query_config: WidgetQueryConfig
  position: WidgetPosition
  display_config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Dashboard {
  id: string
  name: string
  description: string
  tenant_id: string
  owner_id: string
  visibility: 'private' | 'tenant' | 'global'
  tags: string[]
  variables: DashboardVariable[]
  created_at: string
  updated_at: string
}

export interface DashboardWithWidgets extends Dashboard {
  widgets: Widget[]
}

export interface DashboardTemplate {
  id: string
  name: string
  description: string
  category: string
  is_builtin: boolean
  template_json: Record<string, unknown>
  tags: string[]
  created_at: string
}

export interface DashboardExport {
  format_version: string
  exported_at: string
  dashboard: {
    name: string
    description: string
    visibility: string
    tags: string[]
  }
  widgets: Array<{
    title: string
    widget_type: string
    query_config: Record<string, unknown>
    position: Record<string, unknown>
    display_config: Record<string, unknown>
  }>
}

export interface WidgetData {
  type: WidgetType
  buckets?: CountBucket[]
  groups?: Array<{ key: string; count: number }>
  rows?: Record<string, unknown>[]
  count?: number
  /** Multi-series timeseries (PromQL/metrics source): each series is a label + [unixSec, value] points. */
  series?: Array<{ name: string; points: [number, number][]; color?: string; ref_id?: string; axis?: 'left' | 'right' }>
  /** Individual query failures when at least one sibling query still returned data. */
  query_errors?: Array<{ ref_id: string; message: string }>
}

// ── Alert types ──

export type ChannelType = 'slack' | 'slack_app' | 'email' | 'webhook' | 'pagerduty' | 'opsgenie' | 'discord' | 'alertmanager'

export interface NotificationChannel {
  id: string
  tenant_id: string
  name: string
  channel_type: ChannelType
  config: Record<string, any>
  enabled: boolean
  created_at: string
}

export interface NotificationLogEntry {
  id: string
  channel_id: string
  tenant_id: string
  alert_type: string
  alert_name: string
  severity: string
  status: string
  error: string
  created_at: string
}

// Legacy alert-rules types removed — Monitors (see Monitor) is the single
// alerting system. Notification-channel types remain (shared infrastructure).

// ── SLO types ──

export type SloWindowType = 'rolling_1h' | 'rolling_24h' | 'rolling_7d' | 'rolling_30d'
export type SloState = 'compliant' | 'breaching' | 'no_data'
export type SloType = 'trace' | 'metric'
export type SloIndicatorType = 'availability' | 'latency' | 'threshold'
export type SloThresholdOp = 'lt' | 'lte' | 'gt' | 'gte'

export interface Slo {
  id: string
  name: string
  description: string
  enabled: boolean
  slo_type: SloType
  indicator_type: SloIndicatorType
  service_name: string
  metric_name: string
  window_type: SloWindowType
  target_percentage: number
  threshold_ms: number | null
  threshold_value: number | null
  threshold_op: SloThresholdOp | null
  error_filters: Filter[]
  total_filters: Filter[]
  eval_interval_secs: number
  notification_channel_ids: string[]
  state: SloState
  error_budget_remaining: number | null
  error_count: number | null
  total_count: number | null
  last_eval_at: string | null
  last_breached_at: string | null
  created_at: string
  updated_at: string
}

export interface SloEvent {
  id: string
  slo_id: string
  state: string
  error_count: number
  total_count: number
  error_budget_remaining: number
  message: string
  created_at: string
}

// ── Service Graph types ──

export interface GraphNode {
  service_name: string
  request_count: number
  error_count: number
  avg_duration_ms: number
  p50_ms: number
  p95_ms: number
  p99_ms: number
}

export interface GraphEdge {
  source: string
  target: string
  request_count: number
  error_count: number
  avg_duration_ms: number
}

export interface ServiceGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// Latency distribution for a single service. `exp` is a log2(ms) bucket
// exponent: the bucket covers [2^exp, 2^(exp+1)) ms.
export interface LatencyHistBucket {
  exp: number
  count: number
}

export interface LatencyHistogram {
  buckets: LatencyHistBucket[]
  p50_ms: number
  p95_ms: number
  p99_ms: number
  total: number
}

// Per-endpoint (or per-operation) RED metrics for a service.
export interface EndpointRow {
  endpoint: string   // "GET /articles/:id" (server) or "db.select" (operation)
  method: string     // "GET" | "" (operations have no method)
  path: string       // "/articles/:id" | ""
  req: number
  errors: number
  p50_ms: number
  p95_ms: number
  p99_ms: number
}

export interface EndpointsResponse {
  endpoints: EndpointRow[]
  mode: string       // "server" | "operation"
}

// One grouped error: an errored endpoint (status×method×path) or a normalized
// log-message template, depending on mode.
export interface ErrorGroup {
  key: string          // "503 POST /articles" or the message template
  status_code: number  // endpoint mode; 0 for message mode
  method: string
  path: string
  severity: string     // message mode ("ERROR"|"WARN"|"FATAL")
  example: string      // message mode: a representative raw line
  count: number
  last_seen: string
}

export interface ServiceErrorsResponse {
  groups: ErrorGroup[]
  mode: string         // "endpoint" | "message"
}

// License status (from /api/v1/license, verified server-side against the
// embedded public key over the RUSH_LICENSE_KEY env/secret).
export interface LicenseStatus {
  valid: boolean
  status: 'active' | 'expired' | 'invalid' | 'unlicensed'
  customer: string | null
  plan: string
  entitlements: string[]
  expires_at: string | null
  reason: string | null
}

// ── APM / Timeseries types ──

export interface TimeseriesBucket {
  bucket: string
  count: number
  error_count: number
  avg_duration_ms: number
  p50_ms: number
  p95_ms: number
  p99_ms: number
}

export interface GroupedTimeseriesBucket extends TimeseriesBucket {
  group_key: string
}

export interface TimeseriesResponse {
  buckets: TimeseriesBucket[] | GroupedTimeseriesBucket[]
  grouped: boolean
}

// ── Deploy types ──

export interface DeployMarker {
  id: string
  service_name: string
  version: string
  commit_sha: string
  description: string
  environment: string
  deployed_by: string
  deployed_at: string
}

// ── API Key types ──

export interface ApiKey {
  id: string
  name: string
  prefix: string
  created_at: string
}

export interface ApiKeyCreated extends ApiKey {
  key: string
}

// ── Service Link types ──

export interface ServiceLink {
  tenant_id: string
  service_name: string
  github_repo: string
  github_installation_id: number
  github_repository_id: number
  default_branch: string
  root_path: string
  updated_at: string
}

// ── Usage tracking types ──

export interface UsageEntry {
  signal_name: string
  signal_type: string
  source: string
  last_queried_at: string
  query_count: number
}

export interface UnusedMetric {
  metric_name: string
}

export interface CardinalityEntry {
  metric_name: string
  series_count: number
  label_count: number
}

export interface LabelCardinality {
  label_key: string
  unique_values: number
}

export interface LabelBreakdownResponse {
  metric_name: string
  labels: LabelCardinality[]
  total_series: number
}

export interface UsageResponse {
  usage: UsageEntry[]
  total: number
  unused: UnusedMetric[]
  cardinality: CardinalityEntry[]
}

// ── Usage metering types (per-tenant ingest volume) ──

export interface UsageMeteringSignalCounts {
  events_count: number
  bytes_count: number
}

export interface UsageMeteringSummary {
  tenant_id: string
  from: string
  to: string
  signals: Record<string, UsageMeteringSignalCounts>
  totals: UsageMeteringSignalCounts
}

export interface UsageMeteringBreakdownBucket {
  timestamp: string
  signals: Record<string, UsageMeteringSignalCounts>
}

export interface UsageMeteringBreakdown {
  tenant_id: string
  interval: string
  buckets: UsageMeteringBreakdownBucket[]
}

export interface UsageMeteringTenantEntry {
  tenant_id: string
  events_count: number
  bytes_count: number
  signals: Record<string, UsageMeteringSignalCounts>
}

export interface UsageMeteringTenantsResponse {
  tenants: UsageMeteringTenantEntry[]
}

export interface StatsUsageSignal {
  events_count: number
  bytes_count: number
}

export interface StatsUsage {
  traces: StatsUsageSignal
  logs: StatsUsageSignal
  metrics: StatsUsageSignal
  rum: StatsUsageSignal
}

// ── Anomaly types ──

export type AnomalyState = 'normal' | 'anomalous' | 'no_data'

export interface AnomalyRule {
  id: string
  name: string
  description: string
  enabled: boolean
  source: 'prometheus' | 'apm'
  pattern: string
  query: string
  service_name: string
  apm_metric: string
  sensitivity: number
  alpha: number
  eval_interval_secs: number
  window_secs: number
  split_labels: string[]
  notification_channel_ids: string[]
  state: AnomalyState
  last_eval_at: string | null
  last_triggered_at: string | null
  created_at: string
  updated_at: string
}

export interface AnomalyEvent {
  id: string
  rule_id: string
  state: string
  metric: string
  value: number
  expected: number
  deviation: number
  message: string
  created_at: string
}

export interface AnomalyEventWithRule extends AnomalyEvent {
  rule_name: string
}

// ── AI Analysis types ──

export interface AIAnalysisResponse {
  analysis: string
  model: string
}

// ── Investigation Session types ──

export interface InvestigationSession {
  id: string
  tenant_id: string
  title: string
  status: string
  template_id: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface InvestigationTurn {
  id: string
  session_id: string
  turn_index: number
  role: string
  content: string
  tool_calls: string
  report_kind: string
  created_at: string
}

export interface InvestigationTemplate {
  id: string
  name: string
  description: string
  prompt_modifier: string
  auto_tools: string[]
}

// ── Tenant types ──

export interface SignalFlags {
  logs: boolean
  apm: boolean
  metrics: boolean
  rum: boolean
}

export interface SignalDropped {
  logs: number
  apm: number
  metrics: number
  rum: number
}

export interface TenantSignals {
  signals: SignalFlags
  dropped: SignalDropped
}

export interface Tenant {
  id: string
  name: string
  enabled: boolean
  auth_required: boolean
  created_at: string
  signals?: SignalFlags
}

export interface TenantRetention {
  metrics_days?: number
  traces_days?: number
  logs_days?: number
}

export interface GlobalRetention {
  default_days: number
  logs_days: number
  metrics_days: number
  apm_days: number
  effective_logs: number
  effective_metrics: number
  effective_apm: number
}

// ── Group types ──

export interface Group {
  id: string
  name: string
  description: string
  scopes: string[]
  permissions: string[]
  system: boolean
  tenant_ids: string[]
  created_at: string
}

// ── User types ──

export interface User {
  id: string
  username: string
  display_name: string
  tenant_id: string
  enabled: boolean
  created_at: string
}

// ── Custom Skills types ──

export interface CustomSkill {
  id: string
  name: string
  title: string
  description: string
  content: string
  allowed_tools: string[]
  enabled: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface CreateCustomSkillRequest {
  name: string
  title: string
  description: string
  content: string
  allowed_tools?: string[]
  enabled?: boolean
}

export interface UpdateCustomSkillRequest {
  title: string
  description: string
  content: string
  allowed_tools?: string[]
  enabled?: boolean
}

// ── Correlation types ──

export interface CorrelatedService {
  name: string
  total: number
  buckets: { timestamp: string; count: number }[]
}

export interface CorrelationLog {
  timestamp: string
  service_name: string
  severity_text: string
  body: string
  trace_id: string
}

export interface CorrelationResponse {
  status_code: number
  window_from: string
  window_to: string
  services: CorrelatedService[]
  logs: CorrelationLog[]
}

// ── RUM types ──

export interface RumRecord {
  Timestamp: number
  AppName: string
  AppVersion: string
  Environment: string
  SessionId: string
  UserId: string
  PageUrl: string
  PagePath: string
  ViewName: string
  Referrer: string
  BrowserName: string
  BrowserVersion: string
  OsName: string
  OsVersion: string
  DeviceType: string
  ScreenWidth: number
  ScreenHeight: number
  EventType: string
  EventName: string
  VitalName: string
  VitalValue: number
  VitalRating: string
  ErrorMessage: string
  ErrorStack: string
  ErrorType: string
  InteractionTarget: string
  InteractionType: string
  DurationMs: number
  TraceId: string
  SpanId: string
  Attributes: string
}

export interface RumVitalsSummary {
  VitalName: string
  p75: number
  good_pct: number
  needs_improvement_pct: number
  poor_pct: number
}

export interface RumPageStats {
  PagePath: string
  views: number
  unique_sessions: number
  avg_load_ms: number
  error_count: number
}

export interface RumErrorGroup {
  ErrorMessage: string
  ErrorType: string
  count: number
  affected_sessions: number
  last_seen: string
  sample_stack: string
}

export interface RumSessionSummary {
  SessionId: string
  UserId: string
  browser: string
  page_count: number
  error_count: number
  duration_s: number
  first_seen: string
}

export interface RumAppEntry {
  AppName: string
  cnt: number
}

// ── ArgoCD types ──

export interface ArgoApp {
  name: string
  project: string
  health_status: string
  health_message: string
  sync_status: string
  sync_revision: string
  repo: string
  path: string
  dest_namespace: string
  dest_server: string
  last_synced_at: string
  conditions_count: number
  images: string[]
}

export interface ArgoCondition {
  type: string
  message: string
  last_transition_time: string
}

export interface ArgoResource {
  group: string
  kind: string
  name: string
  namespace: string
  health_status: string
  health_message: string
  sync_status: string
}

export interface ArgoHistoryEntry {
  revision: string
  deployed_at: string
  source_repo: string
  source_path: string
}

export interface ArgoAppDetail {
  name: string
  project: string
  health_status: string
  health_message: string
  sync_status: string
  sync_revision: string
  repo: string
  path: string
  chart: string
  target_revision: string
  dest_namespace: string
  dest_server: string
  last_synced_at: string
  conditions: ArgoCondition[]
  unhealthy_resources: ArgoResource[]
  history: ArgoHistoryEntry[]
  images: string[]
  operation_phase: string
  operation_message: string
}

export interface ArgoAppSet {
  name: string
  generators: string[]
  health_status: string
  conditions_count: number
  app_count: number
}

// ── FluxCD (v2) types ──
export interface FluxResource {
  kind: string // "Kustomization" | "HelmRelease"
  name: string
  namespace: string
  ready: string // "True" | "False" | "Unknown"
  message: string
  suspended: boolean
  reconciling: boolean
  source: string // sourceRef "Kind/name"
  revision: string
  last_reconciled_at: string
}

export interface FluxSource {
  kind: string // "GitRepository" | "OCIRepository" | "HelmRepository" | "Bucket"
  name: string
  namespace: string
  ready: string
  message: string
  suspended: boolean
  url: string
  revision: string
  last_reconciled_at: string
}

export interface FluxCondition {
  type: string
  status: string
  reason: string
  message: string
  last_transition_time: string
}

export interface FluxResourceDetail {
  kind: string
  name: string
  namespace: string
  ready: string
  ready_reason: string
  message: string
  suspended: boolean
  reconciling: boolean
  source: string
  path: string
  last_applied_revision: string
  last_attempted_revision: string
  last_reconciled_at: string
  interval: string
  chart: string
  chart_version: string
  depends_on: string[]
  conditions: FluxCondition[]
}

// ── Kubernetes (read-only) types ──
export interface K8sSummary {
  nodes_ready: number
  nodes_total: number
  pods_running: number
  pods_total: number
  pods_unhealthy: number
  namespaces: number
  warnings: number
}

export interface K8sResource {
  kind: string
  name: string
  namespace: string
  creation_ts: string
  unhealthy: boolean
  cols: Record<string, string>
}

export interface K8sCondition {
  type: string
  status: string
  reason: string
  message: string
  last_transition_time: string
}

export interface K8sContainer {
  name: string
  image: string
  ready: boolean
  restarts: number
  state: string
  reason: string
}

export interface K8sEvent {
  type: string
  reason: string
  message: string
  count: number
  last_timestamp: string
}

export interface K8sResourceDetail {
  summary: K8sResource
  conditions: K8sCondition[]
  containers: K8sContainer[]
  owners: Array<{ kind: string; name: string }>
  events: K8sEvent[]
  labels: Record<string, string>
}

// ── SSO types ──

export interface SsoProvider {
  id: string
  name: string
  protocol: string
  enabled: boolean
  client_id: string
  issuer_url: string
  oidc_scopes: string
  groups_claim: string
  email_claim: string
  first_name_claim: string
  last_name_claim: string
  jit_provisioning: boolean
  default_group_id: string
  // SAML-specific fields
  saml_idp_metadata_url: string
  saml_idp_sso_url: string
  saml_idp_cert: string
  saml_sp_entity_id: string
}

export interface IdpGroupMapping {
  id: string
  idp_group: string
  rush_group_id: string
  provider_id: string
}

export interface SsoStatus {
  enabled: boolean
  provider_name: string
  protocol: string
}

export interface SetupToken {
  token: string
  url: string
}

export interface SetupTokenValidation {
  valid: boolean
  provider: string
}

// ── Detection types ──

export interface DetectionRule {
  id: string
  tenant_id: string
  name: string
  description: string
  query_sql: string
  interval_secs: number
  threshold: number
  severity: string  // 'critical' | 'high' | 'medium' | 'low' | 'info'
  window_secs: number
  enabled: boolean
  channels: string[]
  created_by: string
  created_at: string
  updated_at: string
}

export interface DetectionEvent {
  id: string
  rule_id: string
  tenant_id: string
  severity: string
  match_count: number
  sample_data: any[]
  created_at: string
}

// ── BubbleUp types ──

export interface BubbleUpValue {
  value: string
  selection_count: number
  baseline_count: number
  selection_pct: number
  baseline_pct: number
  lift: number
}

export interface BubbleUpDimension {
  name: string
  values: BubbleUpValue[]
}

export interface BubbleUpResponse {
  dimensions: BubbleUpDimension[]
  selection_count: number
  baseline_count: number
}

export interface BubbleUpRequest {
  selection: { from: string; to: string }
  baseline: { from: string; to: string }
  signal: string
  filters: Filter[]
  top_k?: number
  selection_min_duration_ns?: number
  selection_max_duration_ns?: number
  selection_errors_only?: boolean
  exclude_selection_from_baseline?: boolean
}

// ── Monitor types ──

export interface Monitor {
  id: string
  tenant_id: string
  name: string
  type: 'metric' | 'log' | 'apm' | 'composite'
  query_config: any
  critical: number | null
  critical_recovery: number | null
  warning: number | null
  warning_recovery: number | null
  eval_window_secs: number
  eval_interval_secs: number
  group_by: string[]
  state: 'ok' | 'warn' | 'alert' | 'no_data'
  group_states: Record<string, string>
  no_data_action: string
  no_data_timeframe: number
  message: string
  notification_channels: string[]
  renotify_interval: number | null
  tags: string[]
  priority: number | null
  enabled: boolean
  last_eval_at: string | null
  last_triggered_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface MonitorEvent {
  id: string
  monitor_id: string
  group_key: string
  prev_state: string
  new_state: string
  value: number
  threshold: number
  message: string
  created_at: string
}

export interface MonitorPreview {
  current_value: number
  timeseries: { timestamp: string; value: number }[]
}

export interface RumIngestPayload {
  meta: {
    app_name: string
    app_version?: string
    environment?: string
    session_id?: string
    user_id?: string
    page_url?: string
    page_path?: string
    view_name?: string
    referrer?: string
    browser_name?: string
    browser_version?: string
    os_name?: string
    os_version?: string
    device_type?: string
    screen_width?: number
    screen_height?: number
  }
  events: Array<{
    event_type: string
    event_name?: string
    timestamp?: number
    vital_name?: string
    vital_value?: number
    vital_rating?: string
    error_message?: string
    error_stack?: string
    error_type?: string
    interaction_target?: string
    interaction_type?: string
    duration_ms?: number
    trace_id?: string
    span_id?: string
    attributes?: string
  }>
}

// ── Maintenance Windows ──

export interface MaintenanceWindow {
  id: string
  name: string
  scope: string
  starts_at: string
  ends_at: string
  created_at: string
}

export interface CreateMaintenanceWindowRequest {
  name: string
  scope?: string
  starts_at: string
  ends_at: string
}

// ── Trace Funnels ──

export interface FunnelStep {
  label: string
  service_name?: string
  http_path_prefix?: string
  min_status_code?: number
  max_status_code?: number
}

export interface Funnel {
  id: string
  name: string
  steps: FunnelStep[]
  created_at: string
}

export interface FunnelResultStep {
  label: string
  count: number
  pct_of_first: number
  pct_of_prev: number
  drop_off: number
}

export interface FunnelResult {
  funnel_id: string
  steps: FunnelResultStep[]
}

// ── Metric Firewall ──

export interface MetricFirewallRule {
  id: string
  name: string
  enabled: number            // 0 | 1 from GET
  action: 'allow' | 'block' | 'drop_label'
  metric_pattern: string
  metric_regex: number       // 0 | 1
  match_label_key: string
  match_label_value: string
  match_label_value_regex: number  // 0 | 1
  drop_label_pattern: string
  drop_label_regex: number   // 0 | 1
  created_at: string
}

export interface MetricFirewallInput {
  name: string
  enabled: boolean
  action: 'allow' | 'block' | 'drop_label'
  metric_pattern: string
  metric_regex: boolean
  match_label_key: string
  match_label_value: string
  match_label_value_regex: boolean
  drop_label_pattern: string
  drop_label_regex: boolean
}

// ── Audit log (admin-only, tamper-evident) ──

export type AuditActorType = 'user' | 'system' | 'api_key' | 'anonymous'
export type AuditOutcome = 'success' | 'failure'

export interface AuditEvent {
  id: string
  seq: number
  /** RFC3339 timestamp string. */
  timestamp: string
  tenant_id: string
  actor_id: string
  actor_name: string
  actor_type: AuditActorType
  /** e.g. "user.create", "tenant.auth_required_change". */
  action: string
  resource_type: string
  resource_id: string
  outcome: AuditOutcome
  ip_address: string
  user_agent: string
  request_id: string
  /** JSON-encoded string (before/after diff). */
  changes: string
  description: string
  /** JSON-encoded string. */
  metadata: string
  prev_hash: string
  hash: string
}

export interface AuditListResponse {
  events: AuditEvent[]
  limit: number
  offset: number
  total?: number
}

export interface AuditQueryParams {
  from?: string
  to?: string
  actor?: string
  action?: string
  resource_type?: string
  outcome?: string
  tenant_id?: string
  q?: string
  limit?: number
  offset?: number
}

export interface AuditVerifyResponse {
  intact: boolean
  checked: number
  first_broken_seq: number | null
}
