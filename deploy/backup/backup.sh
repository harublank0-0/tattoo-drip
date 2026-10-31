#!/usr/bin/env bash
# Nightly database backup: dump, check the dump, copy it off the server, drop old
# copies, ping a heartbeat. Configured by environment variables only; see
# deploy/env/backup.env.example for their meaning. Prints one line per step and
# never an environment value.
#
#   PGHOST (default postgres), PGUSER, PGPASSWORD, PGDATABASE   the database (read by pg_dump itself)
#   BACKUP_DEST        rclone path for the dumps, default r2:tattoo-drip-backups/db
#   BACKUP_KEEP_DAYS   days of dumps to keep, default 30
#   HEARTBEAT_URL      optional; pinged on success, and "<URL>/fail" on failure
#   RCLONE_CONFIG_R2_* the "r2" remote (rclone reads them from the environment)
set -euo pipefail
set -o errtrace

step=setup
work=

ping_fail() {
	[ -n "${HEARTBEAT_URL:-}" ] || return 0
	# Best effort, and short: a dead heartbeat service must not hold the failure up.
	curl -fsS -o /dev/null --max-time 10 --retry 2 "${HEARTBEAT_URL%/}/fail" >/dev/null 2>&1 || true
}

on_error() {
	local status=$?
	trap - ERR
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
pg_dump --format=custom --no-password --file="$file"
echo "dump: ok $(human "$(stat -c %s "$file")")"

step=verify
# Reading the archive's table of contents catches a truncated or empty dump.
pg_restore --list "$file" >/dev/null
echo "verify: ok"

step=upload
rclone copyto "$file" "$dest/$name"
echo "upload: ok"

step=retention
# Only this job's own files, and only past the age: a wrong BACKUP_DEST cannot reach other objects.
older=(--min-age "${keep_days}d" --include 'tattoo_drip-*.dump')
removed=$(rclone lsf "${older[@]}" "$dest" | wc -l)
rclone delete "${older[@]}" "$dest"
echo "retention: removed $removed older than ${keep_days}d"

size=$(human "$(stat -c %s "$file")")
rm -f "$file"

if [ -n "${HEARTBEAT_URL:-}" ]; then
	step=heartbeat
	curl -fsS -o /dev/null --max-time 10 --retry 3 "$HEARTBEAT_URL"
	echo "heartbeat: ok"
fi

step=done
echo "backup: ok $name $size"
