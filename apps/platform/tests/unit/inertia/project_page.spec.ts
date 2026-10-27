import { test } from "@japa/runner";
import { PROJECT_STATUSES } from "#modules/projects/models/tattoo_project";
import { NEXT_STEP_ACTIONS } from "#modules/projects/next_step";
import { WAITING_HASH } from "#modules/projects/waiting";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `PageModule` below restates its shape and the inertia project type-checks the real one.
import * as pageModule from "../../../inertia/components/project_page.js";

type Step = { primary: string | null; secondary: string[] };
type PageModule = {
	PROGRESS_STEPS: readonly string[];
	CARD_IDS: readonly string[];
	progressOf(
		status: string,
	): { label: string; state: "done" | "current" | "todo" }[] | null;
	cardId(id: string, anchor: string | null): string | undefined;
	offers(step: Step, action: string): boolean;
	layoutOf(step: Step): {
		primary: string | null;
		blocks: string[];
		buttons: string[];
	};
	AFFORDANCES: readonly string[];
	placementsOf(page: Facts): Record<string, "step" | "card" | null>;
	idsOnPage(page: Facts): string[];
};
const {
	PROGRESS_STEPS,
	CARD_IDS,
	progressOf,
	cardId,
	offers,
	layoutOf,
	AFFORDANCES,
	placementsOf,
	idsOnPage,
} = pageModule as PageModule;

/** What the page knows about a project (the props the cards read). */
type Facts = {
	nextStep: Step & { anchor: string | null };
	closed: boolean;
	canQuote: boolean;
	canAccept: boolean;
	canSetPrice: boolean;
	quote: unknown;
	message: unknown;
	deposit: unknown;
	scheduling: unknown;
	finish: unknown;
	moves: string[];
	assignment: unknown;
	payments: {
		pending: unknown[];
		actions: { recordKinds: unknown[]; refundMax: number | null } | null;
		outcome: { needed: unknown };
	} | null;
};

/** A quiet owner's page: nothing available, no step. */
const facts = (over: Partial<Facts> = {}): Facts => ({
	nextStep: { primary: null, secondary: [], anchor: null },
	closed: false,
	canQuote: false,
	canAccept: false,
	canSetPrice: false,
	quote: null,
	message: null,
	deposit: null,
	scheduling: null,
	finish: null,
	moves: [],
	assignment: null,
	payments: {
		pending: [],
		actions: { recordKinds: [], refundMax: null },
		outcome: { needed: null },
	},
	...over,
});

const states = (status: string) =>
	progressOf(status)?.map(({ state }) => state) ?? null;

test.group("progressOf (TAT-108)", () => {
	test("names the five steps of a tattoo", ({ assert }) => {
		assert.deepEqual(
			[...PROGRESS_STEPS],
			["Review", "Quote", "Deposit", "Sessions", "Done"],
		);
	});

	test("every status but declined and cancelled has a line of five", ({
		assert,
	}) => {
		for (const status of PROJECT_STATUSES) {
			const line = progressOf(status);
			if (status === "declined" || status === "cancelled") {
				assert.isNull(line, status);
				continue;
			}
			assert.lengthOf(line ?? [], 5, status);
			assert.deepEqual(
				line?.map(({ label }) => label),
				[...PROGRESS_STEPS],
				status,
			);
		}
	});

	test("each status stands on one step, with the earlier ones done", ({
		assert,
	}) => {
		const at = {
			reviewing: 0,
			quoted: 1,
			on_hold: 1,
			deposit_pending: 2,
			booked: 3,
			in_progress: 3,
			healing_check: 4,
		} as const;
		for (const [status, index] of Object.entries(at)) {
			const line = states(status) ?? [];
			assert.deepEqual(
				line,
				PROGRESS_STEPS.map((_, step) =>
					step < index ? "done" : step === index ? "current" : "todo",
				),
				status,
			);
		}
	});

	test("a completed project has every step done and none current", ({
		assert,
	}) => {
		assert.deepEqual(states("completed"), Array(5).fill("done"));
	});

	test("an unknown status draws no line, and inherited names are not statuses", ({
		assert,
	}) => {
		for (const status of ["", "new", "toString", "__proto__", "constructor"]) {
			assert.isNull(progressOf(status), status);
		}
	});
});

