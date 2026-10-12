import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import User from "#models/user";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import PaymentMethod from "#modules/payments/models/payment_method";
import { LastOwnerError, SlugTakenError } from "#modules/tenancy/errors";
import Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient, withDbContext, withTransaction } from "#services/db_context";
import {
	inTenant,
	inTenantAs,
	inUser,
	studioWithOwner,
} from "#tests/helpers/tenants";

const tenancy = new TenancyService();

function makeUser(email: string) {
	return User.create({ email, password: "secret-password" });
}

function studio(slug: string) {
	return {
		type: "studio" as const,
		name: "Black Needle",
		slug,
		timezone: "Asia/Kathmandu",
	};
}

/**
 * Deletes the tenant row only and leaves its memberships live: the state the
 * services' deleted-tenant filters defend against. Tenant.softDelete cascades
 * to the memberships, which would hide them before those filters are reached.
 */
function stampDeleted(tenant: Tenant) {
	return inTenant(tenant, () =>
		dbClient().rawQuery("update tenants set deleted_at = now() where id = ?", [
			tenant.id,
		]),
	);
}

test.group("TenancyService.createTenant", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("creates the tenant with its creator as owner", async ({ assert }) => {
		const owner = await makeUser("owner@example.com");

		const tenant = await tenancy.createTenant(owner, studio("black-needle"));

		assert.equal(tenant.slug, "black-needle");
		assert.equal(tenant.type, "studio");
		const memberships = await inTenant(tenant, () =>
			TenantMembership.query().where("tenant_id", tenant.id),
		);
		assert.lengthOf(memberships, 1);
		assert.equal(memberships[0].userId, owner.id);
		assert.equal(memberships[0].role, "owner");
	});

	test("turns a taken slug into SlugTakenError and creates nothing", async ({
		assert,
	}) => {
		const first = await makeUser("first@example.com");
		const second = await makeUser("second@example.com");
		await tenancy.createTenant(first, studio("black-needle"));

		// Same slug again: what a second signup racing past validation does.
		await assert.rejects(
			() => tenancy.createTenant(second, studio("black-needle")),
			SlugTakenError,
		);

		// As the user: their own membership would show here had it been created.
		const secondMemberships = await inUser(second, () =>
			TenantMembership.query().where("user_id", second.id),
		);
		assert.lengthOf(secondMemberships, 0);
	});

	test("a taken slug leaves the surrounding transaction usable and restores the context", async ({
		assert,
	}) => {
		const first = await makeUser("first@example.com");
		await tenancy.createTenant(first, studio("black-needle"));
		const second = await makeUser("second@example.com");

		await withDbContext({ userId: second.id }, async () => {
			await assert.rejects(
				() => tenancy.createTenant(second, studio("black-needle")),
				SlugTakenError,
			);

			const { rows } = await dbClient().rawQuery(
				"select current_setting('app.tenant_id', true) as tenant_id",
			);
			assert.notOk(rows[0].tenant_id);
		});
	});

	test("the tenant is stored under the id the model is given", async ({
		assert,
	}) => {
		const { rows } = await db.rawQuery("select uuidv7() as id");
		const id: string = rows[0].id;

		// createTenant relies on this: its inserts run in the context of an id
		// chosen before the row exists, so the row must be stored under it.
		await inTenant({ id }, async () => {
			const tenant = await Tenant.create({ id, ...studio("black-needle") });

			assert.equal(tenant.id, id);
			assert.equal((await Tenant.findOrFail(id)).slug, "black-needle");
		});
	});

	test("an independent artist gets a visible profile named after the tenant, linked to them", async ({
		assert,
	}) => {
		const owner = await makeUser("owner@example.com");

		const tenant = await tenancy.createTenant(owner, {
			...studio("sita-rai"),
			type: "independent",
			name: "Sita Rai",
		});

		const profiles = await inTenant(tenant, () =>
			Artist.query().where("tenant_id", tenant.id),
		);
		assert.lengthOf(profiles, 1);
		assert.equal(profiles[0].name, "Sita Rai");
		assert.equal(profiles[0].slug, "sita-rai");
		assert.equal(profiles[0].userId, owner.id);
		assert.isTrue(profiles[0].visible);
		assert.isTrue(profiles[0].acceptingInquiries);
	});

	test("a studio gets no automatic profile", async ({ assert }) => {
		const owner = await makeUser("owner@example.com");

		const tenant = await tenancy.createTenant(owner, studio("black-needle"));

		assert.isEmpty(
			await inTenant(tenant, () =>
				Artist.query().where("tenant_id", tenant.id),
			),
		);
	});

	test("a failing profile step rolls the tenant, its owner and the profile back", async ({
		assert,
	}) => {
		const owner = await makeUser("owner@example.com");
		const real = new ArtistService(new ImageService());
		let tenantId = "";
		// Inserts the profile for real, then fails: all of it must roll back.
		const failing = new TenancyService({
			createOwnerProfile: async (tenant, member) => {
				tenantId = tenant.id;
				await real.createOwnerProfile(tenant, member);
				throw new Error("profile failed");
			},
		});

		await assert.rejects(
			() =>
				failing.createTenant(owner, {
					...studio("sita-rai"),
					type: "independent",
				}),
			"profile failed",
		);

		assert.isNotEmpty(tenantId, "the profile step ran");
		await inTenant({ id: tenantId }, async () => {
			assert.isNull(await Tenant.find(tenantId));
			assert.isEmpty(
				await TenantMembership.query().where("tenant_id", tenantId),
			);
			assert.isEmpty(await Artist.query().where("tenant_id", tenantId));
		});
	});
});

