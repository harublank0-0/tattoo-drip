import { defineConfig } from "@adonisjs/inertia";

const inertiaConfig = defineConfig({
	/**
	 * Encrypt the page props Inertia keeps in browser history. The guest
	 * pages clear the key (GuestMiddleware), so after logout Back can't show
	 * the previous user's pages and asks the server instead (TAT-82).
	 */
	encryptHistory: true,

	/**
	 * Server-side rendering options.
	 */
	ssr: {
		/**
		 * Toggle SSR mode for Inertia pages.
		 */
		enabled: false,

		/**
		 * Entry file used by the SSR server build.
		 */
		entrypoint: "inertia/ssr.tsx",
	},
});

export default inertiaConfig;
