#!/usr/bin/env bash
# Checks deploy/nginx against stand-in upstreams: host routing, the visitor's
# address (trusted only from cloudflared's address), body limits, and tokens
# kept out of the access log. Starts compose.yml under its own project name
# and removes it afterwards, also when a check fails.
#
# It uses the production subnet, 172.30.42.0/24, because the addresses are part
# of what it checks: it cannot run on a host where the production stack (or
# anything else on that subnet) is up.
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

# The directory is mounted whole; a missing file would otherwise only show up as an
# nginx that cannot start.
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

# The static values, read back from the running nginx (nginx -T prints the
# whole configuration, includes too). Whole lines, so a comment cannot match.
logs=$(mktemp)
conf=$(mktemp)
trap 'rm -f "$logs" "$conf"; cleanup' EXIT
# -c: the stack's config, not the image's default one at /etc/nginx/nginx.conf.
if compose exec -T nginx nginx -c /etc/nginx/td/nginx.conf -T >"$conf" 2>&1; then
	echo "ok   nginx -T accepts the configuration"
else
	echo "FAIL nginx -T rejects the configuration"
	failed=1
fi
expect_lines() { # directive (without its ;), expected number of lines
	local found
	found=$(sed 's/^[[:space:]]*//; s/[[:space:]]*$//' "$conf" | grep -Fxc "$1;" || true)
	if [ "$found" = "$2" ]; then
		echo "ok   nginx -T: $1 ($found)"
	else
		echo "FAIL nginx -T: expected $2 line(s) '$1;', found $found"
		failed=1
	fi
}
expect_lines 'client_max_body_size 21m' 1
expect_lines 'client_header_timeout 15s' 1
expect_lines 'client_body_timeout 30s' 1
expect_lines 'send_timeout 30s' 1
expect_lines 'proxy_read_timeout 130s' 1
expect_lines 'proxy_connect_timeout 3s' 1
expect_lines 'proxy_request_buffering on' 1
expect_lines 'keepalive_timeout 4s' 2 # one in each upstream
expect_lines 'server 172.30.42.11:3333' 1 # web, by its fixed address (deploy/compose.yml)
expect_lines 'server 172.30.42.12:3000' 1 # storefront

# Tokens stay out of the access log; ordinary requests are logged, with the
# visitor's address. The log can lag the request a little: wait for the last line.
for _ in $(seq 1 40); do
	compose logs nginx >"$logs" 2>&1 || true
	grep -q 'GET /login' "$logs" && break
	sleep 0.25
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
rm -f "$logs" "$conf"
echo "nginx: all checks passed"
