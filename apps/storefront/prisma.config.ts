import { defineConfig, env } from "prisma/config";

console.log({ env: env("DATABASE_URL") ?? "nooo" });
export default defineConfig({
	schema: "./prisma/schema.prisma",
	migrations: {
		path: "./prisma/migrations",
		seed: "tsx prisma/seed.ts",
	},
	datasource: {
		url: env("DATABASE_URL"),
	},
});
