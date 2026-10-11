#!/bin/sh
# Runs once, when Postgres initializes an empty data volume: creates the
# restricted app role (see apps/platform/database/setup_roles.sql).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" \
  -v app_password="$APP_DB_PASSWORD" \
  -v owner_user="$POSTGRES_USER" \
  -f /opt/setup_roles.sql
