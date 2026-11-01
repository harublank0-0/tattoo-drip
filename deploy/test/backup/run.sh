#!/usr/bin/env bash
# Checks deploy/backup (the image and backup.sh) against a throwaway Postgres:
# the dump is readable, restores to the same row counts, old dumps are removed
# and others kept, every failure (bad config, refused login, truncated dump,
# unknown remote, failed listing, hung step) exits non-zero at the right step,
# with one failure line and one /fail ping and no success ping, and no secret
# reaches the output.
#
# Failures that cannot be caused from outside are injected with two stand-in
# scripts mounted over pg_dump and rclone in the test container only (they call
# the real tool, then misbehave as SHIM_MODE says); backup.sh has no test hooks.
#
# Everything runs in containers on a private network the engine numbers itself
# (no fixed subnet, so it cannot collide with the production stack's
# 172.30.42.0/24) and is removed afterwards, also when a check fails.
# The destination is a local path on a named volume (rclone accepts one); the
# real R2 remote is never used. The heartbeat is a stand-in HTTP listener
# (the pinned node image), never healthchecks.io.
#
#   bash deploy/test/backup/run.sh                    # docker
#   CONTAINER=podman bash deploy/test/backup/run.sh   # podman (dev machine)
#
# Prints "backup: all checks passed" on success; exits non-zero otherwise.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
deploy=$(cd "$here/../.." && pwd)
CONTAINER=${CONTAINER:-docker}
prefix=td-backup-test
net=$prefix-net
pg=$prefix-pg
hb=$prefix-hb
vol=$prefix-vol
img=$prefix-img
NODE_IMAGE=docker.io/library/node:24.3.0-bookworm-slim

# One pin for Postgres: the production file's. The backup image must use the
# same one, or pg_dump and the server drift apart.
PG_IMAGE=$(sed -n 's|^[[:space:]]*image:[[:space:]]*\(docker.io/library/postgres:[^[:space:]]*\).*|\1|p' "$deploy/compose.yml" | head -n 1)
if [ -z "$PG_IMAGE" ]; then
	echo "backup: no pinned postgres image found in deploy/compose.yml" >&2
	exit 1
fi

work=$(mktemp -d)
# Credentials only ever go through this file (mode 600), never the command line.
envfile=$work/db.env
outputs=$work/outputs
: >"$outputs"

