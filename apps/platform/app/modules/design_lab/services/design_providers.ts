import BflProvider from "#modules/design_lab/providers/bfl_provider";
import PreviewProvider from "#modules/design_lab/providers/preview_provider";
import type { DesignProvider } from "#modules/design_lab/providers/types";
import { bflApiUrl, designLabSettings } from "#modules/design_lab/settings";
import env from "#start/env";

/**
 * The one way to reach the image provider (docs/design-lab.md). Resolved
 * from the container, so the tests swap in their fake
 * (tests/helpers/design_lab.ts) and no test ever reaches the network. The
 * API key is read here, on the server, and goes nowhere but the provider's
 * request headers.
 */
export default class DesignProviders {
	/** The configured provider, or null while the Design Lab is off. */
	current(): DesignProvider | null {
		const settings = designLabSettings();
		if (settings.provider === "preview") return new PreviewProvider();
		if (settings.provider !== "bfl") return null;
		const key = env.get("BFL_API_KEY");
		if (!key || !settings.model) return null;
		return new BflProvider({
			apiKey: key.release(),
			apiUrl: bflApiUrl(),
			model: settings.model,
		});
	}
}
