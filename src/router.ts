import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from './composables/useAuth'
import { frontendEdition } from './edition/manifest'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      name: 'explore',
      component: () => import('./views/ExploreView.vue'),
    },
    {
      path: '/trace/:traceId',
      name: 'trace',
      component: () => import('./views/TraceView.vue'),
      props: true,
    },
    {
      path: '/services',
      name: 'services',
      component: () => import('./views/ServicesView.vue'),
    },
    {
      path: '/services/:serviceName',
      name: 'service-detail',
      component: () => import('./views/ServiceDetailView.vue'),
      props: true,
    },
    {
      path: '/logs',
      name: 'logs',
      redirect: '/?mode=logs',
    },
    {
      path: '/traces',
      name: 'traces',
      redirect: '/?mode=traces',
    },
    {
      path: '/metrics',
      name: 'metrics',
      component: () => import('./views/MetricsView.vue'),
    },
    {
      path: '/dashboards',
      name: 'dashboards',
      component: () => import('./views/DashboardsListView.vue'),
    },
    {
      path: '/dashboards/:id',
      name: 'dashboard',
      component: () => import('./views/DashboardView.vue'),
      props: true,
    },
    {
      path: '/alerts',
      name: 'alerts',
      component: () => import('./views/MonitorsView.vue'),
    },
    {
      path: '/alerts/new',
      name: 'monitor-create',
      component: () => import('./views/MonitorCreateView.vue'),
    },
    {
      path: '/alerts/:id',
      name: 'monitor-detail',
      component: () => import('./views/MonitorDetailView.vue'),
      props: true,
    },
    {
      path: '/alerts/:id/edit',
      name: 'monitor-edit',
      component: () => import('./views/MonitorEditView.vue'),
      props: true,
    },
    {
      path: '/alerts/channels/add',
      name: 'alert-channel-add',
      component: () => import('./views/AlertChannelAddView.vue'),
    },
    {
      // Detection rules were folded into Alerts. Preserve old bookmarks.
      path: '/detection/:pathMatch(.*)*',
      redirect: '/alerts',
    },
    {
      path: '/slos',
      name: 'slos',
      component: () => import('./views/SlosView.vue'),
    },
    {
      path: '/slos/:sloId',
      name: 'slo-detail',
      component: () => import('./views/SloDetailView.vue'),
      props: true,
    },
    {
      path: '/deploys',
      name: 'deploys',
      component: () => import('./views/DeploysView.vue'),
    },
    {
      path: '/funnels',
      name: 'funnels',
      component: () => import('./views/FunnelsView.vue'),
    },
    {
      path: '/stats/metrics/:metricName',
      name: 'metric-detail',
      component: () => import('./views/MetricDetailView.vue'),
      props: true,
    },
    {
      // Legacy stats links now land in the Usage sub-pages.
      path: '/stats/:tab?',
      redirect: to => ({ name: 'usage', params: { tab: to.params.tab } }),
    },
    {
      path: '/usage/:tab?',
      name: 'usage',
      component: () => import('./views/UsageView.vue'),
    },
    {
      path: '/capacity',
      name: 'capacity',
      component: () => import('./views/CapacityView.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/rum',
      name: 'rum',
      component: () => import('./views/RumView.vue'),
    },
    {
      path: '/rum/:appName',
      name: 'rum-detail',
      component: () => import('./views/RumDetailView.vue'),
      props: true,
    },
    {
      // Replay is temporarily disabled; keep old links from opening a blank view.
      path: '/rum/:appName/replay/:sessionId',
      redirect: to => `/rum/${encodeURIComponent(String(to.params.appName))}`,
    },
    {
      path: '/integrations',
      name: 'integrations',
      component: () => import('./views/IntegrationsView.vue'),
    },
    {
      path: '/integrations/:addon/:page?',
      name: 'integration-page',
      component: () => import('./views/IntegrationsView.vue'),
    },
    {
      path: '/anomaly',
      name: 'anomaly',
      component: () => import('./views/AnomalyView.vue'),
    },
    {
      path: '/anomaly/rules/:ruleId',
      name: 'anomaly-detail',
      component: () => import('./views/AnomalyDetailView.vue'),
      props: true,
    },
    {
      path: '/anomaly/add',
      name: 'anomaly-add',
      component: () => import('./views/AnomalyAddView.vue'),
    },
    {
      path: '/investigate',
      name: 'investigate',
      component: () => import('./views/InvestigateView.vue'),
    },
    {
      path: '/sre-agent',
      name: 'sre-agent',
      component: () => import('./views/SreAgentView.vue'),
    },
    {
      path: '/sre-agent/:sessionId',
      name: 'sre-agent-session',
      component: () => import('./views/SreAgentView.vue'),
    },
    {
      // ArgoCD moved into the Integrations area; keep the old path as a redirect.
      path: '/argocd',
      redirect: '/integrations/argocd/applications',
    },
    {
      path: '/argocd/:name',
      name: 'argocd-detail',
      component: () => import('./views/ArgoDetailView.vue'),
      props: true,
    },
    {
      path: '/fluxcd',
      redirect: '/integrations/fluxcd/workloads',
    },
    {
      path: '/fluxcd/:kind/:name',
      name: 'fluxcd-detail',
      component: () => import('./views/FluxDetailView.vue'),
      props: true,
    },
    {
      path: '/kubernetes',
      redirect: '/integrations/kubernetes/workloads',
    },
    {
      path: '/kubernetes/:kind/:namespace/:name',
      name: 'kubernetes-detail',
      component: () => import('./views/KubernetesDetailView.vue'),
      props: true,
    },
    {
      path: '/audit',
      name: 'audit',
      component: () => import('./views/AuditView.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/setup/sso',
      name: 'sso-setup',
      component: () => import('./views/SsoSetupView.vue'),
      meta: { public: true },
    },
    ...frontendEdition.routes,
  ],
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true

  const { isAuthenticated, isAdmin, checked, checkSession } = useAuth()

  if (!checked.value) {
    await checkSession()
  }

  if (!isAuthenticated.value) {
    // Preserve only the path (not query params) in the redirect to avoid
    // leaking sensitive query string values into the URL and server logs.
    return { name: 'login', query: { redirect: to.path } }
  }

  if (to.meta.requiresAdmin && !isAdmin.value) {
    return { name: 'explore' }
  }

  return true
})

export default router
