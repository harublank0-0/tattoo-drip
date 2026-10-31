#!/usr/bin/env bash
# Checks deploy/nginx against stand-in upstreams: host routing, the visitor's
# address (trusted only from cloudflared's address), body limits, and tokens
# kept out of the access log. Starts compose.yml under its own project name
# and removes it afterwards, also when a check fails.
#
#   bash deploy/test/nginx/run.sh                       # docker compose
#   COMPOSE=podman-compose bash deploy/test/nginx/run.sh
#
# Prints "nginx: all checks passed" on success; exits non-zero otherwise.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
deploy=$(cd "$here/../.." && pwd)
COMPOSE=${COMPOSE:-docker compose}
project=td-nginx-test

# One pin for the image: the production file's.
NGINX_IMAGE=$(sed -n 's|^[[:space:]]*image:[[:space:]]*\(docker.io/library/nginx:[^[:space:]]*\).*|\1|p' "$deploy/compose.yml" | head -n 1)
if [ -z "$NGINX_IMAGE" ]; then
	echo "nginx: no pinned nginx image found in deploy/compose.yml" >&2
	exit 1
fi
export NGINX_IMAGE

# $COMPOSE is deliberately unquoted: "docker compose" is two words.
# shellcheck disable=SC2086
compose() { $COMPOSE -p "$project" -f "$here/compose.yml" "$@"; }

cleanup() { compose down -v -t 1 >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT TERM
cleanup # a leftover from an interrupted run

# Without the config, Docker would create a directory where the file should be.
for file in nginx.conf proxy.conf; do
	if [ ! -f "$deploy/nginx/$file" ]; then
		echo "nginx: deploy/nginx/$file does not exist" >&2
		exit 1
	fi
done

compose up -d

failed=0
compose exec -T trusted node /check.mjs trusted || failed=1
compose exec -T outsider node /check.mjs outsider || failed=1

# Tokens stay out of the access log; ordinary requests are logged, with the
# visitor's address. The log can lag the request a little: wait for the last line.
logs=$(mktemp)
trap 'rm -f "$logs"; cleanup' EXIT
for _ in $(seq 1 40); do
	compose logs nginx >"$logs" 2>&1 || true
	grep -q 'GET /login' "$logs" && break
done

if grep -q 'GET /login' "$logs"; then
	echo "ok   access log has the /login request"
else
	echo "FAIL access log has no /login request"
	failed=1
fi
if grep 'GET /login' "$logs" | grep -q '203\.0\.113\.9'; then
	echo "ok   access log shows the visitor's address, not cloudflared's"
else
	echo "FAIL access log does not show the visitor's address (203.0.113.9)"
	failed=1
fi
if grep -q 'tok-canary-' "$logs"; then
	echo "FAIL a token reached the nginx logs:"
	grep 'tok-canary-' "$logs"
	failed=1
else
	echo "ok   no token in the nginx logs"
fi

if [ "$failed" -ne 0 ]; then
	echo "--- nginx log (tail) ---"
	tail -n 40 "$logs"
	echo "nginx: checks FAILED" >&2
	exit 1
fi

cleanup
trap - EXIT
rm -f "$logs"
echo "nginx: all checks passed"
