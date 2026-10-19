import app from "@adonisjs/core/services/app";
import { defineConfig } from "@adonisjs/lucid";
import env from "#start/env";

const dbConfig = defineConfig({
	/**
	 * Default connection used for all queries.
	 */
	connection: "pg",

	connections: {
		/**
		 * PostgreSQL connection. Local defaults match the root docker-compose.yml.
		 */
		pg: {
			client: "pg",
			connection: {
				host: env.get("DB_HOST"),
				port: env.get("DB_PORT"),
				user: env.get("DB_USER"),
				password: env.get("DB_PASSWORD"),
				database: env.get("DB_DATABASE"),
			},
			migrations: {
				/**
				 * Sort migration files naturally by filename.
				 */
				naturalSort: true,

				/**
				 * Paths containing migration files.
				 */
				paths: ["database/migrations"],
			},
			schemaGeneration: {
				enabled: true,
				rulesPaths: ["./database/schema_rules.js"],
			},
			debug: app.inDev,
		},

		/**
		 * The rate limiter's own small pool, same app role as `pg`. A public
		 * request holds a `pg` connection in its transaction while the limiter
		 * counts it; with the counter on that same pool, enough concurrent
		 * requests would each wait for a second connection the others hold
		 * (config/limiter.ts). Connections open on first use.
		 */
		limiter: {
			client: "pg",
			connection: {
				host: env.get("DB_HOST"),
				port: env.get("DB_PORT"),
				user: env.get("DB_USER"),
				password: env.get("DB_PASSWORD"),
				database: env.get("DB_DATABASE"),
			},
			pool: { min: 0, max: 4 },
		},

		/**
		 * The owner role: owns the tables and runs migrations (pnpm migrate).
		 * Never the default connection, or RLS would silently not apply.
		 */
		owner: {
			client: "pg",
			connection: {
				host: env.get("DB_HOST"),
				port: env.get("DB_PORT"),
				user: env.get("DB_MIGRATION_USER"),
				password: env.get("DB_MIGRATION_PASSWORD"),
				database: env.get("DB_DATABASE"),
			},
			migrations: {
				naturalSort: true,
				paths: ["database/migrations"],
			},
			schemaGeneration: {
				enabled: true,
				rulesPaths: ["./database/schema_rules.js"],
			},
			debug: app.inDev,
		},
	},
});

export default dbConfig;
