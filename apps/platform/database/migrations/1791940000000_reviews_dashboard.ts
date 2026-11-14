import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/** The report and takedown reasons (#modules/reviews/rules; copied, not imported). */
const TAKEDOWN_REASONS =
	"'hate', 'threats', 'personal_data', 'off_topic', 'not_a_client', 'client_request', 'other'";
/** The message kinds (#modules/notifications/messages; copied), before and after. */
const OLD_KINDS =
	"'inquiry_received', 'quote', 'deposit_link', 'booking_confirmation', 'session_reminder', 'aftercare'";
const NEW_KINDS = `${OLD_KINDS}, 'review_request'`;

/**
 * Reviews and Fresh ink, slice 2 (the dashboard):
 *
 * - `client_posts.published_at`: set while the post's photos and videos have
 *   public copies (PostPublicationService), which only an approved post the
 *   client allowed a surface for may have, and never once taken down or
 *   deleted (`client_posts_published`). `waiting_round` counts the times the
 *   post entered the studio's queue (1 at the submit, one more each time a
 *   client's change sends an approved post back) and `waiting_since` is when
 *   it last did: the alert is once per post per round.
 * - `client_reviews`: the studio's report note (1 to 500 characters), who
 *   reported (users, SET NULL), when TattooDrip closed the report without a
 *   takedown (`report_resolved_at`), and the reply's own takedown (ruling
 *   12: a review, a reply or a post), all or none with its reason list, only
 *   on a reply.
 * - `review_links.sent_at`: when the studio last sent the link from the
 *   project page (a chat link or a copied message of "Ask for a review").
 * - The `review_request` message: a studio's own text and a project's last
 *   contact may name it.
 * - The `fresh_ink` staff alert: a post waiting for the studio, naming the
 *   post and its round; one per member per post per round.
 * - Three SECURITY DEFINER functions, ids only: `open_review_reports()`
 *   (the operator's report list: `(tenant_id, review_id)` of live reviews
 *   reported and not decided, at most 500), and two exact lookups for the
 *   operator commands, `client_review_tenant(requested_id)` and
 *   `client_post_tenant(requested_id)` (the live tenant holding that review
 *   or post, deleted rows included). Their bodies read `client_reviews.id`,
 *   `tenant_id`, `reported_at`, `report_resolved_at`, `taken_down_at`,
 *   `deleted_at`, `client_posts.id`, `tenant_id`, `tenants.id` and
 *   `tenants.deleted_at`: a migration that drops or retypes one of them
 *   replaces the function in the same migration.
 *
 * down() refuses while a post is published (its public copies would be left
 * with nothing naming them), then deletes the fresh-ink alerts, the studios'
 * own review request texts and the review request contacts' kind (the old
 * checks can't hold them).
 */
