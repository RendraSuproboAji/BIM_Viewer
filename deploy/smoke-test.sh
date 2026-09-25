#!/usr/bin/env sh
# Builds and starts the nginx + API stack, checks it end to end over HTTP, then removes it.
# Usage: deploy/smoke-test.sh   (needs Docker with the compose plugin)
set -eu
cd "$(dirname "$0")/.."
export BIM_PORT="${BIM_PORT:-18080}"
PROJECT=bim-smoke
BASE="http://127.0.0.1:${BIM_PORT}"
compose() { docker compose -p "$PROJECT" "$@"; }
trap 'compose down -v >/dev/null 2>&1 || true' EXIT

# SMOKE_BUILD=--no-build tests images built beforehand (tagged bim-smoke-api / bim-smoke-web).
compose up -d "${SMOKE_BUILD:---build}" --wait

failures=0
check() { # name, expected, actual
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1: expected '$2', got '$3'"; failures=$((failures + 1)); fi
}
header() { # url, header name, [curl options...]
  url=$1; name=$2; shift 2
  curl -s -o /dev/null -D - "$@" "$url" | tr -d '\r' | awk -v n="$(echo "$name" | tr 'A-Z' 'a-z')" 'BEGIN{FS=": "} tolower($1)==n {print $2}' | tail -1
}
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

check "app shell is served" 200 "$(status "$BASE/")"
check "app shell is revalidated" "no-cache" "$(header "$BASE/index.html" Cache-Control)"
check "client-side routes get the app" 200 "$(status "$BASE/some/client/route")"
check "missing files are a real 404" 404 "$(status "$BASE/nope.js")"

asset=$(curl -s "$BASE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
check "hashed assets are cached for a year" "public, max-age=31536000, immutable" "$(header "$BASE$asset" Cache-Control)"
check "assets are served precompressed" gzip "$(header "$BASE$asset" Content-Encoding -H 'Accept-Encoding: gzip')"
worker=$(curl -s --compressed "$BASE$asset" | grep -o 'worker-[A-Za-z0-9_-]*\.mjs' | head -1)
if [ -n "$worker" ]; then
  check "module worker has a JavaScript MIME type" application/javascript "$(header "$BASE/assets/$worker" Content-Type | cut -d';' -f1)"
fi
check "web-ifc WASM has the WASM MIME type" application/wasm "$(header "$BASE/web-ifc/web-ifc.wasm" Content-Type)"
check "security header is set" nosniff "$(header "$BASE/" X-Content-Type-Options)"

check "API is reachable through nginx" '{"ok":true}' "$(curl -s "$BASE/api/health")"
check "API auth status works" 200 "$(status "$BASE/api/auth/status")"
# nginx's static rules would answer 404 text/html; the API answers with JSON.
check "API file-like routes reach the API" application/json "$(header "$BASE/api/issues/x/snapshot.png" Content-Type | cut -d';' -f1)"
check "first-run setup through nginx" 201 "$(status -X POST -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","name":"Admin","password":"password123"}' "$BASE/api/auth/setup")"
published=$(compose port api 3001 2>/dev/null | grep -E ':[1-9][0-9]*$' || true)
check "API port is not published" "" "$published"

echo
compose images
if [ "$failures" -ne 0 ]; then echo "$failures check(s) failed"; compose logs --tail 50; exit 1; fi
echo "All smoke checks passed"
