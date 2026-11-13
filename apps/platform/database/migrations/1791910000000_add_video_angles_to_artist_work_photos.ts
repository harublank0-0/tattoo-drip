import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Video angles: a tattoo's angles (1791900000000) may be short videos. A
 * video is a row of `artist_work_photos` like any angle, so everything the
 * angles already hold applies to it unchanged: the tattoo's eight places
 * (`angle_position` 1 to 7 and the deferrable unique place), the composite
 * key to the lead, one artist and one tenant per tattoo (the guard trigger),
 * the artist's 100 (the service's count of rows) and the files-first removal.
 * A separate table of videos would have had to repeat all of that across two
 * tables, which a unique index cannot do.
 *
 * - `kind`: `photo` (every row before this) or `video`, not null, default
 *   `photo`: additive, no row is rewritten.
 * - A video's still is its poster: `image_key`, `width` and `height` hold the
 *   poster's key (purpose `work_video`) and the size of the largest rendition
 *   once it is ready, so they are nullable now, and required of every photo
 *   (`artist_work_photos_photo_shape`).
 * - `video_state`: `processing` (the worker has it), `ready` (public) or
 *   `failed` (with `video_failure`, a reason for the studio). Only a ready
 *   video is ever public.
 * - `video_staging_key`: the private object the browser uploaded, kept on the
 *   row for good (its object is deleted once processed or failed), with a
 *   unique index per tenant: an upload finishes once.
 * - `video_duration_ms` (1 to 60000) and `video_keys`: the renditions' keys,
 *   smallest first, each naming its size (`…<w>x<h>.mp4`).
 * - `artist_work_photos_video_is_angle`: a video is never a lead (the check),
 *   and the guard trigger, replaced below, refuses a video as a lead too.
 *
 * Discover's views list leads only, so a video (always an angle) is never an
 * artwork; 1791910000001 keeps it out of `discovery.artwork_angles` too.
 */
const ORIGINAL_GUARD = `
create or replace function public.artist_work_photos_angles_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
	row_tenant uuid;
	row_artist uuid;
	row_lead uuid;
	lead_tenant uuid;
	lead_artist uuid;
	lead_lead uuid;
begin
	-- The row as the statement left it (the trigger runs once the statement
	-- has finished). Not found means this session cannot read it: an error.
	select p.tenant_id, p.artist_id, p.lead_photo_id
		into row_tenant, row_artist, row_lead
		from public.artist_work_photos p
		where p.id = new.id;
	if not found then
		raise exception 'artist_work_photos_angles_guard: % cannot be read', new.id;
	end if;
	if row_lead is not null then
		-- FOR SHARE: a concurrent change of the lead waits for this
		-- transaction, or this one for it, and then sees its outcome.
		select l.tenant_id, l.artist_id, l.lead_photo_id
			into lead_tenant, lead_artist, lead_lead
			from public.artist_work_photos l
			where l.id = row_lead
			for share;
		if not found then
			raise exception 'artist_work_photos_angles_guard: the lead of % cannot be read', new.id;
		end if;
		if lead_lead is not null then
			raise exception 'artist_work_photos_angles_guard: the lead of % is an angle itself', new.id;
		end if;
		if lead_tenant is distinct from row_tenant or lead_artist is distinct from row_artist then
			raise exception 'artist_work_photos_angles_guard: the lead of % is of another tenant or artist', new.id;
		end if;
		if exists (
			select 1 from public.artist_work_photos a
			where a.tenant_id = row_tenant and a.lead_photo_id = new.id
		) then
			raise exception 'artist_work_photos_angles_guard: % has angles and cannot become one', new.id;
		end if;
	elsif exists (
		select 1 from public.artist_work_photos a
		where a.tenant_id = row_tenant and a.lead_photo_id = new.id
			and a.artist_id is distinct from row_artist
	) then
		raise exception 'artist_work_photos_angles_guard: the angles of % are of another artist', new.id;
	end if;
	return null;
end
$$`;

/**
 * The guard with video angles: the original's rules, plus a video is never a
 * lead, whether it has no lead itself or another row names it as theirs.
 * Same pinned search_path, schema-qualified table, invoker rights, fails
 * closed.
 */
