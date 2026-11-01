#!/usr/bin/env bash
# The deploy command: build, migrate, restart. The owner runs it on the server,
# in the git clone of the repo (/srv/tattoo-drip/app):
#
#   deploy/deploy.sh                 # deploy origin/main
#   deploy/deploy.sh <commit|tag>    # deploy that one; going back is the same command
#   deploy/deploy.sh "$(cat /srv/tattoo-drip/deployed)"   # the last successful release
#
# Steps:
#   1. refuse while the checkout has local changes
#   2. refuse while the settings are missing, unreadable or unfinished (CHANGE_ME left in
#      an env file), or the release record (below) cannot be read or written
#   3. git fetch origin, check out the requested commit (detached)
#   4. build the web, storefront and backup images (worker and migrate share web's image)
#   5. start postgres and wait for it to be healthy (60 s)
#   6. run the migrations; if they fail, stop: the old app containers are still serving
#   7. recreate web, worker, storefront, nginx and cloudflared with the new images
#   8. wait for web and storefront to be healthy (120 s), then reload nginx
#   9. record the commit in TD_STATE_DIR/deployed, print what is running,
#      "deployed <short sha>" and the release before it, then delete dangling images
#      (never volumes)
#
# Steps 1 and 2 come before anything touches git or the containers, so they can be
# tried safely (a scratch TD_ENV_DIR with copies of deploy/env/*.env.example shows both
# refusals). Migrations are additive by convention, so after going back to an older
# commit the older code runs on the newer schema.
#
# The release record, TD_STATE_DIR/deployed, holds one line: the full sha of the last
# deploy that got through every step. Only step 9 writes it, so a failed deploy leaves
# it as it was, while the checkout (HEAD) already names the failed commit. A failure
# after step 3 says "to go back: deploy/deploy.sh <that sha>"; before the first
# successful deploy there is no record, and it names the commit the checkout was on
# before this run instead (and says so).
#
# The script is read by bash while it runs, and step 3 replaces files in the checkout,
# deploy.sh included. So all of it sits in main(), which bash reads whole before running
# it. One consequence: a deploy runs the deploy.sh it started with, so a change to this
# file takes effect from the next deploy on.
#
# Settings (environment variables):
#   COMPOSE           compose command, default "docker compose" (podman-compose works too)
#   CONTAINER         container engine that matches it, used to read the containers' health
#                     and to delete dangling images;
#                     default: the first word of COMPOSE without "-compose" ("docker",
#                     "podman")
#   TD_ENV_DIR        absolute path of the env files, default /srv/tattoo-drip/env;
#                     compose reads the same variable (deploy/compose.yml)
#   TD_COMPOSE_FILES  colon-separated compose files, default deploy/compose.yml; relative
#                     entries are relative to the repo root. Compose gets them as absolute
#                     paths (podman-compose cannot handle relative ones).
#   TD_STATE_DIR      absolute path of the folder that holds the release record
#                     ("deployed"), default /srv/tattoo-drip
#
# Never prints an env value: the settings checks name files and variable names only.
set -euo pipefail

# Where deploy/compose.yml mounts deploy/nginx and starts nginx from (its "command").
NGINX_CONF=/etc/nginx/td/nginx.conf