test.group("cardId (TAT-108)", () => {
	test("is the element's own id, unless the Next step card carries it", ({
		assert,
	}) => {
		for (const id of CARD_IDS) {
			assert.equal(cardId(id, null), id);
			assert.equal(cardId(id, "payments" === id ? "quote" : "payments"), id);
			assert.isUndefined(cardId(id, id));
		}
	});

	test("for any anchor, at most one of the five ids is dropped, so each id appears once", ({
		assert,
	}) => {
		assert.sameMembers(
			[...CARD_IDS],
			["payments", "quote", "quote-form", "deposit", "sessions"],
		);
		for (const anchor of [...CARD_IDS, null, "other"]) {
			const kept = CARD_IDS.filter((id) => cardId(id, anchor) !== undefined);
			assert.isAtLeast(kept.length, CARD_IDS.length - 1, `${anchor}`);
		}
	});

	test("every card the server's rules name is an id this page carries", ({
		assert,
	}) => {
		// WAITING_HASH is where Today's rows and the list's lines point; the Next step
		// adds "payments" for the outcome form and the balance still owed.
		const named = [...Object.values(WAITING_HASH), "payments"].filter(
			(hash): hash is string => hash !== null,
		);
		assert.isAbove(named.length, 0);
		for (const hash of named) assert.include(CARD_IDS, hash);
	});
});

test.group("offers and layoutOf (TAT-108)", () => {
	const step: Step = {
		primary: "send_quote",
		secondary: ["client_accepted", "verify_proof", "revise_quote", "resume"],
	};

	test("offers is true for the primary and every secondary action", ({
		assert,
	}) => {
		assert.isTrue(offers(step, "send_quote"));
		assert.isTrue(offers(step, "resume"));
		assert.isFalse(offers(step, "schedule"));
		assert.isFalse(offers({ primary: null, secondary: [] }, "schedule"));
	});

	test("layoutOf puts blocks apart from buttons, each in the server's order", ({
		assert,
	}) => {
		assert.deepEqual(layoutOf(step), {
			primary: "send_quote",
			blocks: ["verify_proof"],
			buttons: ["client_accepted", "revise_quote", "resume"],
		});
	});

	test("the blocks are the actions that draw a form or a panel of their own", ({
		assert,
	}) => {
		const every = layoutOf({
			primary: null,
			secondary: [...NEXT_STEP_ACTIONS],
		});
		assert.sameMembers(every.blocks, [
			"verify_proof",
			"issue_quote",
			"send_quote",
			"deposit_link",
			"finish",
			"record_outcome",
		]);
		assert.sameMembers(
			[...every.blocks, ...every.buttons],
			[...NEXT_STEP_ACTIONS],
		);
	});
});