remove_containers() {
	# One at a time: podman skips the rest of the list after a name that does not exist.
	"$CONTAINER" rm -f "$hb" >/dev/null 2>&1 || true
	"$CONTAINER" rm -f "$pg" >/dev/null 2>&1 || true
	"$CONTAINER" volume rm -f "$vol" >/dev/null 2>&1 || true
	"$CONTAINER" network rm "$net" >/dev/null 2>&1 || true
	"$CONTAINER" rmi -f "$img" >/dev/null 2>&1 || true
}
cleanup() {
	remove_containers
	rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
remove_containers # a leftover from an interrupted run

failed=0
ok() { echo "ok   $*"; }
bad() {
	echo "FAIL $*"
	failed=1
}
check() { # description, then a command; ok when it succeeds
	local description=$1
	shift
	if "$@" >/dev/null 2>&1; then ok "$description"; else bad "$description"; fi
}

# Same line, once in the Dockerfile and once in the compose file.
dockerfile_from=$(sed -n 's|^FROM[[:space:]]\{1,\}\([^[:space:]]*\).*|\1|p' "$deploy/backup/Dockerfile" 2>/dev/null | head -n 1 || true)

password=$(openssl rand -hex 16)
token=$(openssl rand -hex 8)
(
	umask 077
	{
		echo "POSTGRES_USER=postgres"
		echo "POSTGRES_PASSWORD=$password"
		echo "POSTGRES_DB=backup_src"
		echo "PGUSER=postgres"
		echo "PGPASSWORD=$password"
		echo "PGDATABASE=backup_src"
	} >"$envfile"
)

"$CONTAINER" network create "$net" >/dev/null

# --- Setup: a throwaway Postgres with two tables ---------------------------
"$CONTAINER" run -d --name "$pg" --network "$net" --network-alias postgres \
	--env-file "$envfile" "$PG_IMAGE" >/dev/null
# Over TCP: the image's temporary first server listens on the socket only.
ready=0
for _ in $(seq 1 120); do
	if "$CONTAINER" exec "$pg" pg_isready -h 127.0.0.1 -U postgres -d backup_src >/dev/null 2>&1; then
		ready=1
		break
	fi
	sleep 0.5
done
if [ "$ready" -ne 1 ]; then
	echo "backup: the throwaway postgres did not become ready" >&2
	"$CONTAINER" logs --tail 20 "$pg" >&2 || true
	exit 1
fi

psql_src() { "$CONTAINER" exec -i "$pg" psql -U postgres -v ON_ERROR_STOP=1 -At "$@"; }
psql_src -d backup_src >/dev/null <<'SQL'
create table clients (id serial primary key, name text not null, note text);
create table projects (id serial primary key, client_id int references clients (id), title text not null);
insert into clients (name, note) select 'client ' || n, 'caf' || chr(233) || ' ' || n from generate_series(1, 7) n;
insert into projects (client_id, title) select 1 + n % 7, 'project ' || n from generate_series(1, 23) n;
SQL

# --- Setup: the backup image ------------------------------------------------
if ! "$CONTAINER" build -t "$img" "$deploy/backup" >"$work/build.log" 2>&1; then
	echo "backup: the backup image did not build (deploy/backup):" >&2
	tail -n 15 "$work/build.log" >&2
	exit 1
fi
ok "backup image builds"

compose_pg_image=$PG_IMAGE
if [ "$dockerfile_from" = "$compose_pg_image" ]; then
	ok "Dockerfile starts FROM the same postgres pin as compose.yml ($compose_pg_image)"
else
	bad "Dockerfile starts FROM '$dockerfile_from', compose.yml pins '$compose_pg_image'"
fi

# The destination volume: owned by the job's user, like a real mount would be.
"$CONTAINER" volume create "$vol" >/dev/null
tool() { # run a command as root in the backup image, with the volume at /backups
	"$CONTAINER" run --rm --user 0 --network "$net" --env-file "$envfile" \
		-v "$vol:/backups" --entrypoint "$1" "$img" "${@:2}"
}
tool chown backupjob /backups

# The heartbeat stand-in: logs "hit <method> <path>" for each request, answers 200.
"$CONTAINER" run -d --name "$hb" --network "$net" --network-alias hb "$NODE_IMAGE" node -e '
const http = require("node:http");
http.createServer((req, res) => {
  console.log("hit " + req.method + " " + req.url);
  res.end("OK");
}).listen(8080, () => console.log("listening"));
' >/dev/null
for _ in $(seq 1 60); do
	"$CONTAINER" logs "$hb" 2>&1 | grep -q '^listening' && break
	sleep 0.5
done

# Stand-ins for pg_dump and rclone, mounted at /usr/local/bin (ahead of /usr/bin in PATH).
cat >"$work/shim-pg_dump" <<'SHIM'
#!/bin/sh
# SHIM_MODE=dump-hang: never finishes. truncate: dumps, then cuts the end off the file.
# backdate: dumps, then makes the file 40 days old.
if [ "${SHIM_MODE:-}" = dump-hang ]; then exec sleep 120; fi
/usr/bin/pg_dump "$@" || exit $?
for arg in "$@"; do
	case "$arg" in
	--file=*)
		[ "${SHIM_MODE:-}" != truncate ] || truncate --size=-64 "${arg#--file=}"
		[ "${SHIM_MODE:-}" != backdate ] || touch -d '40 days ago' "${arg#--file=}"
		;;
	esac
done
SHIM
cat >"$work/shim-rclone" <<'SHIM'
#!/bin/sh
# SHIM_MODE=lsf-fail: "rclone lsf" fails. copyto-hang: "rclone copyto" never finishes.
case "${SHIM_MODE:-}:$1" in
lsf-fail:lsf)
	echo "rclone: injected failure" >&2
	exit 3
	;;
copyto-hang:copyto) exec sleep 120 ;;
esac
exec /usr/bin/rclone "$@"
SHIM
chmod 755 "$work/shim-pg_dump" "$work/shim-rclone"
shims=(-v "$work/shim-pg_dump:/usr/local/bin/pg_dump:ro" -v "$work/shim-rclone:/usr/local/bin/rclone:ro")

