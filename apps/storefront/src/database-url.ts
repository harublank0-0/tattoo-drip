import { env } from "#/env";

export function getDatabaseUrl() {
	const databaseUrl = env.DATABASE_URL;

	if (!databaseUrl) {
		throw new Error("DATABASE_URL is required");
	}

	return databaseUrl;
}
