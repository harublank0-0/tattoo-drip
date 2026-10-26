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
};
const { PROGRESS_STEPS, CARD_IDS, progressOf, cardId, offers, layoutOf } =
	pageModule as PageModule;

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
