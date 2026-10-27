import { readdir } from "node:fs/promises";
import app from "@adonisjs/core/services/app";

const UPLOADS = app.tmpPath("storage", "uploads");

/** The temp files in tmp/storage/uploads now, where tests' uploads go (config/bodyparser.ts). */
export async function tempUploads(): Promise<Set<string>> {
	return new Set(await readdir(UPLOADS).catch(() => [] as string[]));
}

/** Temp files that appeared since `before`: what a request left behind. */
export async function newTempUploads(before: Set<string>): Promise<string[]> {
	return [...(await tempUploads())].filter((name) => !before.has(name));
}

/** The reference image files stored for `tenant` on the private test disk. */
export function storedReferenceImages(tenant: {
	id: string;
}): Promise<string[]> {
	return readdir(
		app.tmpPath("storage", "private", "tenants", tenant.id, "reference_image"),
	).catch(() => [] as string[]);
}

/**
 * The files stored for `tenant` under one image purpose on a test disk (the
 * image and its copies), sorted; [] when there are none (TAT-116). The
 * public disk is the default.
 */
export async function storedImages(
	tenant: { id: string },
	purpose: string,
	visibility: "public" | "private" = "public",
): Promise<string[]> {
	const folder = app.tmpPath(
		"storage",
		visibility,
		"tenants",
		tenant.id,
		purpose,
	);
	return (await readdir(folder).catch(() => [] as string[])).sort();
}
