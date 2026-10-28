import type { Studio } from "@tattoo-drip/sdk";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * THE SEAM between this ticket (TAT-54) and TAT-56: where a studio's theme
 * config comes from. It is the API's studio's `storefront` property, which
 * the contract (packages/types/openapi.yaml, `Studio`) does not have yet and
 * the platform never sends: on every real page that is `undefined`, and the
 * page shows the default theme. Tests put a config on a fixture studio.
 * When TAT-56 adds `storefront` to `Studio`, read `studio.storefront` here
 * without the cast; parseThemeConfig checks whatever arrives either way.
 *
 * TAT-116's cover (`Studio.cover`) comes in here too, as the configuration's
 * `branding.heroImage`: the studio's one hero image, checked by
 * parseThemeConfig like any brand image. Without a cover this returns
 * exactly what it returned before (the very object, or undefined), so a
 * studio with none has the page it always had. A configuration that is not an
 * object is replaced, not merged into; when both carry a hero image the
 * cover wins.
 */
export function storefrontInput(studio: Studio): unknown {
	const raw = (studio as Studio & { readonly storefront?: unknown }).storefront;
	const cover = Object.hasOwn(studio, "cover") ? studio.cover : undefined;
	if (cover === undefined || cover === null) return raw;
	const config = isRecord(raw) ? raw : {};
	const branding =
		Object.hasOwn(config, "branding") && isRecord(config.branding)
			? config.branding
			: {};
	return { ...config, branding: { ...branding, heroImage: cover } };
}
