import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Angles: one tattoo shown with several photos of it. A tattoo is a lead
 * photo (an ordinary row, `lead_photo_id` null) and up to seven more photos
 * of the same piece, its angles, each naming its lead and its place after it
 * (`angle_position`, 1 to 7). The change is additive: no row is rewritten,
 * so every existing photo is a tattoo of one photo.
 *
 * What the database holds, so no code path can break it:
 *
 * - `artist_work_photos_angle_lead_fk`: the lead is a photo of the same
 *   tenant, through the composite key `(tenant_id, lead_photo_id)` to the
 *   table's own `(tenant_id, id)` (enableTenantRls made that unique). NO
 *   ACTION, so a lead cannot be deleted while it has angles, unless the same
 *   statement deletes them too (NO ACTION is checked at the end of the
 *   statement): removing a tattoo removes its photos in one DELETE, and a
 *   lead is never left behind as a dangling reference.
 * - `artist_work_photos_angle_complete`: a lead and a place, or neither.
 * - `artist_work_photos_angle_not_self`: a photo is never its own angle.
 * - `artist_work_photos_angle_position`: the place is 1 to 7, so a tattoo is
 *   at most eight photos (the lead and seven angles).
 * - `artist_work_photos_angle_place`: one photo per place of a tattoo,
 *   deferrable (initially immediate), the database README's pattern for a
 *   list reordered in place: a swap, a compaction after a removal or a new
 *   lead taking over its tattoo is one UPDATE, checked at its end.
 * - `artist_work_photos_angles`: the index the key and the angle reads use.
 * - `artist_work_photos_angles_guard`: what a check cannot say, because it
 *   reads other rows. An angle's lead is itself a lead (no chains), a photo
 *   that has angles cannot become an angle, and a lead and its angles are of
 *   the same tenant and the same artist, so a tattoo is never split across
 *   artists (a move takes the whole tattoo, in one UPDATE).
 *
 * The guard is a constraint trigger, AFTER the row and deferrable
 * (initially immediate), so it runs at the end of each statement, when every
 * row the statement changed is in place: one UPDATE that hands a tattoo to a
 * new lead, or moves a tattoo to another artist, is judged on its outcome,
 * never on the half-done state a BEFORE trigger would see half way through
 * the statement (whose rows it visits in no set order). It fails closed
 * like the repo's other guard triggers: it fires on every INSERT and UPDATE
 * whatever the columns, and a lead it cannot read counts as wrong, so a row
 * that row-level security hides (another tenant's) is refused, never let
 * through. Its function pins `search_path = pg_catalog, pg_temp` and
 * schema-qualifies the table, so a session cannot shadow what it reads;
 * keep both in any replacement. It runs with the invoker's rights (the app
 * role, under the tenant's RLS), which is all it needs: every row it reads
 * is of the row's own tenant.
 *
 * Which photo is public is the lead's business (WorkPhotoService): the
 * public reads list leads only and the lead's `hidden`, `styles` and
 * `healed` speak for the tattoo; the service copies them onto the angles so
 * the rows never disagree. That is a rule of the service, not of this
 * migration. Angles count toward the artist's 100 photos (the count under
 * the artist's lock in WorkPhotoService), not a database rule either.
 */
export default class extends BaseSchema {
	protected tableName = "artist_work_photos";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.uuid("lead_photo_id").nullable();
			table.smallint("angle_position").nullable();
		});
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_angle_lead_fk foreign key (tenant_id, lead_photo_id) references artist_work_photos (tenant_id, id) on delete no action",
		);
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_angle_complete check ((lead_photo_id is null) = (angle_position is null))",
		);
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_angle_not_self check (lead_photo_id <> id)",
		);
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_angle_position check (angle_position between 1 and 7)",
		);
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_angle_place unique (tenant_id, lead_photo_id, angle_position) deferrable initially immediate",
		);
		this.schema.raw(
			"create index artist_work_photos_angles on artist_work_photos (tenant_id, lead_photo_id)",
		);

		this.schema.raw(`
create function public.artist_work_photos_angles_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
	row_tenant uuid;
	row_artist uuid;
	row_lead uuid;
	lead_tenant uuid;
	lead_artist uuid;
	lead_lead uuid;
begin
	-- The row as it stands now, at the end of the statement (or later, when a
	-- transaction defers the trigger: a later statement may have changed it
	-- since, and its own event checks that version too). A row that is gone
	-- holds nothing that could be wrong.
	select p.tenant_id, p.artist_id, p.lead_photo_id
		into row_tenant, row_artist, row_lead
		from public.artist_work_photos p
		where p.id = new.id;
	if not found then
		return null;
	end if;
	if row_lead is not null then
		select l.tenant_id, l.artist_id, l.lead_photo_id
			into lead_tenant, lead_artist, lead_lead
			from public.artist_work_photos l
			where l.id = row_lead;
		-- Fails closed: a lead this session cannot read is a wrong lead.
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
$$`);
		this.schema.raw(
			"create constraint trigger artist_work_photos_angles_guard after insert or update on artist_work_photos deferrable initially immediate for each row execute function public.artist_work_photos_angles_guard()",
		);
	}

	async down() {
		this.schema.raw(
			"drop trigger artist_work_photos_angles_guard on artist_work_photos",
		);
		this.schema.raw("drop function public.artist_work_photos_angles_guard()");
		this.schema.raw("drop index artist_work_photos_angles");
		for (const constraint of [
			"artist_work_photos_angle_place",
			"artist_work_photos_angle_position",
			"artist_work_photos_angle_not_self",
			"artist_work_photos_angle_complete",
			"artist_work_photos_angle_lead_fk",
		]) {
			this.schema.raw(
				`alter table artist_work_photos drop constraint ${constraint}`,
			);
		}
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumns("angle_position", "lead_photo_id");
		});
	}
}
