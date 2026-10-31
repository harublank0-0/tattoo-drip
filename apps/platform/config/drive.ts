import app from "@adonisjs/core/services/app";
import { defineConfig, services } from "@adonisjs/drive";
import {
	checkStorageSettings,
	r2DiskOptions,
} from "#services/storage_settings";
import env from "#start/env";

/**
 * One disk per visibility. Store images through ImageService
 * (#modules/media/services/image_service), which picks the disk from the
 * image's purpose. With the six R2_* settings (TAT-27; production requires
 * them, start/env.ts) both disks are R2 buckets: the public one is served
 * from the media origin, the private one through signed URLs. With none
 * (development and tests) they are local folders served by the app. Never
 * deploy with the local disks: a built app's root is build/, which each
 * build replaces.
 *
 * Local URLs are absolute (APP_URL), so the storefront, on another origin,
 * can show the images; R2's are absolute by nature.
 */
const root = (disk: string) =>
	app.inTest ? app.tmpPath("storage", disk) : app.makePath("storage", disk);

/** The checked settings, never the raw ones: trimmed, the public URL normalized. */
const storage = checkStorageSettings(
	{
		R2_ACCOUNT_ID: env.get("R2_ACCOUNT_ID"),
		R2_ACCESS_KEY_ID: env.get("R2_ACCESS_KEY_ID"),
		R2_SECRET_ACCESS_KEY: env.get("R2_SECRET_ACCESS_KEY")?.release(),
		R2_PUBLIC_BUCKET: env.get("R2_PUBLIC_BUCKET"),
		R2_PRIVATE_BUCKET: env.get("R2_PRIVATE_BUCKET"),
		R2_PUBLIC_URL: env.get("R2_PUBLIC_URL"),
	},
	env.get("NODE_ENV") === "production",
);

/** A disk on R2 or, without the settings, in a local folder served by the app. */
const disk = (visibility: "public" | "private", routeBasePath: string) =>
	storage.kind === "r2"
		? services.s3(r2DiskOptions(storage, visibility))
		: services.fs({
				location: root(visibility),
				appUrl: env.get("APP_URL"),
				visibility,
				serveFiles: true,
				routeBasePath,
			});

const driveConfig = defineConfig({
	/** Private by default: a write that forgets its disk is never published. */
	default: "private",
	services: {
		public: disk("public", "/uploads"),
		/** Local: served only through signed URLs; anything else gets 401. */
		private: disk("private", "/files"),
	},
});

export default driveConfig;

declare module "@adonisjs/drive/types" {
	export interface DriveDisks extends InferDriveDisks<typeof driveConfig> {}
}