test.group("TenancyService.tenantsFor", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists only the user's tenants, with roles, oldest first", async ({
		assert,
	}) => {
		const ada = await makeUser("ada@example.com");
		const ben = await makeUser("ben@example.com");
		const own = await tenancy.createTenant(ada, studio("ada-ink"));
		const other = await tenancy.createTenant(ben, studio("ben-ink"));
		await inTenant(other, () =>
			TenantMembership.create({
				tenantId: other.id,
				userId: ada.id,
				role: "artist",
			}),
		);
		await tenancy.createTenant(ben, studio("ben-only"));

		// From inside ben-ink: ben's owner membership is visible there, so only
		// the service's own user filter keeps it out of ada's list.
		const result = await inTenantAs(other, ada, () => tenancy.tenantsFor(ada));
		// What /dashboard runs: as the user, with no tenant.
		const onDashboard = await inUser(ada, () => tenancy.tenantsFor(ada));

		const expected = [
			[own.slug, "owner"],
			[other.slug, "artist"],
		];
		for (const list of [result, onDashboard]) {
			assert.deepEqual(
				list.map(({ tenant, role }) => [tenant.slug, role]),
				expected,
			);
		}
	});

	test("skips a deleted tenant whose membership is still live", async ({
		assert,
	}) => {
		const user = await makeUser("ada@example.com");
		const deleted = await tenancy.createTenant(user, studio("black-needle"));
		await tenancy.createTenant(user, studio("kept-ink"));
		const slugs = async () =>
			(await inTenantAs(deleted, user, () => tenancy.tenantsFor(user))).map(
				({ tenant }) => tenant.slug,
			);
		assert.deepEqual(await slugs(), ["black-needle", "kept-ink"]);

		await stampDeleted(deleted);

		// Inside the deleted tenant, where it and the user's live membership are
		// both visible to row-level security: the service must hide it.
		assert.deepEqual(await slugs(), ["kept-ink"]);
	});
});

