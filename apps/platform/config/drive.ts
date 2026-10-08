import app from "@adonisjs/core/services/app";
import { defineConfig, services } from "@adonisjs/drive";
import env from "#start/env";

/**
 * One disk per visibility. Store images through ImageService
 * (#modules/media/services/image_service), which picks the disk from the
 * image's purpose. Dev and tests use local folders served by the app;
 * production points both disks at R2 (TAT-27). Never deploy with these
 * local disks: a built app's root is build/, which each build replaces.
 *
 * URLs are absolute (APP_URL), so the storefront, on another origin, can
 * show the images.
 */
const root = (disk: string) =>
	app.inTest ? app.tmpPath("storage", disk) : app.makePath("storage", disk);

const driveConfig = defineConfig({
	default: "public",
	services: {
		public: services.fs({
			location: root("public"),
			appUrl: env.get("APP_URL"),
			visibility: "public",
			serveFiles: true,
			routeBasePath: "/uploads",
		}),
		/** Served only through signed URLs; anything else gets 401. */
		private: services.fs({
			location: root("private"),
			appUrl: env.get("APP_URL"),
			visibility: "private",
			serveFiles: true,
			routeBasePath: "/files",
		}),
	},
});

export default driveConfig;

declare module "@adonisjs/drive/types" {
	export interface DriveDisks extends InferDriveDisks<typeof driveConfig> {}
}
