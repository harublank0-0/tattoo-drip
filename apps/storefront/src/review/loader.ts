import type { Studio } from "@tattoo-drip/sdk";
import type { ApiContext } from "../api/context.ts";
import { loadStudio } from "../api/loaders.ts";
import { type LogoImage, parseThemeConfig } from "../studio/theme/config.ts";
import { storefrontInput } from "../studio/theme/source.ts";
import { type ContactLink, studioViewModel } from "../studio/view-model.ts";

/*
 * The review page's loader (Reviews and Fresh ink): only what a server can
 * know, the studio from the lookup the tenant middleware cached. The review
 * page loads in the browser, because its token is in the URL's fragment.
 * Loader data is serialized into the page: all of it is public. Of the
 * studio's branding it reads the checked logo only, as the deposit page does.
 */

export interface ReviewShell {
	readonly studioName: string;
	/** The studio's logo when it passes the theme's checks (MEDIA_URL), else null: the header shows the initial. */
	readonly logo: LogoImage | null;
	/** The ways to reach the studio (Instagram, WhatsApp, Viber, a call, email): a dead link's page lists them. */
	readonly contact: readonly ContactLink[];
}

export function reviewShell(
	studio: Studio,
	imageOrigin: string | null = null,
): ReviewShell {
	const view = studioViewModel(studio);
	return {
		studioName: view.name,
		logo: parseThemeConfig(storefrontInput(studio), imageOrigin).logo,
		contact: view.links.filter((link) =>
			["instagram", "whatsapp", "viber", "call", "email", "facebook"].includes(
				link.kind,
			),
		),
	};
}

export async function loadReviewShell(
	context: ApiContext,
): Promise<ReviewShell> {
	return reviewShell(
		await loadStudio(context),
		context.tattoo.connection.mediaUrl,
	);
}
