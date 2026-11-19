import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import AllowanceBundle from "#modules/packages/models/allowance_bundle";
import PilotGrant from "#modules/packages/models/pilot_grant";
import StoredFile from "#modules/storage/models/stored_file";
import type Tenant from "#modules/tenancy/models/tenant";
import env from "#start/env";
import { addArtist } from "#tests/helpers/artists";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

export const MB = 1048576;

/** STORAGE_ENFORCEMENT for this test; `unsetStorageEnforcement` in teardown. */
export function enforceStorage(on: boolean) {
	env.set("STORAGE_ENFORCEMENT", (on ? "enforce" : "observe") as never);
}

/**
 * Leaves STORAGE_ENFORCEMENT unset again, in env and process.env (which
 * child processes of later specs inherit).
 */
export function unsetStorageEnforcement() {
	env.set("STORAGE_ENFORCEMENT", undefined as never);
	delete process.env.STORAGE_ENFORCEMENT;
}

/** An artist whose photo is a stored size row of `bytes`, so usage counts it. */
export async function fillStorage(
	tenant: Tenant,
	owner: { id: string },
	bytes: number,
) {
	const artist = await addArtist(tenant, owner);
	const key = `tenants/${tenant.id}/artist_photo/${crypto.randomUUID()}.jpg`;
	await inTenant(tenant, async () => {
		await Artist.query().where("id", artist.id).update({
			photo_key: key,
			photo_width: 100,
			photo_height: 100,
		});
		await StoredFile.create({
			tenantId: tenant.id,
			key,
			purpose: "artist_photo",
			bytes,
			status: "stored",
			storedAt: DateTime.utc(),
		});
	});
	return artist;
}

/**
 * A Solo studio on a 1 MB test bundle (a pilot grant), `used` bytes of it
 * taken by its artist's (`artist`) photo. Inside a global transaction.
 */
export async function smallStudio(slug: string, used: number) {
	const { tenant, owner } = await studioWithOwner(slug, `Studio ${slug}`);
	const bundle = await AllowanceBundle.create({
		key: `test-1mb-${slug}`,
		package: "solo",
		imagesPerMonth: 40,
		storageMegabytes: 1,
	});
	await inTenant(tenant, () =>
		PilotGrant.create({
			tenantId: tenant.id,
			package: "solo",
			allowanceBundleId: bundle.id,
			startsAt: DateTime.utc().minus({ days: 1 }),
			endsAt: DateTime.utc().plus({ months: 1 }),
			note: "Storage test",
			grantedBy: "Ops",
		}),
	);
	const artist = await fillStorage(tenant, owner, used);
	return { tenant, owner, artist };
}

/** The studio's size rows, oldest first. */
export const storedFilesOf = (tenant: Pick<Tenant, "id">) =>
	inTenant(tenant as Tenant, () => StoredFile.query().orderBy("created_at"));