test.group("TenancyService.membershipFor", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("returns the tenant and membership for a member", async ({ assert }) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));

		const found = await inUser(owner, () =>
			tenancy.membershipFor(owner, "black-needle"),
		);

		assert.equal(found?.tenant.id, tenant.id);
		assert.equal(found?.membership.userId, owner.id);
		assert.equal(found?.membership.role, "owner");
	});

	test("returns null for every non-member case", async ({ assert }) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		const stranger = await makeUser("stranger@example.com");
		await tenancy.createTenant(stranger, studio("red-ink"));

		// Row-level security alone hides the studio from a stranger, so look
		// from inside it: the owner's membership is visible there, and only the
		// service's own user filter keeps the stranger out.
		assert.isNull(
			await inTenantAs(tenant, stranger, () =>
				tenancy.membershipFor(stranger, "black-needle"),
			),
		);
		assert.isNull(
			await inUser(owner, () => tenancy.membershipFor(owner, "no-such-studio")),
		);
		assert.isNull(
			await inUser(owner, () => tenancy.membershipFor(owner, "Black-Needle")),
		);

		await inTenant(tenant, () => tenant.softDelete());
		// The deleted tenant and the owner's membership are still visible to
		// the tenant context; the service must be the one to hide them.
		assert.isNull(
			await inTenantAs(tenant, owner, () =>
				tenancy.membershipFor(owner, "black-needle"),
			),
		);
	});

	test("soft-deleting a tenant soft-deletes its payment methods", async ({
		assert,
	}) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		await inTenant(tenant, async () => {
			await PaymentMethod.create({
				tenantId: tenant.id,
				kind: "cash",
				label: "Cash",
				showOnDepositPage: false,
				position: 0,
			});

			await tenant.softDelete();

			assert.isEmpty(await PaymentMethod.query().where("tenant_id", tenant.id));
			assert.lengthOf(
				await PaymentMethod.onlyTrashed().where("tenant_id", tenant.id),
				1,
			);
		});
	});

	test("soft-deleting a tenant soft-deletes its artists and keeps an earlier delete as it was", async ({
		assert,
	}) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, {
			...studio("sita-rai"),
			type: "independent",
		});
		const artists = new ArtistService(new ImageService());

		await inTenant(tenant, async () => {
			const removed = await artists.create(
				tenant,
				{
					name: "Old",
					slug: "old",
					bio: null,
					visible: true,
					acceptingInquiries: true,
					closedMessage: null,
					linkToMe: false,
				},
				owner,
			);
			await artists.delete(tenant, removed);
			const removedAt = (
				await Artist.withTrashed().where("id", removed.id).firstOrFail()
			).deletedAt?.toMillis();

			await tenant.softDelete();

			assert.isEmpty(await Artist.query().where("tenant_id", tenant.id));
			const trashed = await Artist.onlyTrashed().where("tenant_id", tenant.id);
			assert.lengthOf(trashed, 2, "the automatic profile and the removed one");
			assert.equal(
				trashed.find(({ id }) => id === removed.id)?.deletedAt?.toMillis(),
				removedAt,
			);
		});
	});

	test("returns null once the membership is removed", async ({ assert }) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		const artistUser = await makeUser("artist@example.com");
		await inTenant(tenant, async () => {
			const artist = await TenantMembership.create({
				tenantId: tenant.id,
				userId: artistUser.id,
				role: "artist",
			});
			await artist.softDelete();
		});

		// As the artist inside the studio, where the removed membership is
		// still visible to row-level security: the service must hide it.
		assert.isNull(
			await inTenantAs(tenant, artistUser, () =>
				tenancy.membershipFor(artistUser, "black-needle"),
			),
		);
	});

	test("returns null for a deleted tenant whose membership is still live", async ({
		assert,
	}) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		const find = () =>
			inTenantAs(tenant, owner, () =>
				tenancy.membershipFor(owner, "black-needle"),
			);
		assert.isNotNull(await find());

		await stampDeleted(tenant);

		assert.isNull(await find());
	});
});

test.group("TenancyService.hasTenant", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("is true with a live tenant, false without one", async ({ assert }) => {
		const withTenant = await makeUser("with@example.com");
		const without = await makeUser("without@example.com");
		const tenant = await tenancy.createTenant(
			withTenant,
			studio("black-needle"),
		);

		assert.isTrue(
			await inUser(withTenant, () => tenancy.hasTenant(withTenant)),
		);
		// Inside the studio: the owner's membership is visible there, so only
		// the service's own user filter keeps it from counting for `without`.
		assert.isFalse(
			await inTenantAs(tenant, without, () => tenancy.hasTenant(without)),
		);
	});

	test("is false once the user's only tenant is deleted", async ({
		assert,
	}) => {
		const user = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(user, studio("black-needle"));

		await inTenant(tenant, () => tenant.softDelete());

		// Inside the studio, where its rows are still visible to row-level
		// security: the service must be the one to hide the deleted tenant.
		assert.isFalse(
			await inTenantAs(tenant, user, () => tenancy.hasTenant(user)),
		);
	});

	test("is false for a deleted tenant whose membership is still live", async ({
		assert,
	}) => {
		const user = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(user, studio("black-needle"));
		const has = () => inTenantAs(tenant, user, () => tenancy.hasTenant(user));
		assert.isTrue(await has());

		await stampDeleted(tenant);

		assert.isFalse(await has());
	});
});

