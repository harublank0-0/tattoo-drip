import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { signReferral } from "#modules/discovery/referral";
import Inquiry from "#modules/inquiries/models/inquiry";
import { storefrontTemplate } from "#modules/payments/deposit_links";
import { dbClient } from "#services/db_context";
import { studioHostname } from "#services/storefront_url";
import { addArtist } from "#tests/helpers/artists";
import { intakeFields, postInquiry } from "#tests/helpers/intake";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Discover's referral at the intake (D03, docs/discover/api.md, "Referral"):
 * a token Discover signed for this studio marks the inquiry `discover`; any
 * other token, or none, marks nothing and never refuses the inquiry. The
 * client's own `sourceChannel` stays what it said.
 */
const SLUG = "referral-needle-03";
const DAY = 24 * 60 * 60 * 1000;

async function only(tenant: { id: string }) {
	const rows = await inTenant(tenant, () => Inquiry.query());
	if (rows.length !== 1)
		throw new Error(`expected one inquiry, got ${rows.length}`);
	return rows[0];
}

test.group("Discover referral at POST /inquiries", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		queue.fake();
		return () => queue.restore();
	});

	test("a token Discover signed for this studio marks the inquiry, beside its sourceChannel", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const issued = new Date(Date.now() - 3 * DAY);

		const response = await postInquiry(
			client,
			SLUG,
			intakeFields({ referral: signReferral(tenant.id, issued) }),
		);

		response.assertStatus(201);
		assert.deepEqual(Object.keys(response.body().data).sort(), [
			"id",
			"reference",
		]);
		const inquiry = await only(tenant);
		assert.equal(inquiry.referralSource, "discover");
		assert.equal(
			inquiry.referralIssuedAt?.toMillis(),
			Math.floor(issued.getTime() / 1000) * 1000,
		);
		assert.equal(inquiry.sourceChannel, "instagram");
	});

	for (const [name, token] of [
		["none", undefined],
		["empty", ""],
		["garbage", "not-a-token"],
		["oversized", "a".repeat(5000)],
		["forged", "eyJ2IjoxfQ.c2lnbmF0dXJl"],
	] as const) {
		test(`a ${name} referral takes the inquiry and marks nothing`, async ({
			client,
			assert,
		}) => {
			const { tenant } = await studioWithOwner(SLUG);
			const fields = intakeFields(
				token === undefined ? {} : { referral: token },
			);

			(await postInquiry(client, SLUG, fields)).assertStatus(201);

			const inquiry = await only(tenant);
			assert.isNull(inquiry.referralSource);
			assert.isNull(inquiry.referralIssuedAt);
		});
	}

	test("another studio's token or an expired one takes the inquiry and marks nothing", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const other = await studioWithOwner("referral-other-03");

		for (const referral of [
			signReferral(other.tenant.id),
			signReferral(tenant.id, new Date(Date.now() - 31 * DAY)),
		]) {
			(
				await postInquiry(
					client,
					SLUG,
					intakeFields({ referral, contactPhone: "9812345670" }),
				)
			).assertStatus(201);
		}
		const rows = await inTenant(tenant, () => Inquiry.query());
		assert.lengthOf(rows, 2);
		for (const row of rows) assert.isNull(row.referralSource);
	});

	test("a token in the query string counts for nothing: only the body is read", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);

		(
			await postInquiry(client, SLUG, intakeFields()).qs({
				referral: signReferral(tenant.id),
			})
		).assertStatus(201);

		assert.isNull((await only(tenant)).referralSource);
	});

	test("the attribution is written once: the guard refuses a later change", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		(await postInquiry(client, SLUG, intakeFields())).assertStatus(201);
		const inquiry = await only(tenant);

		const refusal = await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update inquiries set referral_source = 'discover', referral_issued_at = now() where id = ?",
				[inquiry.id],
			),
		).then(
			() => null,
			(error: Error) => error.message,
		);
		assert.match(refusal ?? "", /inquiries_guard_update: .*referral/);
		assert.isNull((await only(tenant)).referralSource);
	});
});

/**
 * The hand-off end to end (D08): the link Discover's profile pages use, as
 * the API serves it, carried into the intake the way the storefront's
 * `/book` does (`ref` → `referral`). Only the studio the link was made for
 * records it.
 */
test.group("Discover booking hand-off, profile to inquiry", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		queue.fake();
		return () => queue.restore();
	});

	async function listed(slug: string, name: string) {
		const studio = await studioWithOwner(slug, name);
		await inTenant(studio.tenant, () =>
			dbClient().rawQuery(
				`update tenants set discovery_listed = true, discovery_listed_at = now(),
				 place_id = (select id from places where country_code = 'NP' and slug = 'kathmandu')
				 where id = ?`,
				[studio.tenant.id],
			),
		);
		return studio;
	}

	test("a studio artist's bookingUrl: the studio's /book naming the artist, whose ref the intake records", async ({
		client,
		assert,
	}) => {
		const studio = await listed("handoff-needle-08", "Handoff Needle");
		const maya = await addArtist(studio.tenant, studio.owner, {
			name: "Maya Lama",
			slug: "maya",
			styles: ["fine-line"],
		});

		const profile = await client.get(
			"/api/v1/discover/studios/handoff-needle-08/artists/maya",
		);
		profile.assertStatus(200);
		const booking = new URL(profile.body().data.bookingUrl);
		// Where Discover sends the visitor: this studio's own site, its /book,
		// this artist by slug, and a referral.
		assert.equal(
			booking.hostname,
			studioHostname(storefrontTemplate(), "handoff-needle-08"),
		);
		assert.equal(booking.pathname, "/book");
		assert.equal(booking.searchParams.get("artist"), "maya");
		const ref = booking.searchParams.get("ref");
		assert.isString(ref);
		// The studio profile's link carries the same kind of token, no artist.
		const studioLink = new URL(
			(await client.get("/api/v1/discover/studios/handoff-needle-08")).body()
				.data.bookingUrl,
		);
		assert.isNull(studioLink.searchParams.get("artist"));

		(
			await postInquiry(
				client,
				"handoff-needle-08",
				intakeFields({ referral: ref as string, preferredArtistId: maya.id }),
			)
		).assertStatus(201);

		const inquiry = await only(studio.tenant);
		assert.equal(inquiry.referralSource, "discover");
		assert.isNotNull(inquiry.referralIssuedAt);
		assert.equal(inquiry.sourceChannel, "instagram");
		assert.equal(inquiry.preferredArtistId, maya.id);
	});

	test("one studio's link used at another studio: the inquiry goes through, with no referral", async ({
		client,
		assert,
	}) => {
		await listed("handoff-needle-08", "Handoff Needle");
		const other = await studioWithOwner("handoff-other-08", "Handoff Other");
		const link = new URL(
			(await client.get("/api/v1/discover/studios/handoff-needle-08")).body()
				.data.bookingUrl,
		);

		(
			await postInquiry(
				client,
				"handoff-other-08",
				intakeFields({ referral: link.searchParams.get("ref") as string }),
			)
		).assertStatus(201);

		assert.isNull((await only(other.tenant)).referralSource);
	});
});