# Runs the job once. Sets $out and $rc; the output is also kept for the secret scan.
# Extra arguments are passed to "run" (-e NAME=value).
run_backup() {
	local status=0
	out=$("$CONTAINER" run --rm --network "$net" --env-file "$envfile" \
		-v "$vol:/backups" "$@" "$img" 2>&1) || status=$?
	rc=$status
	printf '%s\n' "$out" >>"$outputs"
}
dumps() { tool find /backups/db -maxdepth 1 -type f -name '*.dump'; }
files() { tool find /backups/db -maxdepth 1 -type f; }

# Checks on the run just made ($rc, $out): it failed, once, at the given step, and said
# nothing that means success.
expect_failed_run() { # label, step
	local label=$1 step=$2 lines pattern
	if [ "$rc" -ne 0 ]; then ok "$label: non-zero exit ($rc)"; else bad "$label: exited 0"; fi
	lines=$(printf '%s\n' "$out" | grep -c '^backup: failed' || true)
	if [ "$lines" -eq 1 ]; then ok "$label: exactly one 'backup: failed' line"; else bad "$label: $lines 'backup: failed' lines"; fi
	if printf '%s\n' "$out" | grep -q "^backup: failed at step '$step' "; then
		ok "$label: failed at step '$step'"
	else
		bad "$label: did not fail at step '$step'"
	fi
	for pattern in 'backup: ok' 'heartbeat: ok'; do
		if printf '%s\n' "$out" | grep -q "^$pattern"; then bad "$label: '$pattern' was printed"; else ok "$label: no '$pattern' line"; fi
	done
}
# The heartbeat listener saw exactly one ping of <path>/fail and none of <path>.
expect_fail_ping_once() { # label, path
	local hits fails oks
	hits=$("$CONTAINER" logs "$hb" 2>&1)
	fails=$(printf '%s\n' "$hits" | grep -Fxc "hit GET $2/fail" || true)
	oks=$(printf '%s\n' "$hits" | grep -Fxc "hit GET $2" || true)
	if [ "$fails" -eq 1 ]; then ok "$1: one /fail ping"; else bad "$1: $fails /fail pings"; fi
	if [ "$oks" -eq 0 ]; then ok "$1: no success ping"; else bad "$1: $oks success pings"; fi
}

# --- Success case ------------------------------------------------------------
run_backup -e BACKUP_DEST=/backups/db -e "HEARTBEAT_URL=http://hb:8080/ok-$token"
if [ "$rc" -eq 0 ]; then ok "success run exits 0"; else bad "success run exited $rc"; fi
printf '%s\n' "$out" | sed 's/^/     | /'
last=$(printf '%s\n' "$out" | tail -n 1)
if printf '%s\n' "$last" | grep -Eq '^backup: ok tattoo_drip-[0-9]{8}T[0-9]{6}Z\.dump [0-9.]+[A-Za-z]*B$'; then
	ok "last line is 'backup: ok <file name> <size>'"
else
	bad "last line is not 'backup: ok <file name> <size>': $last"
fi
for step in 'dump: ok' 'verify: ok' 'upload: ok' 'retention: removed 0' 'heartbeat: ok'; do
	if printf '%s\n' "$out" | grep -q "^$step"; then ok "output has a '$step' line"; else bad "output has no '$step' line"; fi
done
count=$(dumps | wc -l)
if [ "$count" -eq 1 ]; then ok "exactly one .dump file"; else bad "expected one .dump file, found $count"; fi
first_name=$(dumps | head -n 1 | sed 's|.*/||')
if [ "tattoo_drip-${first_name#tattoo_drip-}" = "$first_name" ] && printf '%s\n' "$last" | grep -qF " $first_name "; then
	ok "the file name is the one the job reported"
else
	bad "the .dump file ($first_name) is not the one reported"
fi
check "pg_restore --list reads the dump" tool pg_restore --list "/backups/db/$first_name"
check "the dump is a custom-format archive" tool bash -c "head -c 5 '/backups/db/$first_name' | grep -q '^PGDMP'"
if "$CONTAINER" logs "$hb" 2>&1 | grep -Fxq "hit GET /ok-$token"; then
	ok "the heartbeat listener got the success ping"
else
	bad "the heartbeat listener got no success ping"
fi

# --- Restore case -------------------------------------------------------------
psql_src -d postgres -c 'create database restore_check' >/dev/null
if tool pg_restore --no-password --exit-on-error -h postgres -d restore_check "/backups/db/$first_name" >/dev/null 2>&1; then
	ok "pg_restore restores into restore_check"
