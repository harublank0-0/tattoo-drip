import "./css/app.css";
import { resolvePageComponent } from "@adonisjs/inertia/helpers";
import { TuyauProvider } from "@adonisjs/inertia/react";
import {
	createInertiaApp,
	type ResolvedComponent,
	router,
} from "@inertiajs/react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { client } from "./client";
import { watchVisits } from "./components/visits";

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

// The dashboard's visit rules (TAT-84), installed once for every layout: a visit the network cut
// off says so (the toasts render in each layout's FlashToasts).
watchVisits(
	// Inertia's `router.on` is generic per event name; the narrowed union is the same call.
	(type, callback) => router.on(type as "finish", callback as never),
	document,
	(text) => toast.error(text),
);

// The installed app's service worker (TAT-67): production builds only, so
// it never caches anything around Vite's dev server.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(() => {});
	});
}