export default class extends BaseSchema {
	async up() {
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		for (const statement of [
			// Posts: the public copies and the queue's rounds.
			"alter table client_posts add column published_at timestamptz null, add column waiting_round smallint not null default 0, add column waiting_since timestamptz null",
			"update client_posts set waiting_round = 1, waiting_since = submitted_at where submitted_at is not null",
			"alter table client_posts add constraint client_posts_waiting_round check (waiting_round >= 0 and (waiting_round = 0) = (submitted_at is null) and (waiting_round = 0) = (waiting_since is null))",
			"alter table client_posts add constraint client_posts_published check (published_at is null or (status = 'approved' and taken_down_at is null and deleted_at is null and (consent_studio_page or consent_discover)))",
			// Reviews: the report's note, reporter and resolution; the reply's takedown.
			"alter table client_reviews add column report_note text null, add column reported_by uuid null references users (id) on delete set null, add column report_resolved_at timestamptz null",
			"create index client_reviews_reported_by_index on client_reviews (reported_by)",
			"alter table client_reviews add constraint client_reviews_report_note check (report_note is null or (reported_at is not null and char_length(report_note) between 1 and 500))",
			"alter table client_reviews add constraint client_reviews_report_by check (reported_by is null or reported_at is not null)",
			"alter table client_reviews add constraint client_reviews_report_resolved check (report_resolved_at is null or reported_at is not null)",
			"alter table client_reviews add column reply_taken_down_at timestamptz null, add column reply_takedown_reason varchar(32) null, add column reply_takedown_note text null",
			"alter table client_reviews add constraint client_reviews_reply_takedown check ((reply_taken_down_at is null) = (reply_takedown_reason is null) and (reply_taken_down_at is null or reply is not null))",
			`alter table client_reviews add constraint client_reviews_reply_takedown_reason check (reply_takedown_reason is null or reply_takedown_reason in (${TAKEDOWN_REASONS}))`,
			"alter table client_reviews add constraint client_reviews_reply_takedown_note check (reply_takedown_note is null or reply_taken_down_at is not null)",
			"create index client_reviews_open_reports on client_reviews (reported_at) where reported_at is not null and report_resolved_at is null and taken_down_at is null and deleted_at is null",
			// Links: when the studio sent it.
			"alter table review_links add column sent_at timestamptz null",
			// The review request message.
			"alter table message_templates drop constraint message_templates_kind_check",
			`alter table message_templates add constraint message_templates_kind_check check (kind in (${NEW_KINDS}))`,
			"alter table tattoo_projects drop constraint tattoo_projects_last_contact_kind_check",
			`alter table tattoo_projects add constraint tattoo_projects_last_contact_kind_check check (last_contact_kind in (${NEW_KINDS}))`,
			// The fresh-ink alert.
			"alter table staff_alerts add column post_id uuid null, add column post_round smallint null",
			"alter table staff_alerts add constraint staff_alerts_post_foreign foreign key (tenant_id, post_id) references client_posts (tenant_id, id) on delete cascade",
			"create index staff_alerts_tenant_id_post_id_index on staff_alerts (tenant_id, post_id)",
			"alter table staff_alerts drop constraint staff_alerts_kind_check",
			"alter table staff_alerts add constraint staff_alerts_kind_check check (kind in ('new_inquiry', 'deposit_proof', 'fresh_ink'))",
			"alter table staff_alerts drop constraint staff_alerts_subject_matches_kind",
			"alter table staff_alerts add constraint staff_alerts_subject_matches_kind check ((kind = 'new_inquiry') = (inquiry_id is not null) and (kind = 'deposit_proof') = (payment_id is not null) and (kind = 'fresh_ink') = (post_id is not null) and (post_id is null) = (post_round is null) and (project_id is null) = (payment_id is null))",
			// One alert per member per post per round.
			"alter table staff_alerts add constraint staff_alerts_user_post_round_unique unique (user_id, post_id, post_round)",
			// The operator's report list.
			`create function public.open_review_reports()
returns table (tenant_id uuid, review_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select r.tenant_id, r.id
  from public.client_reviews r
  join public.tenants t on t.id = r.tenant_id
  where r.reported_at is not null
    and r.report_resolved_at is null
    and r.taken_down_at is null
    and r.deleted_at is null
    and t.deleted_at is null
  order by r.reported_at, r.id
  limit 500;
end`,
			"revoke all on function public.open_review_reports() from public",
			`grant execute on function public.open_review_reports() to ${appRole}`,
			// The operator commands' lookups: one id, at most one tenant.
			`create function public.client_review_tenant(requested_id uuid)
returns uuid
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select r.tenant_id
  from public.client_reviews r
  join public.tenants t on t.id = r.tenant_id
  where r.id = requested_id
    and t.deleted_at is null;
end`,
			"revoke all on function public.client_review_tenant(uuid) from public",
			`grant execute on function public.client_review_tenant(uuid) to ${appRole}`,
			`create function public.client_post_tenant(requested_id uuid)
returns uuid
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select p.tenant_id
  from public.client_posts p
  join public.tenants t on t.id = p.tenant_id
  where p.id = requested_id
    and t.deleted_at is null;
end`,
			"revoke all on function public.client_post_tenant(uuid) from public",
			`grant execute on function public.client_post_tenant(uuid) to ${appRole}`,
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		// Published posts have public copies that nothing would name any more:
		// unpublish or take them down first.
		this.schema.raw(`do $$ begin
	if exists (select 1 from client_posts where published_at is not null) then
		raise exception 'published Fresh ink posts exist: unpublish them (their public copies) before rolling back';
	end if;
end $$`);
		for (const statement of [
			"drop function public.client_post_tenant(uuid)",
			"drop function public.client_review_tenant(uuid)",
			"drop function public.open_review_reports()",
			"delete from staff_alerts where kind = 'fresh_ink'",
			"alter table staff_alerts drop constraint staff_alerts_user_post_round_unique",
			"alter table staff_alerts drop constraint staff_alerts_subject_matches_kind",
			"alter table staff_alerts add constraint staff_alerts_subject_matches_kind check ((kind = 'new_inquiry') = (inquiry_id is not null) and (kind = 'deposit_proof') = (payment_id is not null) and (project_id is null) = (payment_id is null))",
			"alter table staff_alerts drop constraint staff_alerts_kind_check",
			"alter table staff_alerts add constraint staff_alerts_kind_check check (kind in ('new_inquiry', 'deposit_proof'))",
			"drop index staff_alerts_tenant_id_post_id_index",
			"alter table staff_alerts drop constraint staff_alerts_post_foreign",
			"alter table staff_alerts drop column post_round, drop column post_id",
			"update tattoo_projects set last_contact_kind = null where last_contact_kind = 'review_request'",
			"alter table tattoo_projects drop constraint tattoo_projects_last_contact_kind_check",
			`alter table tattoo_projects add constraint tattoo_projects_last_contact_kind_check check (last_contact_kind in (${OLD_KINDS}))`,
			"delete from message_templates where kind = 'review_request'",
			"alter table message_templates drop constraint message_templates_kind_check",
			`alter table message_templates add constraint message_templates_kind_check check (kind in (${OLD_KINDS}))`,
			"alter table review_links drop column sent_at",
			"drop index client_reviews_open_reports",
			"alter table client_reviews drop constraint client_reviews_reply_takedown_note",
			"alter table client_reviews drop constraint client_reviews_reply_takedown_reason",
			"alter table client_reviews drop constraint client_reviews_reply_takedown",
			"alter table client_reviews drop column reply_takedown_note, drop column reply_takedown_reason, drop column reply_taken_down_at",
			"alter table client_reviews drop constraint client_reviews_report_resolved",
			"alter table client_reviews drop constraint client_reviews_report_by",
			"alter table client_reviews drop constraint client_reviews_report_note",
			"drop index client_reviews_reported_by_index",
			"alter table client_reviews drop column report_resolved_at, drop column reported_by, drop column report_note",
			"alter table client_posts drop constraint client_posts_published",
			"alter table client_posts drop constraint client_posts_waiting_round",
			"alter table client_posts drop column waiting_since, drop column waiting_round, drop column published_at",
		]) {
			this.schema.raw(statement);
		}
	}
}
