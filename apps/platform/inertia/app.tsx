import "./css/app.css";
import { resolvePageComponent } from "@adonisjs/inertia/helpers";
import { TuyauProvider } from "@adonisjs/inertia/react";
import { createInertiaApp, type ResolvedComponent } from "@inertiajs/react";
import { createRoot } from "react-dom/client";
import { client } from "./client";

const appName = import.meta.env.VITE_APP_NAME || "Tattoo Drip";

createInertiaApp({
	title: (title) => (title ? `${title} - ${appName}` : appName),
	resolve: async (name) => {
		const page = await resolvePageComponent(
			`./pages/${name}.tsx`,
			import.meta.glob<{ default: ResolvedComponent }>("./pages/**/*.tsx"),
		);
		return page.default;
	},
	setup({ el, App, props }) {
		createRoot(el).render(
			<TuyauProvider client={client}>
				<App {...props} />
			</TuyauProvider>,
		);
	},
	progress: {
		color: "var(--primary)",
	},
});

// The installed app's service worker (TAT-67): production builds only, so
// it never caches anything around Vite's dev server.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(() => {});
	});
}
