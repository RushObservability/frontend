#!/usr/local/bin/sh
# Renders the nginx server-block template with runtime env values, then execs
# nginx. Replaces the stock nginx image's docker-entrypoint.sh + envsubst, which
# the distroless Chainguard nginx image does not ship. envsubst itself isn't on
# the free Chainguard tier, so we substitute with busybox sed (staged into
# /usr/local/bin). The template path matches what the Helm chart mounts, so the
# same image works standalone and in-cluster.
set -eu
export PATH="/usr/local/bin:${PATH}"

# Defaults mirror the Dockerfile ENV; the chart overrides QUERY_API_HOST /
# API_PUBLIC_URL via the pod env. DEFAULT_THEME is optional.
: "${QUERY_API_HOST:=localhost:8080}"
: "${API_PUBLIC_URL:=}"
: "${DEFAULT_THEME:=light}"

TEMPLATE=/etc/nginx/templates/default.conf.template
OUT_DIR=/tmp/nginx-conf.d
mkdir -p "${OUT_DIR}"

# '|' delimiter: values are host:port / URLs (no '|'), so no escaping needed.
sed -e "s|\${QUERY_API_HOST}|${QUERY_API_HOST}|g" \
    -e "s|\${API_PUBLIC_URL}|${API_PUBLIC_URL}|g" \
    -e "s|\${DEFAULT_THEME}|${DEFAULT_THEME}|g" \
    "${TEMPLATE}" > "${OUT_DIR}/default.conf"

exec nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
