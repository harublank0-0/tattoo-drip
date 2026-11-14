import { Secret } from "@adonisjs/core/helpers";

/**
 * AI Design Lab's settings (docs/design-lab.md), read and checked once by
 * start/env.ts. No env import here, so the env file can use these.
 *
 * - DESIGN_LAB_PROVIDER: `off`, `preview` (a local placeholder image, no
 *   network, for development and tests) or `bfl` (Black Forest Labs' hosted
 *   FLUX API). Default: `off` in production, `preview` elsewhere. Production
 *   refuses `preview`, so a studio never gets placeholder art as a concept.
 * - BFL_API_KEY (secret), BFL_MODEL (the hosted model endpoint name the
 *   account supports, e.g. the path segment after /v1/; no default, so the
 *   model is always a conscious choice) and BFL_API_URL (default
 *   https://api.bfl.ai): required with `bfl`.
 * - DESIGN_LAB_MONTHLY_LIMIT: generations each studio may start per calendar
 *   month (UTC). Default 40.
 * - DESIGN_LAB_MAX_VARIATIONS: images one submit may ask for, 1 to 4.
 *   Default 2. Each is its own provider request and counts on its own.
 * - DESIGN_LAB_CREDITS_PER_IMAGE: the provider credits one image is expected
 *   to cost, recorded as the estimate on each usage row (optional; the
 *   provider's own reported cost is recorded when it gives one).
 */

export const DESIGN_LAB_PROVIDERS = ["off", "preview", "bfl"] as const;
export type DesignLabProvider = (typeof DESIGN_LAB_PROVIDERS)[number];

export const DEFAULT_BFL_API_URL = "https://api.bfl.ai";
export const DEFAULT_MONTHLY_LIMIT = 40;
export const DEFAULT_MAX_VARIATIONS = 2;
export const VARIATIONS_CAP = 4;

/** A model endpoint name: the path segment after /v1/ (lowercase, digits, dots, hyphens). */
export const MODEL_FORMAT = /^[a-z0-9][a-z0-9.-]{1,62}$/;

export function checkDesignLabProvider(
	key: string,
	value: string | undefined,
): DesignLabProvider | undefined {
	const mode = value?.trim();
	if (!mode) return undefined;
	if (!(DESIGN_LAB_PROVIDERS as readonly string[]).includes(mode)) {
		throw new Error(`${key} must be off, preview or bfl`);
	}
	return mode as DesignLabProvider;
}

export function checkBflKey(
	key: string,
	value: string | undefined,
): Secret<string> | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	if (!/^[\x21-\x7e]{8,512}$/.test(trimmed)) {
		throw new Error(`${key} must be the API key from the BFL dashboard`);
	}
	return new Secret(trimmed);
}

export function checkBflModel(
	key: string,
	value: string | undefined,
): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	if (!MODEL_FORMAT.test(trimmed)) {
		throw new Error(
			`${key} must be a model endpoint name such as the path after /v1/ in BFL's API reference`,
		);
	}
	return trimmed;
}

export function checkBflApiUrl(
	key: string,
	value: string | undefined,
): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error(`${key} must be a URL`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`${key} must be an http(s) URL`);
	}
	if (url.search || url.hash || url.username || url.password) {
		throw new Error(`${key} must be an origin with no query or credentials`);
	}
	return trimmed.replace(/\/+$/, "");
}

const wholeNumber =
	(min: number, max: number, fallback: number) =>
	(key: string, value: string | undefined): number => {
		const trimmed = value?.trim();
		if (!trimmed) return fallback;
		if (!/^\d{1,6}$/.test(trimmed) || +trimmed < min || +trimmed > max) {
			throw new Error(`${key} must be a whole number from ${min} to ${max}`);
		}
		return Number(trimmed);
	};

export const checkMonthlyLimit = wholeNumber(0, 100000, DEFAULT_MONTHLY_LIMIT);
export const checkMaxVariations = wholeNumber(
	1,
	VARIATIONS_CAP,
	DEFAULT_MAX_VARIATIONS,
);

export function checkCreditsPerImage(
	key: string,
	value: string | undefined,
): number | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	if (!/^\d{1,4}(\.\d{1,3})?$/.test(trimmed)) {
		throw new Error(`${key} must be a number of credits such as 4 or 2.5`);
	}
	return Number(trimmed);
}

/** The provider in effect: the setting, else off in production and preview elsewhere. */
export function designLabProvider(
	setting: DesignLabProvider | undefined,
	production: boolean,
): DesignLabProvider {
	return setting ?? (production ? "off" : "preview");
}

/** Stops the process on a setting that cannot work (start/env.ts runs it once). */
export function checkDesignLabSettings({
	provider,
	production,
	apiKey,
	model,
	apiUrl,
}: {
	provider: DesignLabProvider;
	production: boolean;
	apiKey: boolean;
	model: boolean;
	apiUrl: string | undefined;
}) {
	if (provider === "preview" && production) {
		throw new Error(
			"DESIGN_LAB_PROVIDER=preview makes placeholder images: use bfl or off in production",
		);
	}
	if (provider !== "bfl") return;
	if (!apiKey) throw new Error("DESIGN_LAB_PROVIDER=bfl needs BFL_API_KEY");
	if (!model) throw new Error("DESIGN_LAB_PROVIDER=bfl needs BFL_MODEL");
	if (production && apiUrl && !apiUrl.startsWith("https://")) {
		throw new Error("BFL_API_URL must be https in production");
	}
}