test.group("TenancyService.assertKeepsAnOwner", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	async function ownerAndTenant() {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		const membership = await inTenant(tenant, () =>
			TenantMembership.query().where("tenant_id", tenant.id).firstOrFail(),
		);
		return { tenant, membership };
	}

	test("rejects losing the only owner", async ({ assert }) => {
		const { tenant, membership } = await ownerAndTenant();

		await assert.rejects(
			() =>
				inTenant(tenant, () =>
					withTransaction((trx) =>
						tenancy.assertKeepsAnOwner(trx, tenant.id, membership.id),
					),
				),
			LastOwnerError,
		);
	});

	test("allows losing an owner when another owner remains", async ({
		assert,
	}) => {
		const { tenant, membership } = await ownerAndTenant();
		const second = await makeUser("second@example.com");
		await inTenant(tenant, () =>
			TenantMembership.create({
				tenantId: tenant.id,
				userId: second.id,
				role: "owner",
			}),
		);

		await assert.doesNotReject(() =>
			inTenant(tenant, () =>
				withTransaction((trx) =>
					tenancy.assertKeepsAnOwner(trx, tenant.id, membership.id),
				),
			),
		);
	});

	test("rejects a membership id from another tenant", async ({ assert }) => {
		const { tenant } = await ownerAndTenant();
		const stranger = await makeUser("stranger@example.com");
		const otherTenant = await tenancy.createTenant(
			stranger,
			studio("other-ink"),
		);
		const otherMembership = await inTenant(otherTenant, () =>
			TenantMembership.query().where("tenant_id", otherTenant.id).firstOrFail(),
		);

		// A caller bug: the id doesn't belong to this tenant. The guard must
		// not wave the change through. The stranger's own membership is visible
		// to row-level security here (it is theirs), so the guard's tenant
		// filter is what rejects it.
		await assert.rejects(
			() =>
				inTenantAs(tenant, stranger, () =>
					withTransaction((trx) =>
						tenancy.assertKeepsAnOwner(trx, tenant.id, otherMembership.id),
					),
				),
			/not a live membership/,
		);
	});

	test("allows losing an artist", async ({ assert }) => {
		const { tenant } = await ownerAndTenant();
		const artistUser = await makeUser("artist@example.com");
		const artist = await inTenant(tenant, () =>
			TenantMembership.create({
				tenantId: tenant.id,
				userId: artistUser.id,
				role: "artist",
			}),
		);

		await assert.doesNotReject(() =>
			inTenant(tenant, () =>
				withTransaction((trx) =>
					tenancy.assertKeepsAnOwner(trx, tenant.id, artist.id),
				),
			),
		);
	});
});

const profile = {
	name: "Black Needle Tattoo",
	timezone: "Asia/Kathmandu",
	intro: "Fine-line and blackwork in Thamel.",
	contactPhone: "+9779812345678",
	contactEmail: "hello@blackneedle.example",
	address: "Thamel, Kathmandu",
	instagramUrl: "https://instagram.com/blackneedle",
	facebookUrl: null,
	tiktokUrl: null,
	websiteUrl: "https://blackneedle.example",
};

test.group("TenancyService profile and deposits", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("updateProfile saves every profile field and keeps slug and type", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, () =>
			new TenancyService().updateProfile(tenant, profile),
		);

		const saved = await inTenant(tenant, () => Tenant.findOrFail(tenant.id));
		for (const [key, value] of Object.entries(profile)) {
			assert.deepEqual(saved[key as keyof typeof profile], value, key);
		}
		assert.equal(saved.slug, "black-needle");
		assert.equal(saved.type, "studio");
	});

	test("updateProfile with nulls clears the fields", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		await inTenant(tenant, () => tenancy.updateProfile(tenant, profile));

		await inTenant(tenant, () =>
			tenancy.updateProfile(tenant, {
				...profile,
				intro: null,
				contactPhone: null,
				instagramUrl: null,
			}),
		);

		const saved = await inTenant(tenant, () => Tenant.findOrFail(tenant.id));
		assert.isNull(saved.intro);
		assert.isNull(saved.contactPhone);
		assert.isNull(saved.instagramUrl);
	});

	test("updateDepositSettings saves and clears the default", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, () =>
			tenancy.updateDepositSettings(tenant, {
				defaultDepositPercent: 30,
				depositPolicy: "Deposits hold your date.",
			}),
		);
		let saved = await inTenant(tenant, () => Tenant.findOrFail(tenant.id));
		assert.equal(saved.defaultDepositPercent, 30);
		assert.equal(saved.depositPolicy, "Deposits hold your date.");

		await inTenant(tenant, () =>
			tenancy.updateDepositSettings(tenant, {
				defaultDepositPercent: null,
				depositPolicy: null,
			}),
		);
		saved = await inTenant(tenant, () => Tenant.findOrFail(tenant.id));
		assert.isNull(saved.defaultDepositPercent);
		assert.isNull(saved.depositPolicy);
	});

	test("the database refuses a deposit over 100%", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		// In the tenant's context, so the update reaches the row and the check
		// constraint is what refuses it (without it the policy would hide the
		// row and nothing would be thrown).
		await assert.rejects(
			() =>
				inTenant(tenant, () =>
					tenancy.updateDepositSettings(tenant, {
						defaultDepositPercent: 101,
						depositPolicy: null,
					}),
				),
			/tenants_default_deposit_percent_range/,
		);
	});
});
