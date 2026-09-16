# ── Build stage ──────────────────────────────────────────────────────────────
# Chainguard node (-dev has npm + a shell for the RUN steps; this stage is
# discarded, so its footprint doesn't affect the final image's CVE posture).
# The Vue bundle is architecture-independent. Keep this stage on the BuildKit
# host so multi-platform builds do not run Node, vue-tsc, or Vite through QEMU.
FROM --platform=$BUILDPLATFORM cgr.dev/chainguard/node@sha256:e48acd045f3c4da0148a59f5eba5f2ad8067ca8d177debf5522074df0454431c AS builder
# Chainguard node runs as non-root by default; the build writes to /app and the
# npm cache, so run this (discarded) stage as root to avoid permission errors.
USER root

WORKDIR /app

# Standalone build — context is this repo's root. The @rushobservability/rum-sdk
# dependency is pulled from npm (see package.json), not a local file: path.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
# .dockerignore keeps host dependencies, credentials, tests, and build output out
# of this context, so the locked install above is the only dependency install.
COPY . .
# Type-check + bundle. The strict `vue-tsc` errors that once forced a bare
# `vite build` here are fixed and enforced in CI, so the image builds the same
# type-checked artifact.
RUN npm run build

# ── Tools stage ──────────────────────────────────────────────────────────────
# The runtime image (Chainguard nginx) is distroless — no shell, and we can't RUN
# in it. Stage a busybox multi-call binary + the applet symlinks the entrypoint
# needs (sh, sed, mkdir, grep) so it can validate and render config at start.
FROM cgr.dev/chainguard/busybox@sha256:c7d002f0bf46c907b5cad2637073b636ef1fb2a4671807317512b150f19c4097 AS tools
# The busybox image also runs non-root, so assemble the tools under /tmp (writable).
RUN ["/bin/sh", "-c", "set -e; mkdir -p /tmp/tools; cp /bin/busybox /tmp/tools/busybox; for a in sh sed mkdir grep; do ln -s busybox /tmp/tools/$a; done"]

# ── Runtime stage ────────────────────────────────────────────────────────────
# Chainguard nginx: 0-CVE, distroless, runs as non-root (uid 65532) and listens
# on 8080. Its entrypoint is bare `nginx` (no docker-entrypoint.sh / envsubst),
# so we supply our own entrypoint to render the runtime template.
FROM cgr.dev/chainguard/nginx@sha256:b91cf888522ed0cc1b6bddadfa8320ac2a131a1003b103ae340217a421f12fcc

# busybox tools for the entrypoint (sh/sed/mkdir at /usr/local/bin).
COPY --from=tools /tmp/tools/ /usr/local/bin/

# Top-level config (writable paths under /tmp, logs to stdout/stderr, includes
# the rendered server block). Overwrites the image default.
COPY nginx/nginx-main.conf /etc/nginx/nginx.conf
COPY nginx/nginx-security-headers.conf /etc/nginx/security-headers.conf
# Server-block template rendered at start by the entrypoint. The Helm chart mounts
# its own template over this path; standalone runs use this baked default.
COPY nginx/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Static SPA bundle.
COPY --from=builder /app/dist /usr/share/nginx/html

# Public base URL of the Rush API as seen from outside the cluster, surfaced to
# the UI (e.g. the CloudWatch ingest endpoint). Empty → UI uses its origin.
ENV QUERY_API_HOST=localhost:8080
ENV API_PUBLIC_URL=""
ENV RUSH_ENVIRONMENT="production"
# Default theme for first-time visitors with no saved preference: light | dark.
ENV DEFAULT_THEME="light"

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
