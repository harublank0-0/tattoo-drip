import type { DateTime } from "luxon";
import type Client from "#modules/clients/models/client";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type ReviewLink from "#modules/reviews/models/review_link";
import type Tenant from "#modules/tenancy/models/tenant";

/**
 * What a working review link opens (ReviewPageService.open): the studio, the
 * link, its live project and client, and the artist and day of the
 * project's latest completed tattoo session (the project's own artist when
 * it has one). Every write of the review page acts on exactly this project;
 * nothing in a request body can name another.
 */
export type ReviewContext = {
	tenant: Tenant;
	link: ReviewLink;
	project: TattooProject;
	client: Client;
	artistId: string;
	tattooedAt: DateTime;
};
