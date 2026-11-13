import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * Reviews and Fresh ink, slice 1 (docs/superpowers/specs/
 * 2026-11-12-reviews-and-fresh-ink-design.md): the review link, the client's
 * review and the client's post with its photos and videos. All four are
 * tenant-owned (RLS, `enableTenantRls`, composite tenant keys).
 *
 * - `review_links`: the bearer link to a project's review page (ruling 2). A
 *   credential, like `deposit_links`: not soft-deleted, never holds the
 *   token. `token_nonce` derives it with a key made from APP_KEY
 *   (#modules/reviews/review_links), `token_hash` (its SHA-256) is what a
 *   request is looked up by. One live (unrevoked) link per project
 *   (`review_links_one_live`); a revoked one stays as history. Expires
 *   twelve months after it is made (ruling 4).
 * - `client_reviews`: one live review per project (ruling 5), a rating of 1
 *   to 5 and 20 to 2,000 characters, the shown name (1 to 40 characters),
 *   the two consents (ruling 8), the studio's reply (slice 2), the report
 *   and the takedown (ruling 12). Soft-deleted: the client's delete keeps the
 *   studio's record; nothing public reads it.
 * - `client_posts`: one live post per project, its caption (280), up to
 *   three styles, the placement words, the studio's decision (`status`,
 *   ruling 7), the shown name, the consents, the report and the takedown.
 *   `submitted_at` is null while the client is still adding photos: the
 *   studio sees a post only once it is submitted. Soft-deleted.
 * - `client_post_media`: a post's photos and videos (1 to 8 at submit), the
 *   angles model: `position` 0 is the lead, never a video
 *   (`client_post_media_video_never_leads`), places unique per post with a
 *   deferrable unique so a reorder is one statement. A video's columns follow
 *   the work video angles' rules. Not soft-deleted: a removed photo of a
 *   client's body must stop being reachable at once, so its files go first,
 *   then its row (like `artist_work_photos`).
 */
const REVIEW_CHECKS: [string, string][] = [
	["client_reviews_rating", "rating between 1 and 5"],
	["client_reviews_body_length", "char_length(body) between 20 and 2000"],
	[
		"client_reviews_shown_name_length",
		"char_length(shown_name) between 1 and 40",
	],
	[
		"client_reviews_reply_length",
		"reply is null or char_length(reply) between 1 and 1000",
	],
	["client_reviews_reply_time", "(reply is null) = (replied_at is null)"],
	["client_reviews_report", "(reported_at is null) = (report_reason is null)"],
	[
		"client_reviews_report_reason",
		"report_reason is null or report_reason in ('hate', 'threats', 'personal_data', 'off_topic', 'not_a_client')",
	],
	[
		"client_reviews_takedown",
		"(taken_down_at is null) = (takedown_reason is null)",
	],
	[
		"client_reviews_takedown_reason",
		"takedown_reason is null or takedown_reason in ('hate', 'threats', 'personal_data', 'off_topic', 'not_a_client', 'client_request', 'other')",
	],
];

const POST_CHECKS: [string, string][] = [
	[
		"client_posts_status",
		"status in ('waiting', 'approved', 'declined', 'unpublished')",
	],
	["client_posts_decision", "(status = 'waiting') = (decided_at is null)"],
	[
		"client_posts_caption_length",
		"caption is null or char_length(caption) between 1 and 280",
	],
	[
		"client_posts_placement_length",
		"placement is null or char_length(placement) between 1 and 120",
	],
	["client_posts_styles", "cardinality(styles) <= 3"],
	[
		"client_posts_shown_name_length",
		"char_length(shown_name) between 1 and 40",
	],
	["client_posts_report", "(reported_at is null) = (report_reason is null)"],
	[
		"client_posts_report_reason",
		"report_reason is null or report_reason in ('hate', 'threats', 'personal_data', 'off_topic', 'not_a_client')",
	],
	[
		"client_posts_takedown",
		"(taken_down_at is null) = (takedown_reason is null)",
	],
	[
		"client_posts_takedown_reason",
		"takedown_reason is null or takedown_reason in ('hate', 'threats', 'personal_data', 'off_topic', 'not_a_client', 'client_request', 'other')",
	],
];

const MEDIA_CHECKS: [string, string][] = [
	["client_post_media_kind", "kind in ('photo', 'video')"],
	["client_post_media_position", "position between 0 and 7"],
	["client_post_media_video_never_leads", "kind = 'photo' or position > 0"],
	[
		"client_post_media_photo_shape",
		`kind <> 'photo' or (image_key is not null and width is not null and height is not null
			and video_state is null and video_failure is null and video_staging_key is null
			and video_duration_ms is null and video_keys is null)`,
	],
	[
		"client_post_media_video_shape",
		`kind <> 'video' or (video_state in ('processing', 'ready', 'failed') and video_staging_key is not null)`,
	],
	[
		"client_post_media_video_ready",
		`video_state is distinct from 'ready' or (image_key is not null and width is not null
			and height is not null and video_duration_ms between 1 and 60000
			and cardinality(video_keys) between 1 and 2 and video_failure is null)`,
	],
	[
		"client_post_media_video_unfinished",
		`video_state is null or video_state = 'ready' or (image_key is null and video_keys is null)`,
	],
	[
		"client_post_media_video_failed",
		"(video_state = 'failed') = (video_failure is not null)",
	],
];

