import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { parseDiscoverConfig } from "./src/lib/config.ts";
import { BRAND_CACHE_CONTROL, SECURITY_HEADERS } from "./src/lib/headers.ts";

const config = defineConfig(({ command, isPreview }) => {
	// The dev server refuses to start with missing or malformed settings
	// (src/lib/config.ts). Builds and `vite preview` don't read them: they
	// are runtime settings, read again by the server on each request.
	if (command === "serve" && !isPreview) parseDiscoverConfig(process.env);
	return {
		resolve: { tsconfigPaths: true },
		plugins: [
			nitro({
				// D10: static files get the security headers here (src/lib/headers.ts;
				// Start's own responses get them from src/start.ts); the favicon and
				// brand mark are cached for a day (hashed /assets/* keep Start's
				// immutable year). Static files are also stored pre-compressed
				// (brotli, gzip) and served by Accept-Encoding.
				routeRules: {
					"/**": { headers: SECURITY_HEADERS },
					"/favicon.svg": { headers: { "cache-control": BRAND_CACHE_CONTROL } },
					"/brand/**": { headers: { "cache-control": BRAND_CACHE_CONTROL } },
				},
				compressPublicAssets: { gzip: true, brotli: true },
				// A path that can't be decoded is a 400, not a hung request.
				plugins: ["./src/server/malformed-path.ts"],
			}),
			tailwindcss(),
			tanstackStart(),
			viteReact(),
		],
	};
});

export default config;
