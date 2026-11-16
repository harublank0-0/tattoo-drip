/**
 * Every stored file a live record holds, by key (the storage meter, option A
 * of docs/superpowers/specs/2026-11-16-storage-meter-design.md): usage
 * counts a size row only while one of these columns names its key, so a
 * deleted or soft-deleted record's file stops counting at once, and an
 * orphan never counts. One entry per key column; the guard test
 * (storage_meter.spec.ts) fails for a key column in neither list.
 *
 * Each `sql` selects `key` for the studio `t.id` (the `t` CTE that
 * `liveKeysCte` opens), from rows that are live: soft-deleted artists,
 * payment methods, reference images and design projects' assets, and a
 * deleted post's media, don't count.
 */
const COUNTED: { column: string; sql: string }[] = [
	{
		column: "Artist.photoKey",
		sql: "select photo_key as key from artists, t where artists.tenant_id = t.id and deleted_at is null and photo_key is not null",
	},
	{
		column: "ArtistWorkPhoto.imageKey",
		sql: "select image_key as key from artist_work_photos, t where artist_work_photos.tenant_id = t.id and image_key is not null",
	},
	{
		column: "ArtistWorkPhoto.videoKeys",
		sql: "select unnest(video_keys) as key from artist_work_photos, t where artist_work_photos.tenant_id = t.id and video_keys is not null",
	},
	{
		column: "ClientPostMedia.imageKey",
		sql: "select m.image_key as key from client_post_media m join client_posts p on p.tenant_id = m.tenant_id and p.id = m.post_id, t where m.tenant_id = t.id and p.deleted_at is null and m.image_key is not null",
	},
	{
		column: "ClientPostMedia.videoKeys",
		sql: "select unnest(m.video_keys) as key from client_post_media m join client_posts p on p.tenant_id = m.tenant_id and p.id = m.post_id, t where m.tenant_id = t.id and p.deleted_at is null and m.video_keys is not null",
	},
	{
		column: "DesignAsset.imageKey",
		sql: "select a.image_key as key from design_assets a join design_projects p on p.tenant_id = a.tenant_id and p.id = a.design_project_id, t where a.tenant_id = t.id and p.deleted_at is null",
	},
	{
		column: "FlashDesign.imageKey",
		sql: "select image_key as key from flash_designs, t where flash_designs.tenant_id = t.id",
	},
	{
		column: "PaymentMethod.qrImageKey",
		sql: "select qr_image_key as key from payment_methods, t where payment_methods.tenant_id = t.id and deleted_at is null and qr_image_key is not null",
	},
	{
		column: "Payment.proofImageKey",
		sql: "select proof_image_key as key from payments, t where payments.tenant_id = t.id and proof_image_key is not null",
	},
	{
		column: "ReferenceImage.imageKey",
		sql: "select image_key as key from reference_images, t where reference_images.tenant_id = t.id and deleted_at is null",
	},
	{
		column: "Tenant.coverImageKey",
		sql: "select cover_image_key as key from tenants, t where tenants.id = t.id and cover_image_key is not null",
	},
	{
		column: "Tenant.logoImageKey",
		sql: "select logo_image_key as key from tenants, t where tenants.id = t.id and logo_image_key is not null",
	},
	{
		column: "Tenant.logoIconKey",
		sql: "select logo_icon_key as key from tenants, t where tenants.id = t.id and logo_icon_key is not null",
	},
];

/** The key columns usage counts (`Schema class.column`). */
export const COUNTED_KEY_COLUMNS = COUNTED.map(({ column }) => column);

/** Key columns that never name a counted file, each with its reason. */
export const EXCLUDED_KEY_COLUMNS: string[] = [
	// A video's upload before processing: temporary, deleted once processed.
	"ArtistWorkPhoto.videoStagingKey",
	"ClientPostMedia.videoStagingKey",
	"ClientVideoReservation.stagingKey",
	// Not files: a webhook's URL key and a checkout's idempotency key.
	"GatewayAccount.webhookKey",
	"GatewayCheckout.idempotencyKey",
];

/**
 * `with t as (select ?::uuid as id), live(key) as (…)`: bind the studio's id
 * first; `live` holds every key a live record of that studio names.
 */
export const liveKeysCte = `with t as (select ?::uuid as id), live(key) as (${COUNTED.map(({ sql }) => sql).join(" union all ")})`;
