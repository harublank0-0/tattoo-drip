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
	},
});

export default dbConfig;
