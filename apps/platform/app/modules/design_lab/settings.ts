import app from "@adonisjs/core/services/app";
import {
	DEFAULT_BFL_API_URL,
	type DesignLabProvider,
	designLabProvider,
} from "#services/design_lab_settings";
import env from "#start/env";

export type DesignLabSettings = {
	provider: DesignLabProvider;
	/** The model id recorded on each generation: BFL_MODEL, or the preview's. */
	model: string;
	monthlyLimit: number;
	maxVariations: number;
	creditsPerImage: number | null;
};

/** The model name the preview provider records. */
export const PREVIEW_MODEL = "local-preview";

/**
 * AI Design Lab's settings in effect, read on every call (a test may change
 * one with env.set). Never includes the API key.
 */
export function designLabSettings(): DesignLabSettings {
	const provider = designLabProvider(
		env.get("DESIGN_LAB_PROVIDER"),
		app.inProduction,
	);
	return {
		provider,
		model: provider === "bfl" ? (env.get("BFL_MODEL") ?? "") : PREVIEW_MODEL,
		monthlyLimit: env.get("DESIGN_LAB_MONTHLY_LIMIT"),
		maxVariations: env.get("DESIGN_LAB_MAX_VARIATIONS"),
		creditsPerImage: env.get("DESIGN_LAB_CREDITS_PER_IMAGE") ?? null,
	};
}

/** Whether the Design Lab is on for this process (nav item, routes). */
export const designLabEnabled = () => designLabSettings().provider !== "off";

/** BFL's API origin (BFL_API_URL or the hosted default). */
export const bflApiUrl = () => env.get("BFL_API_URL") ?? DEFAULT_BFL_API_URL;
