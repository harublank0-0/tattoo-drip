#!/usr/bin/env bash
# Nightly database backup: dump, check the dump, copy it off the server, drop old
# copies, ping a heartbeat. Configured by environment variables only; see
# deploy/env/backup.env.example for their meaning. Prints one line per step and
# never an environment value.
#
# A hung call must not hold the job (and the next night's) up forever, and systemd's
# TimeoutStartSec stops only the "docker compose run" client, not this container. So
# every external call runs under timeout(1): 90m covers pg_dump of a database far
# larger than the pilot's, 30m one upload. A timeout exits 124, which fails the step
# like any other error.
#
#   PGHOST (default postgres), PGUSER, PGPASSWORD, PGDATABASE   the database (read by pg_dump itself)
#   BACKUP_DEST        rclone path for the dumps, default r2:tattoo-drip-backups/db
#   BACKUP_KEEP_DAYS   days of dumps to keep, default 30
#   HEARTBEAT_URL      optional; pinged on success, and "<URL>/fail" on failure
#   BACKUP_DUMP_TIMEOUT    optional, default 90m: limit for pg_dump and for reading the dump back
#   BACKUP_UPLOAD_TIMEOUT  optional, default 30m: limit for each rclone call
#   RCLONE_CONFIG_R2_* the "r2" remote (rclone reads them from the environment)
set -euo pipefail
set -o errtrace

step=setup
work=
main_pid=$$

ping_fail() {
	[ -n "${HEARTBEAT_URL:-}" ] || return 0
	# Best effort, and short: a dead heartbeat service must not hold the failure up.
	curl -fsS -o /dev/null --max-time 10 --retry 2 "${HEARTBEAT_URL%/}/fail" >/dev/null 2>&1 || true
}

on_error() {
	local status=$?
	trap - ERR
	# A command substitution or a pipeline runs in a subshell that inherits this trap
	# (errtrace). It only hands the failure up; the main shell reports it, once.
	[ "$BASHPID" = "$main_pid" ] || exit "$status"
	echo "backup: failed at step '$step' (exit $status)" >&2
	ping_fail
	exit "$status"
}

cleanup() {
	[ -z "$work" ] || rm -rf "$work"
}

trap on_error ERR
trap cleanup EXIT

fail() { # message: a configuration error, reported like any failed step
	echo "backup: $*" >&2
	false
}

: "${PGHOST:=postgres}"
export PGHOST
[ -n "${PGUSER:-}" ] || fail "PGUSER is not set"
[ -n "${PGPASSWORD:-}" ] || fail "PGPASSWORD is not set"
[ -n "${PGDATABASE:-}" ] || fail "PGDATABASE is not set"
dest=${BACKUP_DEST:-r2:tattoo-drip-backups/db}
dest=${dest%/}
keep_days=${BACKUP_KEEP_DAYS:-30}
# Positive whole days: "0d" would match every file and empty the destination.
[[ $keep_days =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_KEEP_DAYS must be a whole number of days, 1 or more"
dump_timeout=${BACKUP_DUMP_TIMEOUT:-90m}
upload_timeout=${BACKUP_UPLOAD_TIMEOUT:-30m}

# A token limited to one bucket cannot create or look up buckets; rclone must not try.
export RCLONE_S3_NO_CHECK_BUCKET=true
# The remote comes from RCLONE_CONFIG_R2_*; an empty config file keeps rclone from
# warning on every call that it has none.
export RCLONE_CONFIG=/dev/null

name=tattoo_drip-$(date -u +%Y%m%dT%H%M%SZ).dump
work=$(mktemp -d)
file=$work/$name

human() { numfmt --to=iec-i --suffix=B "$1"; }

step=dump
timeout "$dump_timeout" pg_dump --format=custom --no-password --file="$file"
bytes=$(stat -c %s "$file")
size=$(human "$bytes")
echo "dump: ok $size"

step=verify
# Read the whole archive, not only its table of contents (pg_restore --list): a dump cut
# off in its data still lists fine. A bad dump must fail the night before it is uploaded.
timeout "$dump_timeout" pg_restore -f /dev/null "$file"
echo "verify: ok"

step=upload
timeout "$upload_timeout" rclone copyto "$file" "$dest/$name"
echo "upload: ok"

step=retention
# Only this job's own old dumps, directly in the destination folder: a wrong BACKUP_DEST
# cannot reach other objects or subfolders. The dump just written is never a candidate.
# One ordered list of --filter rules (rclone 1.60 warns that mixing --include and --exclude has no
# defined order): the first matching rule wins, so the exclude comes before the include.
old=(--max-depth 1 --min-age "${keep_days}d" --filter "- /$name" --filter '+ tattoo_drip-*.dump' --filter '- *')
timeout "$upload_timeout" rclone lsf --files-only "${old[@]}" "$dest" >"$work/old.list"
removed=$(wc -l <"$work/old.list")
timeout "$upload_timeout" rclone delete "${old[@]}" "$dest"
echo "retention: removed $removed older than ${keep_days}d"

rm -f "$file"

if [ -n "${HEARTBEAT_URL:-}" ]; then
	step=heartbeat
	curl -fsS -o /dev/null --max-time 10 --retry 3 "$HEARTBEAT_URL"
	echo "heartbeat: ok"
fi

step=done
echo "backup: ok $name $size"