main() {
	local root ref sha envdir statedir entry file name out keys rc first had_record=
	local -a entries=() missing=() unreadable=() unfinished=()

	root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
	cd "$root"

	COMPOSE=${COMPOSE:-docker compose}
	if [ -z "${CONTAINER:-}" ]; then
		first=${COMPOSE%% *}
		first=${first##*/}
		CONTAINER=${first%-compose}
	fi
	ref=${1:-origin/main}
	case $ref in
	-*) fail "usage: deploy/deploy.sh [commit|tag|origin/branch]   (default origin/main)" ;;
	esac
	envdir=${TD_ENV_DIR:-/srv/tattoo-drip/env}
	export TD_ENV_DIR=$envdir
	statedir=${TD_STATE_DIR:-/srv/tattoo-drip}
	DEPLOYED=$statedir/deployed

	case $envdir in
	/*) ;;
	*) fail "TD_ENV_DIR must be an absolute path (it is '$envdir')" ;;
	esac
	case $statedir in
	/*) ;;
	*) fail "TD_STATE_DIR must be an absolute path (it is '$statedir')" ;;
	esac

	IFS=: read -ra entries <<<"${TD_COMPOSE_FILES:-deploy/compose.yml}"
	COMPOSE_FILE_ARGS=()
	for entry in "${entries[@]}"; do
		[ -n "$entry" ] || continue
		case $entry in
		/*) file=$entry ;;
		*) file=$root/$entry ;;
		esac
		[ -f "$file" ] || fail "compose file $file does not exist"
		COMPOSE_FILE_ARGS+=(-f "$file")
	done
	[ "${#COMPOSE_FILE_ARGS[@]}" -gt 0 ] || fail "TD_COMPOSE_FILES names no compose file"

	# The last error of the health polling (wait_healthy shows it when the wait fails).
	HEALTH_ERR=$(mktemp)
	trap 'rm -f "$HEALTH_ERR"' EXIT

	# 1. A deploy must be exactly a commit: local edits would be deployed unseen, or in
	# the way of the checkout.
	if [ -n "$(git status --porcelain)" ]; then
		git status --short >&2
		fail "the checkout has local changes (listed above); commit, stash or discard them first"
	fi

	# 2. The settings. Every role has its own file (deploy/compose.yml, deploy/env/*.env.example).
	# Comment lines do not count: the templates mention CHANGE_ME in their own comments.
	for name in postgres platform migrate storefront backup tunnel; do
		[ -f "$envdir/$name.env" ] || missing+=("$envdir/$name.env")
	done
	for file in "$envdir"/*.env; do
		[ -f "$file" ] || continue
		# Tested first: awk's exit code on an unreadable file differs between awks.
		if [ ! -r "$file" ]; then
			unreadable+=("$file")
			continue
		fi
		# awk: 0 = a placeholder is left, 1 = none, anything else = it failed.
		rc=0
		awk '!/^[ \t]*#/ && /CHANGE_ME/ { found = 1 } END { exit !found }' "$file" 2>/dev/null || rc=$?
		case $rc in
		0) unfinished+=("$file") ;;
		1) ;;
		*) unreadable+=("$file") ;;
		esac
	done
	if [ "${#missing[@]}" -gt 0 ] || [ "${#unreadable[@]}" -gt 0 ] || [ "${#unfinished[@]}" -gt 0 ]; then
		for file in "${missing[@]}"; do
			echo "deploy: missing settings file $file" >&2
		done
		for file in "${unreadable[@]}"; do
			echo "deploy: cannot read settings file $file" >&2
		done
		for file in "${unfinished[@]}"; do
			keys=$(placeholder_keys "$file")
			echo "deploy: $file still has CHANGE_ME${keys:+ in:$keys}" >&2
		done
		fail "fix the settings files above (templates: deploy/env/*.env.example); nothing was changed"
	fi

	# The release record: what "to go back" names, and where step 9 writes. Checked here,
	# so a deploy that could not record its success never starts.
	[ -d "$statedir" ] && [ -w "$statedir" ] ||
		fail "the folder for the release record, $statedir (TD_STATE_DIR), is missing or not writable; nothing was changed"
	if [ -e "$DEPLOYED" ]; then
		[ -f "$DEPLOYED" ] && [ -r "$DEPLOYED" ] ||
			fail "cannot read the release record $DEPLOYED; nothing was changed"
		PREV_SHA=$(head -n 1 "$DEPLOYED")
		[[ $PREV_SHA =~ ^[0-9a-f]{40}$ ]] ||
			fail "$DEPLOYED does not hold one full commit sha; put back the sha of the release that is running (or delete the file); nothing was changed"
		say "last successful deploy: $PREV_SHA ($DEPLOYED)"
		had_record=1
	else
		PREV_SHA=$(git rev-parse HEAD)
		say "no successful deploy recorded yet ($DEPLOYED); \"to go back\" names the commit the checkout is on now, $PREV_SHA"
	fi

	# 3. The requested commit.
	say "checkout is at: $(git log -1 --format='%h %s')"
	say "fetching origin"
	git fetch origin || fail "git fetch origin failed (network, or the deploy key?); nothing was changed"
	git rev-parse --verify --quiet "$ref^{commit}" >/dev/null || fail "'$ref' is not a commit, tag or origin branch"
	git checkout --quiet --detach "$ref"
	say "commit: $(git log -1 --format='%h %s')"

	# 4. Images. The "tools" profile is for backup, which is not otherwise built (docker
	# compose run does not rebuild an existing image, so a changed backup.sh would never
	# reach the nightly job).
	say "building images"
	compose --profile tools build web storefront backup || fail "the build failed; nothing was restarted (the checkout is on the new commit; to go back: deploy/deploy.sh $PREV_SHA)"

	# 5. The database first: the migrations need it, and web and worker wait for it.
	say "starting postgres"
	compose up -d postgres || fail "postgres could not be started; the app containers were not restarted (to go back: deploy/deploy.sh $PREV_SHA)"
	wait_healthy 60 postgres || fail "postgres is not healthy, so the migrations did not run; the app containers were not restarted (to go back: deploy/deploy.sh $PREV_SHA)"

	# 6. Migrations, before the new code starts. The old containers keep serving while
	# they run, which is why they must stay compatible with the new schema.
	say "running migrations"
	if ! compose --profile tools run --rm -T migrate; then
		echo "deploy: the migrations failed. The app containers (web, worker, storefront, nginx, cloudflared)" >&2
		echo "deploy: were not restarted and still serve the old code; postgres may have been (re)started." >&2
		echo "deploy: fix the cause and run this again. The checkout is on the new commit;" >&2
		echo "deploy: to go back: deploy/deploy.sh $PREV_SHA" >&2
		exit 1
	fi

	# 7. Recreate what changed.
	say "restarting services"
	if ! compose up -d --remove-orphans web worker storefront nginx cloudflared; then
		compose ps >&2 || true
		show_logs web storefront
		fail_started "starting the services failed"
	fi

	# 8. Reload nginx once both are up, so it picks up a config this commit changed (web and
	# storefront have fixed addresses, so a recreated container needs no reload).
	# -c: deploy/compose.yml starts nginx from the mounted directory, not the image's file.
	say "waiting for web and storefront"
	wait_healthy 120 web storefront || fail_started "web or storefront is not healthy"
	say "reloading nginx"
	if ! out=$(compose exec -T nginx nginx -c "$NGINX_CONF" -t 2>&1); then
		echo "$out" >&2
		fail_started "nginx does not accept its configuration, so it keeps serving the old configuration"
	fi
	compose exec -T nginx nginx -c "$NGINX_CONF" -s reload || fail_started "nginx could not be reloaded"

	# 9. Recorded only now, when every step got through (written whole, then renamed over
	# the old record, so it is never half a line).
	sha=$(git rev-parse HEAD)
	if ! { printf '%s\n' "$sha" >"$DEPLOYED.tmp" && mv -f "$DEPLOYED.tmp" "$DEPLOYED"; }; then
		fail "$sha is running, but recording it in $DEPLOYED failed; write that sha into the file yourself"
	fi
	compose ps
	echo "deployed $(git rev-parse --short HEAD)"
	if [ -n "$had_record" ] && [ "$PREV_SHA" != "$sha" ]; then
		say "to go back to the release before: deploy/deploy.sh $PREV_SHA"
	fi

	# The images this build replaced are left untagged ("dangling"): delete them, or they
	# fill the disk deploy by deploy. Never volumes (the database is one). The build cache
	# stays, so going back still builds fast.
	$CONTAINER image prune -f >/dev/null || say "could not delete the old images (harmless; see README 8.3)"
}

say() { echo "deploy: $*"; }

fail() {
	echo "deploy: $*" >&2
	exit 1
}

# A failure once the new containers were started: say what state that leaves.
fail_started() {
	echo "deploy: $*" >&2
	echo "deploy: the new containers may be running, healthy or not, and nginx was not reloaded." >&2
	echo "deploy: to go back: deploy/deploy.sh $PREV_SHA" >&2
	exit 1
}

# The compose command with the stack's files. $COMPOSE is deliberately unquoted:
# "docker compose" is two words.
# shellcheck disable=SC2086
compose() { $COMPOSE "${COMPOSE_FILE_ARGS[@]}" "$@"; }

# The names (never the values) of the variables in a file that still hold CHANGE_ME,
# each with a leading space.
placeholder_keys() {
	sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*CHANGE_ME.*/ \2/p' "$1" | tr -d '\n'
}

