<script setup lang="ts">
// A small "?" affordance that reveals common regex examples on hover/focus.
// Used next to the firewall form's regex toggles. CSS-only popover (no state).
</script>

<template>
  <span class="rx-help" tabindex="0" role="note" aria-label="Regex examples">
    <span class="rx-q">?</span>
    <span class="rx-pop">
      <span class="rx-pop-title">Regex (RE2 syntax) — matches anywhere unless anchored</span>
      <span class="rx-row"><code>^node_</code><em>starts with</em> <span class="mono">node_</span></span>
      <span class="rx-row"><code>_total$</code><em>ends with</em> <span class="mono">_total</span></span>
      <span class="rx-row"><code>^http_requests_total$</code><em>exact</em> match</span>
      <span class="rx-row"><code>(cpu|mem)_.*</code><em>either</em> <span class="mono">cpu_…</span> or <span class="mono">mem_…</span></span>
      <span class="rx-row"><code>go_.*</code><em>prefix</em> + anything</span>
      <span class="rx-row"><code>5..</code><em>5xx</em> (5 + any 2 chars)</span>
      <span class="rx-row"><code>[a-z0-9_]+</code><em>char class</em>, one or more</span>
      <span class="rx-row"><code>.*_(bucket|sum|count)$</code><em>histogram</em> suffixes</span>
    </span>
  </span>
</template>

<style scoped>
.rx-help {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 6px;
  cursor: help;
  outline: none;
}
.rx-q {
  width: 15px;
  height: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  color: var(--text-muted);
  border: 1px solid var(--border-default);
  border-radius: 50%;
  transition: color 0.12s, border-color 0.12s;
}
.rx-help:hover .rx-q,
.rx-help:focus .rx-q {
  color: var(--amber);
  border-color: var(--amber);
}

.rx-pop {
  position: absolute;
  top: calc(100% + 8px);
  /* Anchored to the icon's right edge so it opens leftward — keeps it on-screen
     inside the right-side slide-out drawer instead of overflowing past the edge. */
  right: 0;
  left: auto;
  z-index: 50;
  width: 320px;
  max-width: 80vw;
  padding: 10px 12px;
  display: none;
  flex-direction: column;
  gap: 5px;
  background: var(--bg-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  box-shadow: 0 8px 28px rgba(6, 7, 16, 0.45);
  text-align: left;
  cursor: auto;
}
.rx-help:hover .rx-pop,
.rx-help:focus .rx-pop,
.rx-help:focus-within .rx-pop {
  display: flex;
}
.rx-pop-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 2px;
}
.rx-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}
.rx-row code {
  flex: none;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--amber);
  background: var(--amber-dim);
  border: 1px solid var(--amber-glow);
  border-radius: var(--r-sm);
  padding: 1px 5px;
}
.rx-row em {
  font-style: normal;
  color: var(--text-secondary);
}
.rx-row .mono { font-family: var(--font-mono); color: var(--text-secondary); }
</style>
