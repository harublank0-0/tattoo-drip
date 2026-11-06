import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	DEPOSIT_LINK_DAYS,
	DEPOSIT_TOKEN,
	depositPageUrl,
	hashToken,
	newTokenNonce,
	tokenFor,
} from "#modules/payments/deposit_links";
import { DepositLinkRuleError } from "#modules/payments/errors";
import DepositLink from "#modules/payments/models/deposit_link";
import DepositLinkService from "#modules/payments/services/deposit_link_service";
import ReferenceCode from "#modules/references/models/reference_code";
import { REFERENCE_CODE_PATTERN } from "#modules/references/reference_codes";
import ReferenceCodeService from "#modules/references/services/reference_code_service";
import { depositReady, depositServices, OWNER } from "#tests/helpers/deposits";
import { makePayment, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const services = depositServices();
const { links } = services;
const ARTIST = { userId: randomUUID(), role: "artist" as const };

/** A ReferenceCodeService whose first codes are the ones a test gives it. */
class ScriptedCodes extends ReferenceCodeService {
	codes: string[] = [];

	protected override newCode() {
		return this.codes.shift() ?? super.newCode();
	}
}

/** The links service, drawing its fresh codes from `codes`. */
const scriptedLinks = (codes: ScriptedCodes) =>
	new DepositLinkService(
		services.projects,
		services.quotes,
		services.deposits,
		services.methods,
		codes,
	);

const registered = (tenant: { id: string }) =>
	inTenant(tenant, async () =>
		(await ReferenceCode.query().orderBy("code")).map((row) => row.code),
	);

/** The DepositLinkRuleError reason a refused issue gives, or null if it went through. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof DepositLinkRuleError) return error.reason;
		throw error;
	}
}

const rows = (tenant: { id: string }) =>
	inTenant(tenant, () => DepositLink.query().orderBy("id"));

test.group("DepositLinkService.issue", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner makes the link: a 43-character token, only its hash and nonce stored, a 6-character code, 30 days", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-make-65");
		const { project } = await inTenant(tenant, () => depositReady(tenant));

		const { link, token, replaced } = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);

		assert.isFalse(replaced);
		assert.match(token, DEPOSIT_TOKEN);
		assert.equal(link.projectId, project.id);
		assert.equal(link.tokenHash, hashToken(token));
		assert.equal(tokenFor(link.tokenNonce), token);
		assert.match(link.referenceCode, /^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
		assert.closeTo(
			link.expiresAt.diff(DateTime.now(), "days").days,
			DEPOSIT_LINK_DAYS,
			0.01,
		);
		const stored = await rows(tenant);
		assert.lengthOf(stored, 1);
		assert.notInclude(
			JSON.stringify(stored[0].serialize()),
			token,
			"the token itself is never stored",
		);
	});

	test("making it again replaces the token and the expiry, keeps the row and the code; the old token is dead", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-replace-65");
		const { project } = await inTenant(tenant, () => depositReady(tenant));

		const first = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);
		const second = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);

		assert.isTrue(second.replaced);
		assert.notEqual(second.token, first.token);
		assert.equal(second.link.id, first.link.id);
		assert.equal(second.link.referenceCode, first.link.referenceCode);
		assert.lengthOf(await rows(tenant), 1);
		assert.isNull(
			await inTenant(tenant, () => links.resolve(tenant, first.token)),
		);
		assert.equal(
			(await inTenant(tenant, () => links.resolve(tenant, second.token)))?.id,
			first.link.id,
		);
	});

	test("anyone but an owner gets a 404, and no link", async ({ assert }) => {
		const { tenant } = await studioWithOwner("links-artist-65");
		const { project } = await inTenant(tenant, () => depositReady(tenant));

		await assert.rejects(
			() => inTenant(tenant, () => links.issue(tenant, ARTIST, project)),
			lucidErrors.E_ROW_NOT_FOUND,
		);
		assert.lengthOf(await rows(tenant), 0);
	});

	test("a project that isn't waiting for a deposit it can take gets no link", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-refuse-65");
		const cases = await inTenant(tenant, async () => {
			const quoted = await depositReady(tenant);
			quoted.project.status = "quoted";
			await quoted.project.save();
			const expired = await depositReady(tenant, {
				expiresAt: DateTime.utc().minus({ minutes: 1 }),
			});
			const zero = await depositReady(tenant, { depositAmount: 0 });
			const paid = await depositReady(tenant);
			await makePayment(tenant, paid.project, {
				amount: 300_000,
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			return [
				[quoted.project, "not_deposit_pending"],
				[expired.project, "quote_expired"],
				[zero.project, "nothing_due"],
				[paid.project, "nothing_due"],
			] as const;
		});

		for (const [project, reason] of cases) {
			assert.equal(
				await reasonOf(() =>
					inTenant(tenant, () => links.issue(tenant, OWNER, project)),
				),
				reason,
				reason,
			);
		}
		assert.lengthOf(await rows(tenant), 0);
	});

	test("a studio that shows no method on the deposit page gets no link", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-no-method-65");
		const { project } = await inTenant(tenant, async () => {
			const ready = await depositReady(tenant);
			ready.method.showOnDepositPage = false;
			await ready.method.save();
			return ready;
		});

		assert.equal(
			await reasonOf(() =>
				inTenant(tenant, () => links.issue(tenant, OWNER, project)),
			),
			"no_payment_methods",
		);
		assert.equal(
			await inTenant(tenant, () => links.issueProblem(tenant, project)),
			"no_payment_methods",
		);
	});

	test("a reference code the studio already uses is drawn again", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-code-65");
		const codes = new ScriptedCodes();
		const scripted = scriptedLinks(codes);
		const [one, two] = await inTenant(tenant, async () => [
			await depositReady(tenant),
			await depositReady(tenant),
		]);
		const first = await inTenant(tenant, () =>
			scripted.issue(tenant, OWNER, one.project),
		);
		const fresh = first.link.referenceCode === "ABCDEF" ? "ABCDEG" : "ABCDEF";
		codes.codes = [first.link.referenceCode, fresh];

		const second = await inTenant(tenant, () =>
			scripted.issue(tenant, OWNER, two.project),
		);

		assert.equal(second.link.referenceCode, fresh);
		assert.lengthOf(await rows(tenant), 2);
	});

	test("after five taken codes in a row it gives up", async ({ assert }) => {
		const { tenant } = await studioWithOwner("links-code-full-65");
		const codes = new ScriptedCodes();
		const scripted = scriptedLinks(codes);
		const [one, two] = await inTenant(tenant, async () => [
			await depositReady(tenant),
			await depositReady(tenant),
		]);
		const first = await inTenant(tenant, () =>
			scripted.issue(tenant, OWNER, one.project),
		);
		codes.codes = Array(5).fill(first.link.referenceCode);

		await assert.rejects(
			() => inTenant(tenant, () => scripted.issue(tenant, OWNER, two.project)),
			/reference_codes_tenant_id_code_unique/,
		);
		assert.lengthOf(await rows(tenant), 1);
	});

	test("an inquiry-born project's first link has the inquiry's reference", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-reuse");
		const { project } = await inTenant(tenant, async () => {
			// The intake registered the code with the inquiry.
			await ReferenceCode.create({ tenantId: tenant.id, code: "K7MP3Q" });
			return depositReady(tenant, {}, { inquiryReference: "K7MP3Q" });
		});

		const { link } = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);

		assert.equal(link.referenceCode, "K7MP3Q");
		assert.deepEqual(await registered(tenant), ["K7MP3Q"]);
	});

	test("a desk project's link has a fresh code, registered for the studio", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-desk");
		const { project } = await inTenant(tenant, () => depositReady(tenant));

		const { link } = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);

		assert.match(link.referenceCode, REFERENCE_CODE_PATTERN);
		assert.deepEqual(await registered(tenant), [link.referenceCode]);
	});

	test("a soft-deleted inquiry's project still takes the inquiry's reference", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-reuse-trashed");
		const { project } = await inTenant(tenant, async () => {
			await ReferenceCode.create({ tenantId: tenant.id, code: "K7MP3Q" });
			const ready = await depositReady(
				tenant,
				{},
				{ inquiryReference: "K7MP3Q" },
			);
			await ready.inquiry?.softDelete();
			return ready;
		});

		const { link } = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);

		assert.equal(link.referenceCode, "K7MP3Q");
	});

	test("an inquiry without a reference (an older one) gives its project a fresh code", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-old-inquiry");
		const { project } = await inTenant(tenant, () =>
			depositReady(tenant, {}, { inquiryReference: null }),
		);

		const { link } = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);

		assert.match(link.referenceCode, REFERENCE_CODE_PATTERN);
		assert.deepEqual(await registered(tenant), [link.referenceCode]);
	});

	test("when another link already holds the inquiry's code, the link gets a fresh code and the request goes on", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-reuse-taken");
		const { project, inquiry, client } = await inTenant(tenant, async () => {
			await ReferenceCode.create({ tenantId: tenant.id, code: "K7MP3Q" });
			return depositReady(tenant, {}, { inquiryReference: "K7MP3Q" });
		});
		await inTenant(tenant, () => links.issue(tenant, OWNER, project));
		// The first project is deleted; a second one comes from the same inquiry.
		const second = await inTenant(tenant, async () => {
			await project.softDelete();
			const again = await makeProject(tenant, client, {
				status: "deposit_pending",
				inquiryId: inquiry?.id ?? null,
			});
			await makeQuote(tenant, again);
			return again;
		});

		const { link, links: after } = await inTenant(tenant, async () => {
			const issued = await links.issue(tenant, OWNER, second);
			// The fallback rolled back only its own savepoint: the request's
			// transaction still answers.
			return { link: issued.link, links: await DepositLink.query() };
		});

		assert.notEqual(link.referenceCode, "K7MP3Q");
		assert.match(link.referenceCode, REFERENCE_CODE_PATTERN);
		assert.lengthOf(after, 2);
		assert.sameMembers(await registered(tenant), [
			"K7MP3Q",
			link.referenceCode,
		]);
	});
});

test.group("DepositLinkService.resolve and forProject", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("resolve finds a live link only: not an unknown, expired or another studio's token", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-resolve-a-65");
		const { tenant: other } = await studioWithOwner("links-resolve-b-65");
		const { project } = await inTenant(tenant, () => depositReady(tenant));
		const { project: theirs } = await inTenant(other, () =>
			depositReady(other),
		);
		const mine = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);
		const foreign = await inTenant(other, () =>
			links.issue(other, OWNER, theirs),
		);
		const resolve = (token: string) =>
			inTenant(tenant, () => links.resolve(tenant, token));

		assert.equal((await resolve(mine.token))?.id, mine.link.id);
		assert.isNull(await resolve(tokenFor(newTokenNonce())));
		assert.isNull(await resolve(foreign.token));
		assert.isNull(
			await inTenant(other, () => links.resolve(tenant, foreign.token)),
			"another studio's context with this studio's id finds nothing either",
		);

		await inTenant(tenant, async () => {
			mine.link.expiresAt = DateTime.utc().minus({ seconds: 1 });
			await mine.link.save();
		});
		assert.isNull(await resolve(mine.token));
	});

	test("resolve finds nothing once the nonce no longer derives the token (a rotated APP_KEY kills the link for the public too)", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-rotated-65");
		const { project } = await inTenant(tenant, () => depositReady(tenant));
		const { link, token } = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);
		assert.equal(
			(await inTenant(tenant, () => links.resolve(tenant, token)))?.id,
			link.id,
		);

		// A new APP_KEY changes what tokenFor gives for the same nonce; the
		// stored hash still matches the token that was handed out. Swapping
		// the nonce changes the derivation the same way.
		await inTenant(tenant, async () => {
			link.tokenNonce = newTokenNonce();
			await link.save();
		});

		assert.equal(
			link.tokenHash,
			hashToken(token),
			"the old hash still matches",
		);
		assert.isNull(await inTenant(tenant, () => links.resolve(tenant, token)));
		assert.isNull(
			(await inTenant(tenant, () => links.forProject(tenant, project)))?.url,
		);
	});

	test("forProject rebuilds the URL; it is null once the link expired or its hash stopped matching", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-page-65");
		const { project } = await inTenant(tenant, () => depositReady(tenant));
		const read = () =>
			inTenant(tenant, () => links.forProject(tenant, project));

		assert.isNull(await read());

		const { link, token } = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);
		const shown = await read();
		assert.equal(shown?.url, depositPageUrl(tenant.slug, token));
		assert.equal(shown?.referenceCode, link.referenceCode);
		assert.equal(shown?.expiresAt.toMillis(), link.expiresAt.toMillis());

		// What a rotated APP_KEY looks like: the nonce no longer gives the hash.
		await inTenant(tenant, async () => {
			link.tokenHash = "0".repeat(64);
			await link.save();
		});
		assert.isNull((await read())?.url);

		const fresh = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);
		await inTenant(tenant, async () => {
			fresh.link.expiresAt = DateTime.utc().minus({ seconds: 1 });
			await fresh.link.save();
		});
		const expired = await read();
		assert.isNull(expired?.url);
		assert.equal(expired?.referenceCode, link.referenceCode);
	});
});
