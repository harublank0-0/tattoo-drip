/**
 * Connection pools (TAT-38), sized for the process. Every authenticated
 * request and every public tenant request holds one `pg` connection for its
 * whole length (its transaction), so the web server's pool is explicit:
 * public API writes take at most 4 of its 10 (#services/write_slots), the
 * dashboard and reads keep the rest. A request that waits 10 s for a
 * connection fails (knex's default is 60 s: requests would pile up for a
 * minute); on the API that is 503 service_busy. Ace commands (the worker
 * runs 5 jobs at once) need fewer. Count every process's pools in the
 * database's max_connections (docs/deploy.md). Imports nothing from the app:
 * config/database.ts reads it at boot.
 */
export function pgPoolFor(environment: string) {
	return environment === "console"
		? { min: 0, max: 6, acquireTimeoutMillis: 10_000 }
		: { min: 2, max: 10, acquireTimeoutMillis: 10_000 };
}

/** The limiter's own small pool (TAT-65): it counts while a request holds a `pg` connection. */
export const LIMITER_POOL = {
	min: 0,
	max: 4,
	acquireTimeoutMillis: 5_000,
} as const;
