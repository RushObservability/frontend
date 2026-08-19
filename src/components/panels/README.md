# Reusable dashboard panels

Use these components when a chart or metric should look and behave like a Rush dashboard panel on any page.

| Component | Use for |
|---|---|
| `TimeSeriesPanel` | Single- or multi-series trends, thresholds, deploy markers, and shared hover |
| `StatPanel` | One current value with an optional unit and semantic tone |
| `BarPanel` | Ranked grouped values |
| `HistogramPanel` | Numeric distributions with percentile or threshold markers |
| `TablePanel` | Bounded tabular results |
| `PanelCard` | A custom visualization that still needs the standard Rush panel shell |

All complete panel components share the same frame props: `title`, `description`, `caption`, `sourceLabel`, `rangeLabel`, `loading`, `error`, `emptyTitle`, and `emptyMessage`. They also expose `actions` and `footer` slots. `TimeSeriesPanel` and `StatPanel` add a `details` slot for supporting context below their primary visualization. `TimeSeriesPanel` also accepts a default slot for specialized renderers such as anomaly bands; pass the matching `series` data so its shared empty state remains accurate. `TablePanel` accepts a default slot when a page needs a richer table while retaining the shared loading, error, empty, header, and footer treatment.

```vue
<script setup lang="ts">
import { TimeSeriesPanel } from '../components/panels'
</script>

<template>
  <TimeSeriesPanel
    title="Request throughput"
    description="Accepted requests per second."
    caption="Traffic across the selected service and environment."
    source-label="Metrics"
    range-label="6h"
    unit="req/s"
    :series="series"
  />
</template>
```

Keep dashboard-only behavior outside the panels. `WidgetWrapper` adds drag, resize, edit, duplicate, and remove controls without making those behaviors a requirement for reuse elsewhere.

Use `precision` on `StatPanel` when a value must retain fixed decimal places, such as an SLO percentage.
