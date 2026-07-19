<script setup lang="ts">
// Shown when the postgres entitlement is present but no collector is reporting.
</script>

<template>
  <div class="pg-setup">
    <h2>Connect a PostgreSQL instance</h2>
    <p>
      Your license includes the <strong>PostgreSQL</strong> add-on, but no collector is reporting
      yet. Run the <code>postgres-collector</code> next to your database. The control room will show
      freshness, capabilities, query workload, locks, schema, and maintenance findings once data lands.
    </p>

    <h3>1. Monitoring role</h3>
    <pre>CREATE ROLE rush_monitor LOGIN PASSWORD 'change-me';
GRANT pg_monitor TO rush_monitor;
GRANT pg_read_all_stats TO rush_monitor;
-- shared_preload_libraries = 'pg_stat_statements' (then restart), then:
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;</pre>

    <h3>2. Run the collector</h3>
    <pre>PG_DSN="host=DB user=rush_monitor password=… dbname=app sslmode=require" \
RUSH_OTLP_ENDPOINT="http://query-api:8080" \
RUSH_API_KEY="&lt;tenant ingest key&gt;" \
RUSH_LICENSE_KEY="&lt;your license&gt;" \
COLLECTOR_SERVER_NAME="my-postgres" \
postgres-collector</pre>

    <p>
      In Kubernetes, enable <code>postgresCollector</code> in the Rush Helm chart. Once data lands,
      this page shows the instance automatically.
    </p>
  </div>
</template>