# One "<service> <health>" line per container of the stack. The project's own
# listing (ps -q) names the containers, and their compose labels name the services, so
# this does not depend on how the engine names containers ("<project>-<service>-1" for
# docker compose, "<project>_<service>_1" for podman-compose). A container without a
# healthcheck has an empty health. Errors go to $HEALTH_ERR, not away.
health_lines() {
	local ids
	: >"$HEALTH_ERR"
	ids=$(compose ps -q 2>>"$HEALTH_ERR") || return 0
	[ -n "$ids" ] || return 0
	# $ids is one container id per line, wanted as separate words.
	# shellcheck disable=SC2086
	$CONTAINER inspect --format '{{index .Config.Labels "com.docker.compose.service"}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' $ids 2>>"$HEALTH_ERR" || true
}

# wait_healthy <seconds> <service>...: returns 0 when every service has a healthy
# container. Returns 1, after saying why and showing the services' logs, when one
# reports unhealthy (at once) or they are still not healthy after the time.
wait_healthy() {
	local limit=$1 deadline service lines reason
	local -a pending unhealthy
	shift
	deadline=$((SECONDS + limit))
	while :; do
		lines=$(health_lines)
		pending=()
		unhealthy=()
		for service in "$@"; do
			grep -qx "$service healthy" <<<"$lines" && continue
			pending+=("$service")
			if grep -qx "$service unhealthy" <<<"$lines"; then
				unhealthy+=("$service")
			fi
		done
		[ "${#pending[@]}" -eq 0 ] && return 0
		if [ "${#unhealthy[@]}" -gt 0 ]; then
			reason="${unhealthy[*]} reported unhealthy"
			break
		fi
		if [ "$SECONDS" -ge "$deadline" ]; then
			reason="not healthy after ${limit}s: ${pending[*]}"
			break
		fi
		sleep 2
	done
	echo "deploy: $reason" >&2
	if [ -s "$HEALTH_ERR" ]; then
		echo "deploy: last error while reading the containers' health:" >&2
		tail -n 5 "$HEALTH_ERR" >&2
	fi
	compose ps >&2 || true
	show_logs "${pending[@]}"
	return 1
}

# The last lines of each service's log, to say why it is not up.
show_logs() {
	local service
	for service in "$@"; do
		echo "--- $service log (tail) ---" >&2
		compose logs --tail 20 "$service" >&2 || true
	done
}

# One line: bash must not read on from the file after main returns (see the top).
main "$@"; exit
