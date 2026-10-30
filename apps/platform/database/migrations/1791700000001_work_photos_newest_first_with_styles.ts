import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Work photos newest first, with styles and a healed mark (TAT-126). Until
 * now a photo's `position` (0 to 5, so at most six) was its place, set by
 * the studio. The portfolio is now newest first with no limit in the
 * database (WorkPhotoService counts under the artist's lock), so `created_at`
 * is the order and `position` goes. Existing photos must keep the studio's
 * order, and they were uploaded in a different order than they are shown:
 * up() first rewrites the dates so that position 0 gets the artist's newest
 * date and each later position one second less, and only then drops
 * `position`. A photo's `styles` are slugs from #modules/artists/styles,
 * at most three (the list is not checked here, like the artist's own).
 * Both new indexes serve the paged reads: the studio's gallery on
 * (tenant_id, created_at, id) and an artist's on (tenant_id, artist_id,
 * created_at, id).
 *
 * down() restores `position` from the dates, and refuses while an artist has
 * more than six photos, which the old schema cannot hold.
 */
export default class extends BaseSchema {
	protected tableName = "artist_work_photos";

	async up() {
		this.schema.raw(`
update artist_work_photos p
set created_at = m.newest - p.position * interval '1 second'
from (select tenant_id, artist_id, max(created_at) as newest
      from artist_work_photos group by tenant_id, artist_id) m
where p.tenant_id = m.tenant_id and p.artist_id = m.artist_id`);
		this.schema.raw(
			"alter table artist_work_photos drop constraint artist_work_photos_position_unique",
		);
		this.schema.raw(
			"alter table artist_work_photos drop constraint artist_work_photos_position_range",
		);
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("position");
			table
				.specificType("styles", "varchar(40)[]")
				.notNullable()
				.defaultTo(this.raw("'{}'"));
			table.boolean("healed").notNullable().defaultTo(false);
		});
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_styles_max check (cardinality(styles) <= 3)",
		);
		this.schema.alterTable(this.tableName, (table) => {
			table.index(
				["tenant_id", "created_at", "id"],
				"artist_work_photos_newest",
			);
			table.index(
				["tenant_id", "artist_id", "created_at", "id"],
				"artist_work_photos_artist_newest",
			);
		});
	}

	async down() {
		this.schema.raw(`
do $$
begin
	if exists (
		select 1 from artist_work_photos group by tenant_id, artist_id having count(*) > 6
	) then
		raise exception 'artist_work_photos: an artist has more than 6 photos; remove some before rolling back';
	end if;
end
$$`);
		this.schema.alterTable(this.tableName, (table) => {
			table.dropIndex(
				["tenant_id", "artist_id", "created_at", "id"],
				"artist_work_photos_artist_newest",
			);
			table.dropIndex(
				["tenant_id", "created_at", "id"],
				"artist_work_photos_newest",
			);
		});
		this.schema.raw(
			"alter table artist_work_photos drop constraint artist_work_photos_styles_max",
		);
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumns("styles", "healed");
			table.smallint("position").nullable();
		});
		this.schema.raw(`
update artist_work_photos p
set position = r.place
from (select id, (row_number() over (
        partition by tenant_id, artist_id order by created_at desc, id desc
      ) - 1)::smallint as place
      from artist_work_photos) r
where p.id = r.id`);
		this.schema.raw(
			"alter table artist_work_photos alter column position set not null",
		);
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_position_range check (position between 0 and 5)",
		);
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_position_unique unique (tenant_id, artist_id, position) deferrable initially immediate",
		);
	}
}
