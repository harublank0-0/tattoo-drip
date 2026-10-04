import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Makes sure `uuidv7()` exists before any table uses it as a default.
 *
 * - Postgres 18+: built in, so nothing to do.
 * - Postgres 17 and older: enables the `pg_uuidv7` extension when the server
 *   offers it, and adds `public.uuidv7()` as a wrapper around its
 *   `uuid_generate_v7()`, so migrations can always call `uuidv7()`.
 * - Otherwise: stops with an error instead of failing later on a missing
 *   function.
 */
export default class extends BaseSchema {
	async up() {
		this.schema.raw(`
			DO $do$
			BEGIN
				IF to_regprocedure('uuidv7()') IS NOT NULL THEN
					RETURN;
				END IF;

				IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_uuidv7') THEN
					CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
					CREATE FUNCTION public.uuidv7() RETURNS uuid
						LANGUAGE sql VOLATILE
						AS $fn$ SELECT uuid_generate_v7() $fn$;
					RETURN;
				END IF;

				RAISE EXCEPTION 'uuidv7() is unavailable: use PostgreSQL 18 or newer, or install the pg_uuidv7 extension';
			END
			$do$;
		`);
	}

	/**
	 * Removes only the wrapper. The built-in function on Postgres 18 lives in
	 * pg_catalog and is untouched; the extension is left in place because
	 * other objects may depend on it.
	 */
	async down() {
		this.schema.raw("DROP FUNCTION IF EXISTS public.uuidv7()");
	}
}
