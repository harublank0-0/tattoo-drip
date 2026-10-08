import adonisjs from "@adonisjs/vite/client";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		adonisjs({
			entryPoints: ["inertia/app.tsx"],
			reload: ["resources/views/**/*.edge"],
		}),
	],

	/**
	 * Define aliases for importing modules from
	 * your frontend code
	 */
	resolve: {
		alias: {
			"~/": `${import.meta.dirname}/inertia/`,
			"@generated": `${import.meta.dirname}/.adonisjs/client/`,
		},
	},

	server: {
		watch: {
			ignored: ["**/storage/**", "**/tmp/**"],
		},
		/**
		 * The dev server serves files from the app folder. Keep Vite's
		 * defaults and add uploaded files: private ones must only be
		 * reachable through signed /files URLs.
		 */
		fs: {
			deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/storage/**"],
		},
	},
});
