-- Creates the restricted app role and grants it what it needs. Run once per
-- database, as a superuser (see database/README.md, Operations), before the
-- first `pnpm migrate`. Safe to run again: it always puts the role back to
-- a login role with no special powers.
--
--   psql -v ON_ERROR_STOP=1 -d tattoo_drip \
--     -v app_user=tattoo_drip_app -v app_password=... -v owner_user=postgres \
--     -f database/setup_roles.sql
--
-- Role creation and grants stay out of migrations: they are infrastructure
-- and need privileges a managed Postgres owner role may not have.

\set ON_ERROR_STOP on

-- The ALTER ROLE below would strip a superuser of its powers.
SELECT :'app_user' = :'owner_user' AS same_role \gset
\if :same_role
  DO $$ BEGIN RAISE EXCEPTION 'app_user and owner_user must be different roles'; END $$;
\endif

SELECT format('CREATE ROLE %I LOGIN', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

ALTER ROLE :"app_user" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user')
\gexec

GRANT USAGE ON SCHEMA public TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_user";

-- Tables and sequences the owner creates later (every migration) are granted too.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
