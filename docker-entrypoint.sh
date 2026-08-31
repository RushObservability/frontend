#!/usr/local/bin/sh
# Renders the nginx server-block template with the runtime proxy host, writes a
# separately generated runtime-config.js, then execs nginx. Replaces the stock
# nginx image's docker-entrypoint.sh + envsubst, which the distroless Chainguard
# nginx image does not ship. The template path matches what the Helm chart
# mounts, so the same image works standalone and in-cluster.
set -eu
export PATH="/usr/local/bin:${PATH}"

# Defaults mirror the Dockerfile ENV; the chart overrides QUERY_API_HOST /
# API_PUBLIC_URL via the pod env. DEFAULT_THEME is optional.
: "${QUERY_API_HOST:=localhost:8080}"
: "${API_PUBLIC_URL:=}"
: "${DEFAULT_THEME:=light}"
: "${RUSH_ENVIRONMENT:=production}"

fail() {
    echo "docker-entrypoint: $*" >&2
    exit 1
}

# Only values that are safe inside an nginx proxy_pass target are accepted.
# This blocks config-directive injection before the value reaches sed/nginx.
case "${QUERY_API_HOST}" in
    "") fail "QUERY_API_HOST must not be empty" ;;
    *[!A-Za-z0-9._:\[\]-]*) fail "QUERY_API_HOST contains unsupported characters" ;;
esac

# Normalize API_PUBLIC_URL to an exact HTTP(S) origin before it reaches the
# browser. A single trailing slash is the root path and is removed; every other
# path, query, fragment, credential, or unsupported authority character fails
# startup closed. Production permits HTTPS only.
if printf '%s' "${API_PUBLIC_URL}" | grep -q '[[:cntrl:]]'; then
    fail "API_PUBLIC_URL must not contain control characters"
fi
case "${RUSH_ENVIRONMENT}" in
    production|development|test) ;;
    *) fail "RUSH_ENVIRONMENT must be production, development, or test" ;;
esac
if [ -n "${API_PUBLIC_URL}" ]; then
    case "${API_PUBLIC_URL}" in
        */) API_PUBLIC_URL=${API_PUBLIC_URL%/} ;;
    esac
    case "${API_PUBLIC_URL}" in
        https://*) API_AUTHORITY=${API_PUBLIC_URL#https://} ;;
        http://*)
            [ "${RUSH_ENVIRONMENT}" != "production" ] || fail "API_PUBLIC_URL must use https in production"
            API_AUTHORITY=${API_PUBLIC_URL#http://}
            ;;
        *) fail "API_PUBLIC_URL must be an http:// or https:// origin" ;;
    esac
    case "${API_AUTHORITY}" in
        "") fail "API_PUBLIC_URL must include a host" ;;
        *[/?#@]*) fail "API_PUBLIC_URL must be an origin without credentials, path, query, or fragment" ;;
        *[!A-Za-z0-9._:\[\]-]*) fail "API_PUBLIC_URL contains unsupported authority characters" ;;
    esac
fi

case "${DEFAULT_THEME}" in
    light|dark) ;;
    *) fail "DEFAULT_THEME must be light or dark" ;;
esac

json_escape() {
    # The generated file is written directly, so escape JSON characters rather
    # than interpolating values into an nginx quoted `return` directive.
    printf '%s' "$1" | sed \
        -e 's/\\/\\\\/g' \
        -e 's/"/\\"/g' \
        -e 's/	/\\t/g'
}

TEMPLATE=/etc/nginx/templates/default.conf.template
OUT_DIR=/tmp/nginx-conf.d
RUNTIME_DIR=/tmp/nginx-runtime
mkdir -p "${OUT_DIR}"
mkdir -p "${RUNTIME_DIR}"

# Escape the sed replacement even though QUERY_API_HOST is validated. Keeping
# this boundary explicit prevents a future validation change from reintroducing
# delimiter, ampersand, or backslash substitution bugs.
QUERY_API_HOST_ESCAPED=$(printf '%s' "${QUERY_API_HOST}" | sed 's/[\\&|]/\\&/g')
sed -e "s|\${QUERY_API_HOST}|${QUERY_API_HOST_ESCAPED}|g" \
    "${TEMPLATE}" > "${OUT_DIR}/default.conf"

API_PUBLIC_URL_JSON=$(json_escape "${API_PUBLIC_URL}")
DEFAULT_THEME_JSON=$(json_escape "${DEFAULT_THEME}")
printf '%s\n' \
    "window.__RUSH_CONFIG__={\"apiBaseUrl\":\"${API_PUBLIC_URL_JSON}\",\"defaultTheme\":\"${DEFAULT_THEME_JSON}\"};" \
    > "${RUNTIME_DIR}/runtime-config.js"

exec nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
