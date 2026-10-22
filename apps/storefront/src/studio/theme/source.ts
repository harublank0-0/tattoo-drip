import type { Studio } from "@tattoo-drip/sdk";

/**
 * THE SEAM between this ticket (TAT-54) and TAT-56: where a studio's theme
 * config comes from. It is the API's studio's `storefront` property, which
 * the contract (packages/types/openapi.yaml, `Studio`) does not have yet and
 * the platform never sends: on every real page this is `undefined`, and the
 * page shows the default theme. Tests put a config on a fixture studio.
 * When TAT-56 adds `storefront` to `Studio`, read `studio.storefront` here
 * without the cast; parseThemeConfig checks whatever arrives either way.
 */
export function storefrontInput(studio: Studio): unknown {
	return (studio as Studio & { readonly storefront?: unknown }).storefront;
}
