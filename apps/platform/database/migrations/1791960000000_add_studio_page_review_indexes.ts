import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Reviews and Fresh ink, slice 3: the studio page's paged reads
 * (PublicReviewService; listReviews and listFreshInk). Each is a partial
 * index on exactly the rows the read shows, in its order, so a page and the
 * next one walk the index from the cursor and the rating reads only shown
 * rows:
 *
 * - `client_reviews_studio_page_newest`: the reviews the studio's page shows
 *   (allowed there, not taken down, not deleted), newest first
 *   (`created_at desc, id desc`), with the rating for the average.
 * - `client_posts_studio_page_newest`: the posts it shows (approved,
 *   published, allowed there, not taken down, not deleted), newest published
 *   first (`published_at desc, id desc`).
 *
 * No new table, column, view or function: row-level security and the
 * existing policies cover the reads.
 */
export default class extends BaseSchema {
	async up() {
		this.schema.raw(
			"create index client_reviews_studio_page_newest on client_reviews (tenant_id, created_at desc, id desc) include (rating) where consent_studio_page and taken_down_at is null and deleted_at is null",
		);
		this.schema.raw(
			"create index client_posts_studio_page_newest on client_posts (tenant_id, published_at desc, id desc) where status = 'approved' and published_at is not null and consent_studio_page and taken_down_at is null and deleted_at is null",
		);
	}

	async down() {
		this.schema.raw("drop index client_posts_studio_page_newest");
		this.schema.raw("drop index client_reviews_studio_page_newest");
	}
}
