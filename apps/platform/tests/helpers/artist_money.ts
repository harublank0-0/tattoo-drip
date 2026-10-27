import { DateTime } from "luxon";
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

/**
 * A studio whose assigned artist's project pages carry money (TAT-108 fix round 2): the fixture is
 * the same on every branch, so the artist's pages can be compared with what main (9ac7621) sent them
 * for it. Amounts no other figure of the page equals, in paisa: 123,456 and 77,730 paid on a booked
 * project; 91,150 of a NPR 3,000 deposit; 55,500 in a screenshot nobody checked; 66,600 held by a
 * cancelled project; 250,000 of a completed project's price; an hourly quote.
 */
export async function artistMoneyFixture() {
	const { owner, tenant } = await studioWithOwner();
	const asha = await artistIn(tenant, "asha@example.com");
	const projects = await inTenant(tenant, async () => {
		const profile = await makeArtist(tenant, "asha");
		profile.userId = asha.id;
		await profile.save();
		const decided = (
			amount: number,
			kind: "deposit" | "session" | "balance" | "refund" = "deposit",
		) => ({
			kind,
			amount,
			status: "verified" as const,
			verifiedAt: DateTime.utc(),
			verifiedByUserId: owner.id,
		});
		const make = async (
			status:
				| "booked"
				| "deposit_pending"
				| "cancelled"
				| "completed"
				| "in_progress",
		) => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status,
				artistId: profile.id,
			});
			await makeQuote(tenant, project);
			return project;
		};

		const booked = await make("booked");
		await makePayment(tenant, booked, decided(123_456, "session"));
		await makePayment(tenant, booked, decided(77_730, "balance"));
		// A session later this week: the schedule hint and the Sessions card.
		const at = DateTime.now().plus({ days: 3 }).startOf("hour");
		await makeSession(tenant, booked, profile, {
			startsAt: at,
			endsAt: at.plus({ hours: 2 }),
		});

		const waiting = await make("deposit_pending");
		await makePayment(tenant, waiting, decided(91_150));
		await makeDepositLink(tenant, waiting);
		await proofFor(tenant, waiting, { amount: 55_500 });

		const cancelled = await make("cancelled");
		await makePayment(tenant, cancelled, decided(66_600));

		const completed = await make("completed");
		await makePayment(tenant, completed, decided(250_000, "balance"));

		const hourly = await makeProject(tenant, await makeClient(tenant), {
			status: "in_progress",
			artistId: profile.id,
		});
		await makeQuote(tenant, hourly, {
			kind: "hourly",
			fixedPrice: null,
			hourlyRate: 300_000,
			estimatedMinutes: 270,
		});
		await makePayment(tenant, hourly, decided(300_000));
		await makePayment(tenant, hourly, decided(-12_300, "refund"));

		return { booked, waiting, cancelled, completed, hourly };
	});
	return { owner, asha, tenant, projects };
}

/**
 * Every money figure a serialized page carries, as numbers: each "NPR 1,234.56" in a string (and the
 * figure, 1234.56) and every number leaf. Paisa and rupees both appear, so a figure is the same
 * either way it is written.
 */
export function figuresOf(value: unknown): number[] {
	const found = new Set<number>();
	const walk = (inner: unknown) => {
		if (typeof inner === "string") {
			for (const match of inner.matchAll(/NPR\s?(−?[\d,]+(?:\.\d+)?)/g)) {
				found.add(
					Number((match[1] as string).replace(/,/g, "").replace("−", "-")),
				);
			}
		} else if (typeof inner === "number") {
			found.add(inner);
		} else if (inner && typeof inner === "object") {
			for (const each of Object.values(inner)) walk(each);
		}
	};
	walk(value);
	return [...found].sort((a, b) => a - b);
}

/** The figures `page` carries that `allowed` does not. */
export const newFigures = (page: unknown, allowed: readonly number[]) =>
	figuresOf(page).filter((figure) => !allowed.includes(figure));
