import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { parseDiscoverConfig } from "./src/lib/config.ts";

const config = defineConfig(({ command, isPreview }) => {
	// The dev server refuses to start with missing or malformed settings
	// (src/lib/config.ts). Builds and `vite preview` don't read them: they
	// are runtime settings, read again by the server on each request.
	if (command === "serve" && !isPreview) parseDiscoverConfig(process.env);
	return {
		resolve: { tsconfigPaths: true },
		plugins: [nitro(), tailwindcss(), tanstackStart(), viteReact()],
	};
});

export default config;