else
	bad "pg_restore into restore_check failed"
fi
for table in clients projects; do
	source_count=$(psql_src -d backup_src -c "select count(*) from $table")
	restored_count=$(psql_src -d restore_check -c "select count(*) from $table" 2>/dev/null || echo missing)
	if [ "$source_count" = "$restored_count" ] && [ "$source_count" -gt 0 ]; then
		ok "$table: $source_count rows in both databases"
	else
		bad "$table: $source_count rows in backup_src, $restored_count in restore_check"
	fi
done
source_note=$(psql_src -d backup_src -c "select note from clients where id = 3")
restored_note=$(psql_src -d restore_check -c "select note from clients where id = 3" 2>/dev/null || echo missing)
if [ "$source_note" = "$restored_note" ]; then ok "non-ASCII text survives the round trip"; else bad "text differs after the restore"; fi

# --- Retention case -------------------------------------------------------------
# 40 days old: removed. 29 days old: kept. Not a dump: kept, however old. A dump in a
# subfolder: kept (only the folder itself is the job's).
tool bash -c "cd /backups/db \
	&& touch -d '40 days ago' tattoo_drip-20200101T000000Z.dump \
	&& touch -d '29 days ago' tattoo_drip-20200102T000000Z.dump \
	&& touch -d '40 days ago' notes.txt \
	&& mkdir -p sub && touch -d '40 days ago' sub/tattoo_drip-20200103T000000Z.dump \
	&& chown -R backupjob /backups"
sleep 1 # file names have a one-second resolution
run_backup -e BACKUP_DEST=/backups/db -e "HEARTBEAT_URL=http://hb:8080/ok-$token"
if [ "$rc" -eq 0 ]; then ok "second run exits 0"; else bad "second run exited $rc"; fi
if printf '%s\n' "$out" | grep -q '^retention: removed 1'; then ok "retention reports one removal"; else bad "retention does not report one removal"; fi
listing=$(files | sed 's|.*/||' | sort)
if printf '%s\n' "$listing" | grep -qx 'tattoo_drip-20200101T000000Z.dump'; then
	bad "the 40 day old dump is still there"
else
	ok "the 40 day old dump is gone"
fi
for kept in tattoo_drip-20200102T000000Z.dump notes.txt "$first_name"; do
	if printf '%s\n' "$listing" | grep -qx "$kept"; then ok "$kept stays"; else bad "$kept was removed"; fi
done
count=$(dumps | wc -l)
if [ "$count" -eq 3 ]; then ok "three dumps remain (two new, one 29 days old)"; else bad "expected three dumps, found $count"; fi
check "an old dump in a subfolder stays" tool test -f /backups/db/sub/tattoo_drip-20200103T000000Z.dump

# The dump just written is never removed, even when its modification time says it is old
# (a skewed clock): the stand-in backdates the file before it is uploaded.
sleep 1 # file names have a one-second resolution
run_backup -e BACKUP_DEST=/backups/db -e SHIM_MODE=backdate "${shims[@]}"
if [ "$rc" -eq 0 ]; then ok "backdated run exits 0"; else bad "backdated run exited $rc"; fi
backdated=$(printf '%s\n' "$out" | tail -n 1 | awk '{ print $3 }')
if printf '%s\n' "$out" | grep -q '^retention: removed 0'; then ok "retention removes nothing else"; else bad "retention removed something"; fi
check "the backdated dump just written stays ($backdated)" tool test -f "/backups/db/$backdated"

# --- Bad settings: refused at the setup step, and nothing is deleted ------------------
before=$(files | sort | md5sum)
for days in 0 abc; do
	run_backup -e BACKUP_DEST=/backups/db -e "BACKUP_KEEP_DAYS=$days"
	expect_failed_run "BACKUP_KEEP_DAYS='$days'" setup
done
if [ "$before" = "$(files | sort | md5sum)" ]; then ok "a refused run changes nothing in the destination"; else bad "a refused run changed the destination"; fi

# --- Failure cases ------------------------------------------------------------
# Unknown remote, heartbeat unreachable (nothing listens on port 9): the upload step fails.
run_backup -e BACKUP_DEST=nosuchremote:x -e HEARTBEAT_URL=http://127.0.0.1:9/hb
expect_failed_run "unknown remote, unreachable heartbeat" upload

