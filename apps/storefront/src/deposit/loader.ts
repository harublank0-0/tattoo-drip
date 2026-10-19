import type { Studio } from "@tattoo-drip/sdk";
import type { ApiContext } from "../api/context.ts";
import { loadStudio } from "../api/loaders.ts";
import { studioViewModel } from "../studio/view-model.ts";

/*
 * The deposit page's loader (TAT-65b, spec ruling 5): only what a server can
 * know, the studio, from the lookup the tenant middleware cached. The deposit
 * loads in the browser, because its token is in the URL's fragment, which no
 * server sees. Loader data is serialized into the page: all of it is public.
 */

export interface DepositShell {
	readonly studioName: string;
	/** The studio's IANA timezone: "Pay by" and the screenshot's time are counted in it. */
	readonly timezone: string;
	/** E.164, checked; null when the studio set none. */
	readonly phone: string | null;
}

export function depositShell(studio: Studio): DepositShell {
	const view = studioViewModel(studio);
	return {
		studioName: view.name,
		timezone: studio.timezone,
		phone: view.phone,
	};
}

export async function loadDepositShell(
	context: ApiContext,
): Promise<DepositShell> {
	return depositShell(await loadStudio(context));
}
