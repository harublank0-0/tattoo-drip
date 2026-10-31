#!/bin/sh
# Runs once, after 10-setup-roles.sh, when Postgres initializes an empty data
# volume: the app role's idle_in_transaction_session_timeout, above the slowest
# request (apps/platform/docs/deploy.md, Database).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" <<'SQL'
ALTER ROLE :"app_user" SET idle_in_transaction_session_timeout = '3min';
SQL
