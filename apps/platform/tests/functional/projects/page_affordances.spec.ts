import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { expiresAtFor } from "#modules/projects/quotes";
import { proofFor } from "#tests/helpers/payments";
import {
	makeArtist,
	makeClient,
	makeDepositLink,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `PageModule` below restates its shape and the inertia project type-checks the real one.
import * as pageModule from "../../../inertia/components/project_page.js";

type Place = "step" | "card" | null;
type PageModule = {
	AFFORDANCES: readonly string[];
	placementsOf(page: unknown): Record<string, Place>;
	idsOnPage(page: unknown): string[];
};
const { AFFORDANCES, placementsOf, idsOnPage } = pageModule as PageModule;

const KTM = "Asia/Kathmandu";
const dayFromNow = (days: number) =>
	DateTime.now().setZone(KTM).plus({ days }).toFormat("yyyy-MM-dd");

// biome-ignore lint/suspicious/noExplicitAny: the page props are read by name, as the page does.
type Props = any;

/**
 * What the page that existed before TAT-108 (9ac7621: apps/platform/inertia/pages/projects/show.tsx and
 * its cards) offered for these props, by name. That page was a pure function of its props, so this is
 * its matrix: the status card (Mark contacted unless closed, the moves, the artist picker), the
 * Finish card, the Quote card (price form, the quote's message, Client accepted), the Deposit card,
 * the Payments card (the outcome form, the screenshots, Record payment, Record a refund), the
 * Sessions card's Schedule button and the Issue/Revise quote card.
 */
function oldPageOffered(props: Props): string[] {
	const offered: string[] = [];
	if (!props.closed) offered.push("mark_contacted");
	for (const move of props.moves) offered.push(move);
	if (props.assignment) offered.push("assign_artist");
	if (props.finish) offered.push("finish");
	if (props.scheduling) offered.push("schedule");
	if (props.message) offered.push("send_quote");
	if (props.canAccept && props.quote) offered.push("client_accepted");
	if (props.canSetPrice && !props.quote) offered.push("set_price");
	if (props.canQuote)
		offered.push(props.quote ? "revise_quote" : "issue_quote");
	if (props.deposit) offered.push("deposit_link");
	const money = props.payments;
	if (money?.pending.length > 0) offered.push("verify_proof");
	if (money?.outcome.needed) offered.push("record_outcome");
	if (money?.actions?.recordKinds.length > 0) offered.push("record_payment");
	if (money?.actions?.refundMax != null) offered.push("record_refund");
	return offered;
}

/** Offered by the old page, deliberately not by the new one: the plan names it (row 15 before 16). */
const DROPPED_ON_PURPOSE = ["finish"];

/**
 * What an artist's Payments card is: the balance and the ledger, read-only (docs/requirements.md:87,
 * TAT-30). No screenshot to check, no image, no Reverse, no form, no outcome.
 */
function readOnly(card: Props, label: string) {
	if (!card)
		throw new Error(`${label}: an artist gets the payments card, read-only`);
	if (card.pending.length !== 0)
		throw new Error(`${label}: no screenshot to check`);
	if (card.actions !== null)
		throw new Error(`${label}: no payment or refund form`);
	if (card.outcome.needed !== null)
		throw new Error(`${label}: no outcome form`);
	for (const row of card.rows) {
		if (row.proofUrl !== null) throw new Error(`${label}: no screenshot link`);
		if (row.canReverse) throw new Error(`${label}: no Reverse`);
	}
}

type Studio = Awaited<ReturnType<typeof studio>>;
async function studio() {
	const { owner, tenant } = await studioWithOwner();
	const asha = await artistIn(tenant, "asha@example.com");
	const profile = await inTenant(tenant, async () => {
		const profile = await makeArtist(tenant, "asha");
		profile.userId = asha.id;
		await profile.save();
		return profile;
	});
	// A start that no other session of the studio's artist overlaps: each call is three hours later.
	let slot = 0;
	const at = (days: number) =>
		DateTime.now()
			.plus({ days })
			.startOf("hour")
			.plus({ hours: 3 * slot++ });
	return { owner, asha, tenant, profile, at };
}

type Row = {
	name: string;
	status: ProjectStatus;
	phone?: boolean;
	seed?: (
		s: Studio,
		project: Awaited<ReturnType<typeof makeProject>>,
	) => Promise<void>;
	/** Where the new page must draw these (the rest only has to be somewhere). */
	place?: Record<string, Place>;
};

const verified = (
	s: Studio,
	amount: number,
	kind: "deposit" | "balance" = "deposit",
) => ({
	kind,
	amount,
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
	verifiedByUserId: s.owner.id,
});
const quote = (s: Studio, p: { id: string }, over = {}) =>
	makeQuote(s.tenant, p as never, over);

const ROWS: Row[] = [
	{
		name: "reviewing",
		status: "reviewing",
		place: {
			issue_quote: "step",
			decline: "card",
			withdraw: "card",
			assign_artist: "card",
		},
	},
	{
		name: "quoted, a fresh price",
		status: "quoted",
		seed: async (s, p) => void (await quote(s, p)),
		place: {
			client_accepted: "step",
			send_quote: "step",
			revise_quote: "step",
			hold: "card",
			withdraw: "card",
		},
	},
	{
		name: "quoted, a fresh price, no phone",
		status: "quoted",
		phone: false,
		seed: async (s, p) => void (await quote(s, p)),
		place: { client_accepted: "step", send_quote: null, revise_quote: "step" },
	},
	{
		name: "quoted, ending in two days",
		status: "quoted",
		seed: async (s, p) =>
			void (await quote(s, p, { expiresAt: expiresAtFor(dayFromNow(2), KTM) })),
		place: { send_quote: "step", client_accepted: "step" },
	},
	{
		name: "quoted, a screenshot waiting",
		status: "quoted",
		seed: async (s, p) => {
			await quote(s, p);
			await proofFor(s.tenant, p as never);
		},
		place: {
			verify_proof: "step",
			client_accepted: "card",
			send_quote: "card",
			revise_quote: "card",
		},
	},
	{
		name: "on hold, a live quote",
		status: "on_hold",
		seed: async (s, p) => void (await quote(s, p)),
		place: {
			resume: "step",
			send_quote: "card",
			revise_quote: "step",
			withdraw: "card",
		},
	},
	{
		name: "on hold, the quote ends soon",
		status: "on_hold",
		seed: async (s, p) =>
			void (await quote(s, p, { expiresAt: expiresAtFor(dayFromNow(2), KTM) })),
		place: { resume: "step", send_quote: "card" },
	},
	{
		name: "deposit pending, a link made yesterday",
		status: "deposit_pending",
		seed: async (s, p) => {
			await quote(s, p);
			await makeDepositLink(s.tenant, p as never, {
				updatedAt: DateTime.utc().minus({ days: 1 }),
			});
		},
		place: { deposit_link: "step", record_payment: "step" },
	},
	{
		name: "deposit pending, no link",
		status: "deposit_pending",
		seed: async (s, p) => void (await quote(s, p)),
		place: { deposit_link: "step" },
	},
	{
		name: "deposit pending, a screenshot waiting",
		status: "deposit_pending",
		seed: async (s, p) => {
			await quote(s, p);
			await makeDepositLink(s.tenant, p as never);
			await proofFor(s.tenant, p as never);
		},
		place: {
			verify_proof: "step",
			deposit_link: "card",
			record_payment: "card",
			revise_quote: "card",
		},
	},
	{
		name: "deposit pending, the price ended",
		status: "deposit_pending",
		seed: async (s, p) => {
			await quote(s, p, { expiresAt: DateTime.utc().minus({ hours: 1 }) });
			await makeDepositLink(s.tenant, p as never);
		},
		place: { revise_quote: "step", deposit_link: "card" },
	},
	{
		name: "booked, no tattoo session",
		status: "booked",
		seed: async (s, p) => {
			await quote(s, p);
			await makePayment(s.tenant, p as never, verified(s, 300_000));
		},
		place: { schedule: "step" },
	},
	{
		name: "booked without a price",
		status: "booked",
		place: { set_price: "card", schedule: "step" },
	},
	{
		name: "booked, a session tomorrow",
		status: "booked",
		seed: async (s, p) => {
			await quote(s, p);
			await makePayment(s.tenant, p as never, verified(s, 300_000));
			const at = s.at(1);
			await makeSession(s.tenant, p as never, s.profile, {
				startsAt: at,
				endsAt: at.plus({ hours: 2 }),
			});
		},
		place: { schedule: "card", record_payment: "card", record_refund: "card" },
	},
	{
		name: "in progress, nothing scheduled",
		status: "in_progress",
		seed: async (s, p) => {
			await quote(s, p);
			await makePayment(s.tenant, p as never, verified(s, 300_000));
		},
		place: { finish: "step", schedule: "step" },
	},
	{
		name: "in progress, a session tomorrow",
		status: "in_progress",
		seed: async (s, p) => {
			await quote(s, p);
			const at = s.at(1);
			await makeSession(s.tenant, p as never, s.profile, {
				startsAt: at,
				endsAt: at.plus({ hours: 2 }),
			});
		},
		place: { finish: null, schedule: "card" },
	},
	{
		name: "in progress, a session under way",
		status: "in_progress",
		seed: async (s, p) => {
			await quote(s, p);
			const at = DateTime.now().minus({ hours: 1 }).startOf("minute");
			await makeSession(s.tenant, p as never, s.profile, {
				startsAt: at,
				endsAt: at.plus({ hours: 2 }),
			});
		},
		place: { finish: null },
	},
	{
		name: "healing check, a balance owed",
		status: "healing_check",
		seed: async (s, p) => {
			await quote(s, p);
			await makePayment(s.tenant, p as never, verified(s, 300_000));
		},
		place: { finish: "step", record_payment: "step", schedule: "step" },
	},
	{
		name: "healing check, a touch-up scheduled",
		status: "healing_check",
		seed: async (s, p) => {
			await quote(s, p);
			const at = s.at(5);
			await makeSession(s.tenant, p as never, s.profile, {
				kind: "touch_up",
				startsAt: at,
				endsAt: at.plus({ hours: 1 }),
			});
		},
		place: { finish: "step" },
	},
	{
		name: "completed, a balance owed",
		status: "completed",
		seed: async (s, p) => {
			await quote(s, p);
			await makePayment(s.tenant, p as never, verified(s, 300_000));
		},
		place: { record_payment: "step", record_refund: "card" },
	},
	{
		name: "completed and paid",
		status: "completed",
		seed: async (s, p) => {
			await quote(s, p);
			await makePayment(
				s.tenant,
				p as never,
				verified(s, 1_500_000, "balance"),
			);
		},
		place: { record_payment: "card", record_refund: "card" },
	},
	{
		name: "completed without a price",
		status: "completed",
		place: { set_price: "card" },
	},
	{
		name: "declined",
		status: "declined",
		place: {
			mark_contacted: null,
			hold: null,
			resume: null,
			decline: null,
			withdraw: null,
			assign_artist: null,
			schedule: null,
			revise_quote: null,
		},
	},
	{
		name: "declined, holding a deposit",
		status: "declined",
		seed: async (s, p) => {
			await quote(s, p);
			await makePayment(s.tenant, p as never, verified(s, 300_000));
		},
		place: { record_outcome: "step", mark_contacted: null },
	},
	{
		name: "cancelled, holding a deposit",
		status: "cancelled",
		seed: async (s, p) => {
			await quote(s, p);
			await makePayment(s.tenant, p as never, verified(s, 300_000));
		},
		place: {
			record_outcome: "step",
			record_payment: "card",
			mark_contacted: null,
		},
	},
	{
		name: "cancelled, a screenshot nobody decided",
		status: "cancelled",
		seed: async (s, p) => {
			await quote(s, p);
			await proofFor(s.tenant, p as never);
		},
		place: { verify_proof: "step", record_payment: "card" },
	},
];

test.group(
	"Project page: nothing the old page offered is gone (TAT-108)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		const read = async (
			client: ApiClient,
			user: User,
			id: string,
		): Promise<Props> => {
			const response = await client
				.get(`/t/black-needle/projects/${id}`)
				.withInertia()
				.loginAs(user);
			response.assertStatus(200);
			return response.inertiaProps;
		};

		async function build(s: Studio, row: Row) {
			return inTenant(s.tenant, async () => {
				const customer = await makeClient(
					s.tenant,
					row.phone === false
						? { phone: null, anonymizedAt: DateTime.utc() }
						: {},
				);
				const project = await makeProject(s.tenant, customer, {
					status: row.status,
					artistId: s.profile.id,
				});
				await row.seed?.(s, project);
				return project;
			});
		}

		for (const row of ROWS) {
			test(`owner, ${row.name}: every old control is on the new page`, async ({
				client,
				assert,
			}) => {
				const s = await studio();
				const project = await build(s, row);
				const props = await read(client, s.owner, project.id);
				const place = placementsOf(props);

				for (const name of oldPageOffered(props)) {
					if (place[name] === null) {
						assert.include(
							DROPPED_ON_PURPOSE,
							name,
							`${row.name}: ${name} is offered by the old page and by no card of the new one`,
						);
					}
				}
				for (const [name, where] of Object.entries(row.place ?? {})) {
					assert.equal(place[name], where, `${row.name}: ${name}`);
				}
				// Each link target the page can carry is on it once.
				const ids = idsOnPage(props);
				assert.deepEqual(ids, [...new Set(ids)]);
			});
		}

		test("the matrix names every control the page can offer", ({ assert }) => {
			const seen = new Set<string>();
			for (const row of ROWS) {
				for (const name of Object.keys(row.place ?? {})) seen.add(name);
			}
			assert.deepEqual(
				AFFORDANCES.filter((name) => !seen.has(name)),
				[],
			);
		});

		test("the one thing dropped on purpose is the finish panel while a session comes first", async ({
			client,
			assert,
		}) => {
			const s = await studio();
			const rows = ROWS.filter(({ name }) =>
				name.startsWith("in progress, a session"),
			);
			for (const row of rows) {
				const project = await build(s, row);
				const props = await read(client, s.owner, project.id);
				assert.isNotNull(
					props.finish,
					`${row.name}: the server still offers the step`,
				);
				assert.isNull(placementsOf(props).finish, row.name);
				assert.include(
					["next_session", "record_session"],
					props.nextStep.kind,
					row.name,
				);
			}
		});

		test("the assigned artist keeps every non-money control the old page gave them", async ({
			client,
			assert,
		}) => {
			const s = await studio();
			for (const row of ROWS) {
				const project = await build(s, row);
				const props = await read(client, s.asha, project.id);
				const place = placementsOf(props);
				readOnly(props.payments, row.name);
				for (const name of oldPageOffered(props)) {
					if (place[name] === null) {
						assert.include(DROPPED_ON_PURPOSE, name, `${row.name}: ${name}`);
					}
				}
				for (const money of [
					"verify_proof",
					"record_outcome",
					"record_payment",
					"record_refund",
					"deposit_link",
				]) {
					assert.isNull(place[money], `${row.name}: ${money}`);
				}
			}
		});

		// The closed-project policy (docs/ui.md, "Closed projects"): no change to the project itself from
		// the page, money settlement stays. Exactly these controls, per status and condition.
		const CLOSED_POLICY: [string, Record<string, Place>][] = [
			[
				"completed, a balance owed",
				{ record_payment: "step", record_refund: "card" },
			],
			["completed and paid", { record_payment: "card", record_refund: "card" }],
			[
				"completed without a price",
				{ set_price: "card", record_payment: "card" },
			],
			["declined", {}],
			["declined, holding a deposit", { record_outcome: "step" }],
			[
				"cancelled, holding a deposit",
				{ record_outcome: "step", record_payment: "card" },
			],
			[
				"cancelled, a screenshot nobody decided",
				{ verify_proof: "step", record_payment: "card" },
			],
		];

		for (const [name, expected] of CLOSED_POLICY) {
			test(`closed (${name}): the owner is offered exactly this, and no change to the project`, async ({
				client,
				assert,
			}) => {
				const s = await studio();
				const row = ROWS.find((candidate) => candidate.name === name);
				if (!row) throw new Error(`no row ${name}`);
				const project = await build(s, row);
				const props = await read(client, s.owner, project.id);

				assert.isTrue(props.closed);
				// Nothing that changes the project: no status move, no artist picker, no quote, no
				// message to send, no scheduling, no finish step.
				assert.deepEqual(props.moves, []);
				assert.isNull(props.assignment);
				assert.isFalse(props.canQuote);
				assert.isFalse(props.canAccept);
				assert.isNull(props.message);
				assert.isNull(props.scheduling);
				assert.isNull(props.finish);
				assert.isNull(props.deposit);
				const offered = Object.fromEntries(
					Object.entries(placementsOf(props)).filter(
						([, where]) => where !== null,
					),
				);
				assert.deepEqual(offered, expected);
			});
		}

		test("a closed project has a read-only artist: the card to read, no money control, no change", async ({
			client,
			assert,
		}) => {
			const s = await studio();
			for (const [name] of CLOSED_POLICY) {
				const row = ROWS.find((candidate) => candidate.name === name);
				if (!row) throw new Error(`no row ${name}`);
				const project = await build(s, row);
				const props = await read(client, s.asha, project.id);
				const offered = Object.entries(placementsOf(props)).filter(
					([, where]) => where !== null,
				);
				readOnly(props.payments, name);
				// Set price is the one control an artist keeps on a completed project booked without one.
				assert.deepEqual(
					offered.map(([affordance]) => affordance),
					name === "completed without a price" ? ["set_price"] : [],
					name,
				);
			}
		});
	},
);
