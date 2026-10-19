import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { parseStorefrontConfig } from "./src/tenancy/config.ts";

const config = defineConfig(({ command, isPreview }) => {
	// The dev server refuses to start without API_URL and STOREFRONT_URL
	// (TAT-12). Builds and `vite preview` (which reports "serve" too, but
	// doesn't load .env.local) don't read them: they are runtime settings.
	if (command === "serve" && !isPreview) parseStorefrontConfig(process.env);
	return {
		resolve: { tsconfigPaths: true },
		plugins: [
			devtools(),
			nitro({ rollupConfig: { external: [/^@sentry\//] } }),
			tailwindcss(),
			tanstackStart(),
			viteReact(),
			babel({ presets: [reactCompilerPreset()] }),
		],
	};
});

export default config;
