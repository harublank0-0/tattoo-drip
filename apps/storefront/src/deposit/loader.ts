import type { Studio } from "@tattoo-drip/sdk";
import type { ApiContext } from "../api/context.ts";
import { loadStudio } from "../api/loaders.ts";
import { type LogoImage, parseThemeConfig } from "../studio/theme/config.ts";
import { storefrontInput } from "../studio/theme/source.ts";
import { studioViewModel } from "../studio/view-model.ts";

/*
 * The deposit page's loader (TAT-65b, spec ruling 5): only what a server can
 * know, the studio, from the lookup the tenant middleware cached. The deposit
 * loads in the browser, because its token is in the URL's fragment, which no
 * server sees. Loader data is serialized into the page: all of it is public.
 * Of the studio's branding it reads the checked logo only (TAT-110): never the
 * colours, the font or the cover (the page stays violet and writes no brand
 * style, and a cover would compete with the QR on a payment page).
 */

export interface DepositShell {
	readonly studioName: string;
	/** The studio's IANA timezone: "Pay by" and the screenshot's time are counted in it. */
	readonly timezone: string;
	/** E.164, checked; null when the studio set none. */
	readonly phone: string | null;
	/** The studio's logo when it passes the theme's checks (the API's own origin), else null: the header then shows the initial. */
	readonly logo: LogoImage | null;
}

/** `imageOrigin` is the API's origin, the only one a logo may come from; null accepts none. */
export function depositShell(
	studio: Studio,
	imageOrigin: string | null = null,
): DepositShell {
	const view = studioViewModel(studio);
	return {
		studioName: view.name,
		timezone: studio.timezone,
		phone: view.phone,
		logo: parseThemeConfig(storefrontInput(studio), imageOrigin).logo,
	};
}

export async function loadDepositShell(
	context: ApiContext,
): Promise<DepositShell> {
	return depositShell(
		await loadStudio(context),
		context.tattoo.connection.apiUrl,
	);
}
