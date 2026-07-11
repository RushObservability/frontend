# ── Build stage ──────────────────────────────────────────────────────────────
# Chainguard node (-dev has npm + a shell for the RUN steps; this stage is
# discarded, so its footprint doesn't affect the final image's CVE posture).
FROM cgr.dev/chainguard/node:latest-dev AS builder
# Chainguard node runs as non-root by default; the build writes to /app and the
# npm cache, so run this (discarded) stage as root to avoid permission errors.
USER root

WORKDIR /app

# Standalone build — context is this repo's root. The @rushobservability/rum-sdk
# dependency is pulled from npm (see package.json), not a local file: path.
COPY package.json package-lock.json* ./
RUN npm install
# Copy source; drop any host node_modules that may have leaked in, then reinstall.
COPY . .
RUN rm -rf node_modules && npm install
# Type-check + bundle. The strict `vue-tsc` errors that once forced a bare
# `vite build` here are fixed and enforced in CI, so the image builds the same
# type-checked artifact.
RUN npm run build

# ── Tools stage ──────────────────────────────────────────────────────────────
# The runtime image (Chainguard nginx) is distroless — no shell, and we can't RUN
# in it. Stage a busybox multi-call binary + the applet symlinks the entrypoint
# needs (sh, sed, mkdir) so it can render the config template at start.
FROM cgr.dev/chainguard/busybox:latest AS tools
# The busybox image also runs non-root, so assemble the tools under /tmp (writable).
RUN ["/bin/sh", "-c", "set -e; mkdir -p /tmp/tools; cp /bin/busybox /tmp/tools/busybox; for a in sh sed mkdir; do ln -s busybox /tmp/tools/$a; done"]

# ── Runtime stage ────────────────────────────────────────────────────────────
# Chainguard nginx: 0-CVE, distroless, runs as non-root (uid 65532) and listens
# on 8080. Its entrypoint is bare `nginx` (no docker-entrypoint.sh / envsubst),
# so we supply our own entrypoint to render the runtime template.
FROM cgr.dev/chainguard/nginx:latest

# busybox tools for the entrypoint (sh/sed/mkdir at /usr/local/bin).
COPY --from=tools /tmp/tools/ /usr/local/bin/

# Top-level config (writable paths under /tmp, logs to stdout/stderr, includes
# the rendered server block). Overwrites the image default.
COPY nginx-main.conf /etc/nginx/nginx.conf
# Server-block template rendered at start by the entrypoint. The Helm chart mounts
# its own template over this path; standalone runs use this baked default.
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Static SPA bundle.
COPY --from=builder /app/dist /usr/share/nginx/html

# Public base URL of the Rush API as seen from outside the cluster, surfaced to
# the UI (e.g. the CloudWatch ingest endpoint). Empty → UI uses its origin.
ENV QUERY_API_HOST=localhost:8080
ENV API_PUBLIC_URL=""
# Default theme for first-time visitors with no saved preference: light | dark.
ENV DEFAULT_THEME="light"

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