const VIDEO_GUARD = `
create or replace function public.artist_work_photos_angles_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
	row_tenant uuid;
	row_artist uuid;
	row_lead uuid;
	row_kind text;
	lead_tenant uuid;
	lead_artist uuid;
	lead_lead uuid;
	lead_kind text;
begin
	-- The row as the statement left it (the trigger runs once the statement
	-- has finished). Not found means this session cannot read it: an error.
	select p.tenant_id, p.artist_id, p.lead_photo_id, p.kind
		into row_tenant, row_artist, row_lead, row_kind
		from public.artist_work_photos p
		where p.id = new.id;
	if not found then
		raise exception 'artist_work_photos_angles_guard: % cannot be read', new.id;
	end if;
	if row_lead is not null then
		-- FOR SHARE: a concurrent change of the lead waits for this
		-- transaction, or this one for it, and then sees its outcome.
		select l.tenant_id, l.artist_id, l.lead_photo_id, l.kind
			into lead_tenant, lead_artist, lead_lead, lead_kind
			from public.artist_work_photos l
			where l.id = row_lead
			for share;
		if not found then
			raise exception 'artist_work_photos_angles_guard: the lead of % cannot be read', new.id;
		end if;
		if lead_lead is not null then
			raise exception 'artist_work_photos_angles_guard: the lead of % is an angle itself', new.id;
		end if;
		if lead_kind is distinct from 'photo' then
			raise exception 'artist_work_photos_angles_guard: the lead of % is a video', new.id;
		end if;
		if lead_tenant is distinct from row_tenant or lead_artist is distinct from row_artist then
			raise exception 'artist_work_photos_angles_guard: the lead of % is of another tenant or artist', new.id;
		end if;
		if exists (
			select 1 from public.artist_work_photos a
			where a.tenant_id = row_tenant and a.lead_photo_id = new.id
		) then
			raise exception 'artist_work_photos_angles_guard: % has angles and cannot become one', new.id;
		end if;
	else
		if row_kind is distinct from 'photo' then
			raise exception 'artist_work_photos_angles_guard: % is a video and cannot lead a tattoo', new.id;
		end if;
		if exists (
			select 1 from public.artist_work_photos a
			where a.tenant_id = row_tenant and a.lead_photo_id = new.id
				and a.artist_id is distinct from row_artist
		) then
			raise exception 'artist_work_photos_angles_guard: the angles of % are of another artist', new.id;
		end if;
	end if;
	return null;
end
$$`;

const CHECKS: [string, string][] = [
	["artist_work_photos_kind", "kind in ('photo', 'video')"],
	[
		"artist_work_photos_video_is_angle",
		"kind <> 'video' or lead_photo_id is not null",
	],
	[
		"artist_work_photos_photo_shape",
		`kind <> 'photo' or (image_key is not null and width is not null and height is not null
			and video_state is null and video_failure is null and video_staging_key is null
			and video_duration_ms is null and video_keys is null)`,
	],
	[
		"artist_work_photos_video_shape",
		`kind <> 'video' or (video_state in ('processing', 'ready', 'failed') and video_staging_key is not null)`,
	],
	[
		"artist_work_photos_video_ready",
		`video_state is distinct from 'ready' or (image_key is not null and width is not null
			and height is not null and video_duration_ms between 1 and 60000
			and cardinality(video_keys) between 1 and 2 and video_failure is null)`,
	],
	[
		"artist_work_photos_video_unfinished",
		`video_state is null or video_state = 'ready' or (image_key is null and video_keys is null)`,
	],
	[
		"artist_work_photos_video_failed",
		"(video_state = 'failed') = (video_failure is not null)",
	],
];

export default class extends BaseSchema {
	protected tableName = "artist_work_photos";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.string("kind", 8).notNullable().defaultTo("photo");
			table.string("video_state", 16).nullable();
			table.string("video_failure", 200).nullable();
			table.string("video_staging_key", 255).nullable();
			table.integer("video_duration_ms").nullable();
			table.specificType("video_keys", "varchar(255)[]").nullable();
		});
		this.schema.raw(
			"alter table artist_work_photos alter column image_key drop not null, alter column width drop not null, alter column height drop not null",
		);
		for (const [name, check] of CHECKS) {
			this.schema.raw(
				`alter table artist_work_photos add constraint ${name} check (${check})`,
			);
		}
		this.schema.raw(
			"create unique index artist_work_photos_video_staging_key on artist_work_photos (tenant_id, video_staging_key) where video_staging_key is not null",
		);
		this.schema.raw(VIDEO_GUARD);
	}

	async down() {
		// The old schema has no place for a video: refuse while any exists,
		// rather than lose it or leave its files without a row.
		this.schema.raw(`do $$ begin
	if exists (select 1 from artist_work_photos where kind <> 'photo') then
		raise exception 'video angles exist: remove them before rolling back';
	end if;
end $$`);
		this.schema.raw(ORIGINAL_GUARD);
		this.schema.raw("drop index artist_work_photos_video_staging_key");
		for (const [name] of [...CHECKS].reverse()) {
			this.schema.raw(`alter table artist_work_photos drop constraint ${name}`);
		}
		this.schema.raw(
			"alter table artist_work_photos alter column image_key set not null, alter column width set not null, alter column height set not null",
		);
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumns(
				"video_keys",
				"video_duration_ms",
				"video_staging_key",
				"video_failure",
				"video_state",
				"kind",
			);
		});
	}
}
