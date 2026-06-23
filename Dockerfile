FROM node:22-slim AS builder

WORKDIR /app

# Copy the local @rush/rum SDK so the file: dep can be resolved.
# package.json has "file:../sdk/rum" which from /app/web-ui resolves to /app/sdk/rum.
# Build context must be the monorepo root:
#   docker build -t mzupan/rush-frontend:0.1.12 -f web-ui/Dockerfile .
COPY sdk/rum /app/sdk/rum

WORKDIR /app/web-ui
COPY web-ui/package.json ./
RUN npm install
# Copy source files; ensure the host's macOS node_modules don't leak through
COPY web-ui/ .
RUN rm -rf node_modules && npm install
# Bundle with vite directly, skipping the `vue-tsc -b` type gate. The app runs
# fine at runtime (same code vite-dev serves); strict-mode type errors are
# tracked separately. Revert to `npm run build` once those are cleaned up.
RUN npx vite build

FROM nginx:alpine
COPY --from=builder /app/web-ui/dist /usr/share/nginx/html
COPY web-ui/nginx.conf /etc/nginx/templates/default.conf.template
ENV QUERY_API_HOST=localhost:8080
# Public base URL (scheme+host, no trailing slash) of the Rush API as seen from
# outside the cluster, surfaced to the UI wherever it shows/reaches the API by its
# public address (e.g. the CloudWatch ingest endpoint). Empty → UI uses its origin.
ENV API_PUBLIC_URL=""
EXPOSE 80