export default class extends BaseSchema {
	async up() {
		this.schema.createTable("review_links", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			table.string("token_nonce", 22).notNullable();
			table.string("token_hash", 64).notNullable();
			// Who made it; the link outlives a removed account.
			table
				.uuid("created_by")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("expires_at", { useTz: true }).notNullable();
			table.timestamp("revoked_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects");
			// Global: a request is looked up by the hash (and its path's tenant).
			table.unique(["token_hash"]);
			table.index(["tenant_id"]);
			table.index(["created_by"]);
		});
		this.schema.raw(
			"create unique index review_links_one_live on review_links (tenant_id, project_id) where revoked_at is null",
		);
		this.schema.raw(
			"alter table review_links add constraint review_links_token_nonce_format check (token_nonce ~ '^[A-Za-z0-9_-]{22}$')",
		);
		this.schema.raw(
			"alter table review_links add constraint review_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$')",
		);
		this.schema.raw(
			"alter table review_links add constraint review_links_expiry check (expires_at > created_at)",
		);
		for (const sql of enableTenantRls("review_links")) this.schema.raw(sql);

		this.schema.createTable("client_reviews", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			table.uuid("client_id").notNullable();
			table.uuid("artist_id").notNullable();
			table.smallint("rating").notNullable();
			table.text("body").notNullable();
			table.string("shown_name", 40).notNullable();
			table.boolean("consent_studio_page").notNullable().defaultTo(false);
			table.boolean("consent_discover").notNullable().defaultTo(false);
			table.text("reply").nullable();
			table.timestamp("replied_at", { useTz: true }).nullable();
			table.timestamp("reported_at", { useTz: true }).nullable();
			table.string("report_reason", 32).nullable();
			table.timestamp("taken_down_at", { useTz: true }).nullable();
			table.string("takedown_reason", 32).nullable();
			table.text("takedown_note").nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects");
			tenantReference(table, "client_id", "clients");
			tenantReference(table, "artist_id", "artists");
			table.index(["tenant_id"]);
			table.index(["tenant_id", "client_id"]);
			table.index(["tenant_id", "artist_id"]);
		});
		this.schema.raw(
			"create unique index client_reviews_one_per_project on client_reviews (tenant_id, project_id) where deleted_at is null",
		);
		for (const [name, check] of REVIEW_CHECKS) {
			this.schema.raw(
				`alter table client_reviews add constraint ${name} check (${check})`,
			);
		}
		for (const sql of enableTenantRls("client_reviews")) this.schema.raw(sql);

		this.schema.createTable("client_posts", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			table.uuid("client_id").notNullable();
			table.uuid("artist_id").notNullable();
			table.string("caption", 280).nullable();
			table
				.specificType("styles", "varchar(64)[]")
				.notNullable()
				.defaultTo(this.raw("'{}'"));
			table.string("placement", 120).nullable();
			table.string("status", 16).notNullable().defaultTo("waiting");
			table.timestamp("submitted_at", { useTz: true }).nullable();
			table.timestamp("decided_at", { useTz: true }).nullable();
			table
				.uuid("decided_by")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table.string("shown_name", 40).notNullable();
			table.boolean("consent_studio_page").notNullable().defaultTo(false);
			table.boolean("consent_discover").notNullable().defaultTo(false);
			table.timestamp("reported_at", { useTz: true }).nullable();
			table.string("report_reason", 32).nullable();
			table.timestamp("taken_down_at", { useTz: true }).nullable();
			table.string("takedown_reason", 32).nullable();
			table.text("takedown_note").nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects");
			tenantReference(table, "client_id", "clients");
			tenantReference(table, "artist_id", "artists");
			table.index(["tenant_id"]);
			table.index(["tenant_id", "client_id"]);
			table.index(["tenant_id", "artist_id"]);
			table.index(["decided_by"]);
		});
		this.schema.raw(
			"create unique index client_posts_one_per_project on client_posts (tenant_id, project_id) where deleted_at is null",
		);
		for (const [name, check] of POST_CHECKS) {
			this.schema.raw(
				`alter table client_posts add constraint ${name} check (${check})`,
			);
		}
		for (const sql of enableTenantRls("client_posts")) this.schema.raw(sql);

		this.schema.createTable("client_post_media", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("post_id").notNullable();
			table.string("kind", 8).notNullable().defaultTo("photo");
			table.smallint("position").notNullable();
			// A photo's image, or a ready video's poster (purpose
			// client_post_photo or client_post_video).
			table.string("image_key", 255).nullable();
			table.integer("width").nullable();
			table.integer("height").nullable();
			table.string("alt", 500).nullable();
			table.string("video_state", 16).nullable();
			table.string("video_failure", 200).nullable();
			table.string("video_staging_key", 255).nullable();
			table.integer("video_duration_ms").nullable();
			table.specificType("video_keys", "varchar(255)[]").nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "post_id", "client_posts");
			table.index(["tenant_id"]);
		});
		// Its index also serves the key and every read of a post's media.
		this.schema.raw(
			"alter table client_post_media add constraint client_post_media_place unique (tenant_id, post_id, position) deferrable initially immediate",
		);
		this.schema.raw(
			"create unique index client_post_media_video_staging_key on client_post_media (tenant_id, video_staging_key) where video_staging_key is not null",
		);
		for (const [name, check] of MEDIA_CHECKS) {
			this.schema.raw(
				`alter table client_post_media add constraint ${name} check (${check})`,
			);
		}
		for (const sql of enableTenantRls("client_post_media"))
			this.schema.raw(sql);
	}

	async down() {
		for (const table of [
			"client_post_media",
			"client_posts",
			"client_reviews",
			"review_links",
		]) {
			for (const sql of disableTenantRls(table)) this.schema.raw(sql);
			this.schema.dropTable(table);
		}
	}
}
