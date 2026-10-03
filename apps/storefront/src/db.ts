import { PrismaPg } from "@prisma/adapter-pg";

import { getDatabaseUrl } from "./database-url.js";
import { PrismaClient } from "./generated/prisma/client.js";

const adapter = new PrismaPg({
	connectionString: getDatabaseUrl(),
});

declare global {
	var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
	globalThis.__prisma = prisma;
}