# The same with a reachable heartbeat: one /fail ping, no success ping.
run_backup -e BACKUP_DEST=nosuchremote:x -e "HEARTBEAT_URL=http://hb:8080/f-upload-$token"
expect_failed_run "unknown remote" upload
expect_fail_ping_once "unknown remote" "/f-upload-$token"

# A refused database login fails the dump step and uploads nothing.
before=$(files | sort | md5sum)
run_backup -e BACKUP_DEST=/backups/db -e PGPASSWORD=not-the-password -e "HEARTBEAT_URL=http://hb:8080/f-dump-$token"
expect_failed_run "refused database login" dump
expect_fail_ping_once "refused database login" "/f-dump-$token"
if [ "$before" = "$(files | sort | md5sum)" ]; then ok "a failed dump uploads nothing"; else bad "a failed dump changed the destination"; fi

# A dump cut off in its data still lists fine; only reading it all catches it.
tool bash -c "cp /backups/db/$first_name /backups/cut.dump && truncate --size=-64 /backups/cut.dump"
check "a truncated dump still passes pg_restore --list (so --list alone is not enough)" tool pg_restore --list /backups/cut.dump
if tool pg_restore -f /dev/null /backups/cut.dump >/dev/null 2>&1; then
	bad "a full read of the truncated dump succeeded"
else
	ok "a full read of the truncated dump fails"
fi
tool rm -f /backups/cut.dump
before=$(files | sort | md5sum)
run_backup -e BACKUP_DEST=/backups/db -e SHIM_MODE=truncate -e "HEARTBEAT_URL=http://hb:8080/f-verify-$token" "${shims[@]}"
expect_failed_run "truncated dump" verify
expect_fail_ping_once "truncated dump" "/f-verify-$token"
if [ "$before" = "$(files | sort | md5sum)" ]; then ok "a truncated dump is not uploaded"; else bad "a truncated dump reached the destination"; fi

# A failure after the upload (the listing for retention): reported once, at its step.
run_backup -e BACKUP_DEST=/backups/db -e SHIM_MODE=lsf-fail -e "HEARTBEAT_URL=http://hb:8080/f-retention-$token" "${shims[@]}"
expect_failed_run "failed retention listing" retention
expect_fail_ping_once "failed retention listing" "/f-retention-$token"

# Hung steps are cut off by the timeouts (exit 124) instead of holding the container.
run_backup -e BACKUP_DEST=/backups/db -e SHIM_MODE=dump-hang -e BACKUP_DUMP_TIMEOUT=2s -e "HEARTBEAT_URL=http://hb:8080/f-hangdump-$token" "${shims[@]}"
expect_failed_run "hung dump" dump
if printf '%s\n' "$out" | grep -q "^backup: failed at step 'dump' (exit 124)"; then ok "hung dump: timed out (exit 124)"; else bad "hung dump: not a timeout"; fi
expect_fail_ping_once "hung dump" "/f-hangdump-$token"
run_backup -e BACKUP_DEST=/backups/db -e SHIM_MODE=copyto-hang -e BACKUP_UPLOAD_TIMEOUT=2s -e "HEARTBEAT_URL=http://hb:8080/f-hangup-$token" "${shims[@]}"
expect_failed_run "hung upload" upload
if printf '%s\n' "$out" | grep -q "^backup: failed at step 'upload' (exit 124)"; then ok "hung upload: timed out (exit 124)"; else bad "hung upload: not a timeout"; fi
expect_fail_ping_once "hung upload" "/f-hangup-$token"

ok_hits=$("$CONTAINER" logs "$hb" 2>&1 | grep -Fxc "hit GET /ok-$token" || true)
if [ "$ok_hits" -eq 2 ]; then ok "the success ping came once per successful run with a heartbeat (2)"; else bad "expected 2 success pings, found $ok_hits"; fi

# --- No secret in any output ----------------------------------------------------
if grep -Fq -e "$password" -e "$token" "$outputs"; then
	bad "a password or heartbeat token reached the job's output"
else
	ok "no password and no heartbeat token in any output"
fi

if [ "$failed" -ne 0 ]; then
	echo "--- last job output ---"
	printf '%s\n' "$out" | tail -n 20
	echo "backup: checks FAILED" >&2
	exit 1
fi

cleanup
trap - EXIT
echo "backup: all checks passed"
