FROM node:22-slim AS builder

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

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV QUERY_API_HOST=localhost:8080
# Public base URL (scheme+host, no trailing slash) of the Rush API as seen from
# outside the cluster, surfaced to the UI wherever it shows/reaches the API by its
# public address (e.g. the CloudWatch ingest endpoint). Empty → UI uses its origin.
ENV API_PUBLIC_URL=""
# Default color theme for first-time visitors with no saved preference: light | dark.
# Defaults to light; set DEFAULT_THEME=dark to make the app open in dark mode.
ENV DEFAULT_THEME="light"
EXPOSE 80
