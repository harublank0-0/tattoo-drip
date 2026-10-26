import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import type { Assert } from "@japa/assert";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import TattooProject from "#modules/projects/models/tattoo_project";
import WaitingService from "#modules/projects/services/waiting_service";
import {
	makeClient,
	makeDepositLink,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { inTenant, inTenantAs } from "#tests/helpers/tenants";
import { seedGroups, studio } from "#tests/helpers/waiting_fixtures";

type Who = Parameters<ReturnType<ApiClient["get"]>["loginAs"]>[0];
type Step = {
	kind: string;
	title: string;
	text: string | null;
	anchor: string | null;
	needsYou: boolean;
};

/**
 * The project page's Next step card and Today's rows (TAT-107) and the Projects list (TAT-109)
 * come from one rule set, WaitingService.forProjects. These tests read every seeded project from
 * WaitingService.work and from its page and pin that they agree, so a rule changed in one place
 * can't leave the page saying something else.
 */
test.group("Next step agreement (TAT-108)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	/** Today's words appear whole in the card's text for these reasons (rows 2 to 9 and 11). */
	const SAYS_TODAYS_WORDS = new Set([
		"price_to_send",
		"quote_ending",
		"deposit_link_missing",
		"deposit_unpaid",
		"no_session",
		"price_sent",
		"deposit_link_sent",
	]);

	async function workFor(
		tenant: { id: string; timezone: string },
		user: { id: string },
		role: "owner" | "artist",
	) {
		const service = await app.container.make(WaitingService);
		return inTenantAs(tenant, user, () =>
			service.work(tenant, { userId: user.id, role }, DateTime.now()),
		);
	}

	async function stepOf(
		client: ApiClient,
		slug: string,
		user: Who,
		projectId: string,
	): Promise<Step> {
		const response = await client
			.get(`/t/${slug}/projects/${projectId}`)
			.withInertia()
			.loginAs(user);
		response.assertStatus(200);
		return response.inertiaProps.nextStep;
	}

	/** The seeded groups plus a project of each state the groups don't cover. */
	async function seed(s: Awaited<ReturnType<typeof studio>>) {
		return inTenant(s.tenant, async () => {
			const made = await seedGroups(s.tenant, null, 1);
			const extra = async (
				status: "on_hold" | "deposit_pending" | "booked" | "in_progress",
				name: string,
				quote = true,
			) => {
				const project = await makeProject(
					s.tenant,
					await makeClient(s.tenant, { name }),
					{ status },
				);
				if (quote) await makeQuote(s.tenant, project);
				return project;
			};
			const onHold = await extra("on_hold", "On hold one");
			const young = await extra("deposit_pending", "Young link");
			await makeDepositLink(s.tenant, young, {
				updatedAt: DateTime.utc().minus({ days: 1 }),
			});
			const noLink = await extra("deposit_pending", "No link");
			// Nothing waits on these two.
			const withSession = await extra("booked", "Has a session", false);
			await makeSession(s.tenant, withSession, s.ashaProfile, {
				startsAt: DateTime.now().plus({ days: 3 }).startOf("hour"),
				endsAt: DateTime.now().plus({ days: 3, hours: 2 }).startOf("hour"),
			});
			const inChair = await extra("in_progress", "In the chair", false);
			return {
				ids: [
					...made.proof,
					...made.price,
					...made.ending,
					...made.deposit,
					...made.booked,
					...made.sent,
					onHold,
					young,
					noLink,
					withSession,
					inChair,
				].map(({ id }) => id),
				quiet: [withSession.id, inChair.id],
			};
		});
	}

	async function agree(
		assert: Assert,
		client: ApiClient,
		s: Awaited<ReturnType<typeof studio>>,
		user: Who,
		role: "owner" | "artist",
		ids: string[],
		quiet: string[],
	) {
		const work = await workFor(s.tenant, user, role);
		const items = [...work.needsYou, ...work.onClient];
		const seen = new Set<string>();
		const slug = s.tenant.slug;
		for (const item of items) {
			if (!ids.includes(item.project.id)) continue;
			const step = await stepOf(client, slug, user, item.project.id);
			const label = `${role} ${item.waiting.reason}`;
			seen.add(item.waiting.reason);
			// The card the member acts on, and whether it needs them.
			assert.equal(step.anchor, item.hash, `${label}: card`);
			assert.equal(
				step.needsYou,
				item.waiting.side === "studio",
				`${label}: needsYou`,
			);
			if (SAYS_TODAYS_WORDS.has(item.waiting.reason)) {
				assert.include(step.text ?? "", item.text, `${label}: words`);
			}
		}
		for (const id of quiet) {
			assert.isTrue(
				items.every((item) => item.project.id !== id),
				"a quiet project waits on nobody",
			);
			assert.isFalse(
				(await stepOf(client, slug, user, id)).needsYou,
				"a quiet project does not need the member",
			);
		}
		return seen;
	}

	test("the owner's page agrees with Today for every kind of wait", async ({
		client,
		assert,
	}) => {
		const s = await studio("agree-108");
		const { ids, quiet } = await seed(s);

		const seen = await agree(assert, client, s, s.owner, "owner", ids, quiet);

		// The loop must have looked at every reason an owner can have, or it proves nothing.
		assert.sameMembers(
			[...seen],
			[
				"proof_to_check",
				"price_to_send",
				"quote_ending",
				"deposit_unpaid",
				"deposit_link_missing",
				"deposit_link_sent",
				"no_session",
				"price_sent",
				"on_hold",
			],
		);
	});

	test("the artist's page agrees with Today for their projects", async ({
		client,
		assert,
	}) => {
		const s = await studio("agree-artist-108");
		const { ids, quiet } = await seed(s);
		await inTenant(s.tenant, () =>
			TattooProject.query()
				.where("tenant_id", s.tenant.id)
				.update({ artistId: s.ashaProfile.id }),
		);

		const seen = await agree(assert, client, s, s.asha, "artist", ids, quiet);

		assert.includeMembers(
			[...seen],
			["price_to_send", "quote_ending", "no_session", "deposit_due", "on_hold"],
		);
		// An artist is never told about a screenshot: it reads as a deposit not yet paid.
		assert.notInclude([...seen], "proof_to_check");
	});

	test("a finished project's money line in the list is the page's card title", async ({
		client,
		assert,
	}) => {
		const s = await studio("agree-money-108");
		const completed = await inTenant(s.tenant, async () => {
			const project = await makeProject(
				s.tenant,
				await makeClient(s.tenant, { name: "Finished and owing" }),
				{ status: "completed", artistId: s.ashaProfile.id },
			);
			await makeQuote(s.tenant, project);
			return project;
		});

		const response = await client
			.get(`/t/${s.tenant.slug}/projects?status=closed`)
			.withInertia()
			.loginAs(s.owner);
		response.assertStatus(200);
		const row = response.inertiaProps.projects.find(
			({ id }: { id: string }) => id === completed.id,
		);
		assert.equal(row.line.text, "NPR 15,000 still due");
		const step = await stepOf(client, s.tenant.slug, s.owner, completed.id);
		assert.equal(step.title, row.line.text);
		assert.equal(step.kind, "collect_balance");
	});
});
