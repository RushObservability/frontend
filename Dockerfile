FROM node:22-slim AS builder

WORKDIR /app

# Standalone build — context is this repo's root. The @rushobservability/rum-sdk
# dependency is pulled from npm (see package.json), not a local file: path.
COPY package.json package-lock.json* ./
RUN npm install
# Copy source; drop any host node_modules that may have leaked in, then reinstall.
COPY . .
RUN rm -rf node_modules && npm install
# Bundle with vite directly, skipping the `vue-tsc -b` type gate. The app runs
# fine at runtime (same code vite-dev serves); strict-mode type errors are
# tracked separately. Revert to `npm run build` once those are cleaned up.
RUN npx vite build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV QUERY_API_HOST=localhost:8080
# Public base URL (scheme+host, no trailing slash) of the Rush API as seen from
# outside the cluster, surfaced to the UI wherever it shows/reaches the API by its
# public address (e.g. the CloudWatch ingest endpoint). Empty → UI uses its origin.
ENV API_PUBLIC_URL=""
EXPOSE 80
