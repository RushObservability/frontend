# Profiling workspace

The creator confirmed the audience as engineers and SREs investigating CPU
hotspots and release regressions. The page should feel compact and practical,
like Rush's Explore view. Profiles stays under Observe and remains free.

## References

- [Datadog profile visualizations](https://docs.datadoghq.com/profiler/profile_visualizations/?tab=java): service-first filtering, a dominant flame graph, and a ranked self-CPU function list.
- [Grafana flame graphs](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/flame-graph/): connected table and graph views, function search, and focused stack navigation.
- [Elastic Universal Profiling](https://www.elastic.co/guide/en/observability/current/universal-profiling.html): explicit baseline and comparison controls.

## Rush implementation

The unfiltered page lists services with data in the selected range. Selecting a
service opens a full-width flame graph with the shared DataTable beneath it at
every screen size. This follows the creator's preference after reviewing
[Datadog's wide CPU graph screenshot](https://www.datadoghq.com/blog/engineering/performance-improvements-in-the-datadog-agent-metrics-pipeline/)
and Grafana's split-view screenshot. Long Node call stacks need horizontal room;
the function table should not take width away from them. Both, Flame graph, and
Functions controls let users choose their workspace. Selecting a function focuses
its largest current call stack and scrolls the graph into view.
Breadcrumbs restore parent stacks; Reset zoom returns to all stacks.

Solid frame colors indicate CPU-share buckets. Function names retain Rush's code
font; surrounding controls use the existing UI font and semantic theme tokens.
Hovering or focusing a frame exposes total CPU, self CPU, and its share of all CPU.
The search highlights graph matches and filters the function table.

Comparison controls appear on request. Baseline and current scope are labeled;
share changes remain percentage points, not claims of per-request regression.
Collection instructions are available from the header and empty state.

No gradients, invented measurements, or decorative timeline. The current API
returns aggregate stacks, so this UI does not imply time-series precision.