test.group(
	"placementsOf: everything the page offers is drawn somewhere (TAT-108)",
	() => {
		const quote = { id: "q1" };
		const phone = { text: "Hi" };

		test("an action the Next step names is drawn there, any other the card that owns it", ({
			assert,
		}) => {
			const page = facts({
				nextStep: {
					primary: "client_accepted",
					secondary: ["send_quote"],
					anchor: "quote",
				},
				canQuote: true,
				canAccept: true,
				quote,
				message: phone,
			});
			const place = placementsOf(page);
			assert.equal(place.client_accepted, "step");
			assert.equal(place.send_quote, "step");
			// Not named by the step, still offered by the page: the Quote card has it.
			assert.equal(place.revise_quote, "card");
		});

		test("a held project's quote message is drawn by the Quote card (the step offers only Resume)", ({
			assert,
		}) => {
			const place = placementsOf(
				facts({
					nextStep: {
						primary: "resume",
						secondary: ["revise_quote"],
						anchor: "quote",
					},
					canQuote: true,
					quote,
					message: phone,
					moves: ["resume", "withdraw"],
				}),
			);
			assert.equal(place.send_quote, "card");
			assert.equal(place.resume, "step");
			assert.equal(place.withdraw, "card");
			assert.isNull(place.client_accepted, "nothing to accept while held");
		});

		test("a screenshot to check does not hide Accept, the quote message or the deposit panel", ({
			assert,
		}) => {
			const page = facts({
				nextStep: {
					primary: "verify_proof",
					secondary: [],
					anchor: "payments",
				},
				canQuote: true,
				canAccept: true,
				quote,
				message: phone,
				deposit: { link: null },
				payments: {
					pending: [{}],
					actions: { recordKinds: ["deposit"], refundMax: null },
					outcome: { needed: null },
				},
			});
			const place = placementsOf(page);
			assert.equal(place.verify_proof, "step");
			assert.equal(place.client_accepted, "card");
			assert.equal(place.send_quote, "card");
			assert.equal(place.deposit_link, "card");
			assert.equal(place.record_payment, "card");
		});

		test("the first quote has a card to be drawn in when the step does not offer it", ({
			assert,
		}) => {
			const page = facts({ canQuote: true, quote: null });
			assert.equal(placementsOf(page).issue_quote, "card");
			assert.equal(
				placementsOf({
					...page,
					nextStep: {
						primary: "issue_quote",
						secondary: [],
						anchor: "quote-form",
					},
				}).issue_quote,
				"step",
			);
		});

		test("what is not available is placed nowhere", ({ assert }) => {
			const place = placementsOf(facts({ closed: true }));
			for (const action of AFFORDANCES) assert.isNull(place[action], action);
		});

		test("Mark contacted, the artist, set price and a refund are cards of their own", ({
			assert,
		}) => {
			const place = placementsOf(
				facts({
					assignment: { artistId: null },
					canSetPrice: true,
					payments: {
						pending: [],
						actions: { recordKinds: [], refundMax: 500 },
						outcome: { needed: null },
					},
				}),
			);
			assert.equal(place.mark_contacted, "card");
			assert.equal(place.assign_artist, "card");
			assert.equal(place.set_price, "card");
			assert.equal(place.record_refund, "card");
			assert.isNull(placementsOf(facts({ closed: true })).mark_contacted);
		});

		test("the finish panel is only ever the step's: with a session first it is dropped on purpose", ({
			assert,
		}) => {
			const finish = { step: "finish" };
			assert.equal(
				placementsOf(
					facts({
						finish,
						nextStep: { primary: "finish", secondary: [], anchor: null },
					}),
				).finish,
				"step",
			);
			assert.isNull(placementsOf(facts({ finish })).finish);
		});

		test("a page without a payments card places no money control", ({
			assert,
		}) => {
			const place = placementsOf(
				facts({ payments: null, canQuote: true, quote }),
			);
			for (const action of [
				"verify_proof",
				"record_outcome",
				"record_payment",
				"record_refund",
				"deposit_link",
			]) {
				assert.isNull(place[action], action);
			}
			assert.equal(place.revise_quote, "card");
		});
	},
);

test.group("idsOnPage: each link target exists once (TAT-108)", () => {
	const quote = { id: "q1" };

	test("the step carries its anchor and the card that owns it gives it up", ({
		assert,
	}) => {
		for (const anchor of [
			"payments",
			"quote",
			"quote-form",
			"deposit",
			"sessions",
		]) {
			const ids = idsOnPage(
				facts({
					nextStep: { primary: null, secondary: [], anchor },
					canQuote: true,
					quote,
					deposit: { link: null },
				}),
			);
			assert.equal(ids.filter((id) => id === anchor).length, 1, anchor);
			assert.deepEqual(ids, [...new Set(ids)], `${anchor}: no id twice`);
		}
	});

	test("Revise and the deposit panel carry their ids wherever they are drawn", ({
		assert,
	}) => {
		const base = {
			canQuote: true,
			quote,
			deposit: { link: null },
		};
		// In the step (anchor elsewhere): both ids exist.
		const inStep = idsOnPage(
			facts({
				...base,
				nextStep: {
					primary: "deposit_link",
					secondary: ["revise_quote"],
					anchor: "quote",
				},
			}),
		);
		assert.includeMembers(inStep, [
			"quote-form",
			"deposit",
			"sessions",
			"payments",
		]);
		// In their own cards (the step offers neither).
		const inCards = idsOnPage(facts(base));
		assert.includeMembers(inCards, ["quote", "quote-form", "deposit"]);
		// No deposit panel, no id.
		assert.notInclude(idsOnPage(facts({ canQuote: true, quote })), "deposit");
	});

	test("a payload without a Payments card has no #payments", ({ assert }) => {
		assert.notInclude(idsOnPage(facts({ payments: null })), "payments");
		assert.include(idsOnPage(facts()), "payments");
	});
});
