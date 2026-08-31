<template>
  <section class="mysql-setup">
    <p class="setup-kicker">MySQL add-on</p>
    <h2>Connect a MySQL instance</h2>
    <p class="setup-lede">The collector reads Performance Schema and metadata views. It does not proxy traffic or change the database.</p>

    <div class="setup-grid">
      <div>
        <h3>1. Create a monitoring account</h3>
        <pre>CREATE USER 'rush_monitor'@'%' IDENTIFIED BY 'change-me' REQUIRE SSL;
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'rush_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'rush_monitor'@'%';
GRANT SELECT ON sys.* TO 'rush_monitor'@'%';</pre>
      </div>
      <div>
        <h3>2. Run the collector</h3>
        <pre>MYSQL_DSN="mysql://rush_monitor:…@db:3306/app" \
RUSH_OTLP_ENDPOINT="http://query-api:8080" \
RUSH_API_KEY="&lt;tenant ingest key&gt;" \
RUSH_LICENSE_KEY="&lt;your license&gt;" \
COLLECTOR_SERVER_NAME="orders-mysql" \
mysql-collector</pre>
      </div>
    </div>

    <p class="setup-note"><strong>Privacy default:</strong> Rush collects normalized digest text, not statement samples. Error messages are omitted unless you explicitly enable them.</p>
  </section>
</template>

<style scoped>
.mysql-setup { max-width: 980px; padding: clamp(22px, 4vw, 42px); border: 1px solid var(--border-subtle); background: var(--bg-surface); border-radius: var(--r-md, 8px); }
.setup-kicker { margin: 0 0 8px; color: var(--text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
h2 { margin: 0; font-size: clamp(24px, 3vw, 36px); letter-spacing: -.035em; }
.setup-lede { max-width: 680px; margin: 9px 0 28px; color: var(--text-secondary); line-height: 1.55; }
.setup-grid { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(18px, 3vw, 34px); }
h3 { margin: 0 0 9px; font-size: 13px; }
pre { min-height: 150px; margin: 0; padding: 15px; overflow: auto; border: 1px solid var(--border-subtle); background: var(--bg-primary); color: var(--text-secondary); border-radius: var(--r-sm, 4px); font: 11px/1.65 var(--font-mono, monospace); }
.setup-note { margin: 24px 0 0; color: var(--text-tertiary); font-size: 12px; }
@media (max-width: 760px) { .setup-grid { grid-template-columns: 1fr; } }
</style>
