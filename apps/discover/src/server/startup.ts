import { definePlugin } from "nitro";
import { discoverConfig } from "../lib/config.ts";

/**
 * D11: the server reads and checks its settings when it starts, not on the
 * first request. Missing or malformed settings stop it at once with the
 * settings' names and rules (never a value), so a bad deploy restarts in a
 * loop that `docker compose ps` and the logs show, instead of a container
 * that looks healthy and answers 500. Then one line says what it serves.
 * Registered in vite.config.ts (`nitro({ plugins })`).
 */
export default definePlugin(() => {
	try {
		const config = discoverConfig();
		console.log(
			[
				"Discover started:",
				`site ${config.siteUrl},`,
				`API ${config.apiUrl},`,
				`Studio OS ${config.studioOsUrl},`,
				`indexing ${config.indexing ? "on" : "off"},`,
				`markets ${config.markets.join(",")} (default ${config.defaultCountry}),`,
				`geolocation ${config.geoHeader ? "on" : "off"},`,
				`server key ${config.serverKey ? "set" : "not set"}`,
			].join(" "),
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
});
