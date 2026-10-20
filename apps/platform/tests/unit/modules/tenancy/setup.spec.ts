import { test } from "@japa/runner";
import {
	SETUP_STEPS,
	type SetupFacts,
	setupChecklist,
} from "#modules/tenancy/setup";

const NOTHING: SetupFacts = {
	artists: 0,
	depositMethods: 0,
	depositPolicy: null,
	inquiries: 0,
};

const steps = (facts: Partial<SetupFacts>) =>
	setupChecklist({ ...NOTHING, ...facts }).steps.map(({ key, done, next }) => [
		key,
		done,
		next,
	]);

test.group("The setup checklist (TAT-101)", () => {
	test("a new studio has four steps, none done, and the first is next", ({
		assert,
	}) => {
		const list = setupChecklist(NOTHING);

		assert.deepEqual(
			list.steps.map(({ key }) => key),
			["artists", "payments", "policy", "inquiry"],
		);
		assert.deepEqual(
			list.steps.map(({ key }) => key),
			[...SETUP_STEPS],
		);
		assert.equal(list.total, 4);
		assert.equal(list.doneCount, 0);
		assert.isFalse(list.complete);
		assert.deepEqual(steps({}), [
			["artists", false, true],
			["payments", false, false],
			["policy", false, false],
			["inquiry", false, false],
		]);
	});

	test("adding an artist ticks the first step and moves 'next' to the payment methods", ({
		assert,
	}) => {
		assert.deepEqual(steps({ artists: 1 }), [
			["artists", true, false],
			["payments", false, true],
			["policy", false, false],
			["inquiry", false, false],
		]);
	});

	test("a method shown on the deposit page ticks the second step", ({
		assert,
	}) => {
		assert.deepEqual(steps({ artists: 3, depositMethods: 2 }), [
			["artists", true, false],
			["payments", true, false],
			["policy", false, true],
			["inquiry", false, false],
		]);
	});

	test("a written policy ticks the third; a blank one does not", ({
		assert,
	}) => {
		assert.deepEqual(
			steps({ artists: 1, depositMethods: 1, depositPolicy: "50% deposit." }),
			[
				["artists", true, false],
				["payments", true, false],
				["policy", true, false],
				["inquiry", false, true],
			],
		);
		for (const blank of [null, "", "   ", "\n\t "]) {
			assert.isFalse(
				setupChecklist({ ...NOTHING, depositPolicy: blank }).steps[2].done,
				JSON.stringify(blank),
			);
		}
	});

	test("'next' is the first step still open, wherever the done ones are", ({
		assert,
	}) => {
		// An inquiry arrived before anything else was set up.
		assert.deepEqual(steps({ inquiries: 2 }), [
			["artists", false, true],
			["payments", false, false],
			["policy", false, false],
			["inquiry", true, false],
		]);
	});

	test("with all four done the list is complete and nothing is next", ({
		assert,
	}) => {
		const list = setupChecklist({
			artists: 1,
			depositMethods: 1,
			depositPolicy: "Deposits are not refundable.",
			inquiries: 1,
		});

		assert.isTrue(list.complete);
		assert.equal(list.doneCount, 4);
		assert.isTrue(list.steps.every(({ done, next }) => done && !next));
	});
});
