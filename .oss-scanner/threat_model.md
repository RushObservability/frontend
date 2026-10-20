# Threat model: Rush frontend

## What this project does and where untrusted input enters

The Rush frontend is the Vue single-page app for Rush Observability: Explore (logs and APM), services, traces,
metrics, dashboards, alerts, SLOs, anomaly detection, RUM, the SRE agent, Kubernetes views and Settings. It is served
as static files by nginx (`nginx/`) and talks only to query-api, on the same origin, with a `__Host-` session cookie.
query-api enforces authentication, roles and tenant isolation; the frontend is not a security boundary for data
access, but it is responsible for not turning data into script.

Untrusted input reaches the browser from:

- **Telemetry**, written by any sender with an ingest key, or anonymously on tenants that allow it: log bodies and
  attributes, span names and attributes, metric names and labels, RUM events, error messages and stack traces, and
  Kubernetes object fields. Assume an attacker controls all of these and that an admin will view them.
- **Content other users create**: dashboard and widget titles, saved queries (shared to a group or tenant), monitor
  names and messages, notification channel names, custom SRE agent skills, service links.
- **SRE agent reports**, which are model output shaped by telemetry and so can carry attacker text
  (`src/components/InvestigationPanel.vue` renders them as Markdown with `v-html`).
- **The URL**: query parameters for filters, time ranges, `?saved=` and `?tenant=` links, and route parameters.
- **API responses** in general.

## Components that matter most / least

Most important:

1. Anything that renders data as HTML: every `v-html`, Markdown rendering (`renderMarkdown` in
   `InvestigationPanel.vue`), expression highlighting in `MonitorWizard.vue`, chart tooltips and labels, and DOM built
   by hand.
2. Link and navigation handling: URLs built from data (service links, trace links, external links in telemetry),
   `?tenant=` switching (`src/composables/useTenant.ts`), redirects after sign-in, and anything that could navigate to
   `javascript:` or another origin.
3. Session handling and CSRF: cookies are `__Host-` and `HttpOnly`; state-changing requests rely on query-api's
   Origin check. Report anything that stores credentials in `localStorage`, leaks them into URLs, or sends them to
   another origin.
4. RUM privacy masking (`src/lib/rumPrivacy.ts`) and history privacy (`src/composables/historyPrivacy*`).
5. The nginx configuration and Content-Security-Policy (`nginx/nginx-security-headers.conf`).

Less important: layout and styling, the marketing-style empty states, and `scripts/` used only at build time.

## How to exercise it

- `npm test` runs the Vitest unit tests (many render components with hostile input).
- `npm run build` produces `dist/`; `npm run security:check` and `npm run verify:opensource` are repository checks.
- The app needs query-api for real data, which is not in this image. Component tests with mocked API responses
  (see existing `*.test.ts` files) are the practical way to reproduce a rendering issue.
- The Playwright tests in `tests/e2e` need a browser download and a running stack, so they are not set up offline.

## How you rate severity

- **Critical:** stored XSS from telemetry or another user's content that runs in an admin's session (the CSP is
  strict, so show that the payload runs under it or bypasses it); sending the session or API keys to another origin.
- **High:** stored XSS that only runs for the user who created the content, or that the CSP blocks but would run
  without it; reflected XSS from a Rush URL; open redirects or `javascript:` navigation from data; a `?tenant=` link
  that shows one tenant's data under another tenant's name or acts in a tenant the user did not choose.
- **Medium:** RUM replay or history privacy failures that expose masked text; CSRF that query-api's Origin check would
  not stop; clickjacking.
- **Low:** information shown to a user that query-api already allowed them to read; missing hardening with no
  demonstrated impact.

## Anything to leave alone

- Access-control decisions: query-api enforces them. Report a frontend bug only if the browser does something unsafe,
  not if a hidden button would be refused by the API.
- Development-only Vite server behavior and `docker-compose.yml`.
- Third-party packages, unless Rush uses them in an unsafe way.
