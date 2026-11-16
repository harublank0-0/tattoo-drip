import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `Words` below restates its shape and the inertia project type-checks the real one.
import * as wordsModule from "../../../../inertia/components/design_lab.js";

type Status = "queued" | "processing" | "completed" | "failed" | "moderated";
type Allowance = {
	limit: number;
	used: number;
	reserved: number;
	remaining: number;
	resetsAt: string;
};
type Row = { id: string; status: Status; attempt: number };
type Words = {
	allowanceText(allowance: Allowance): string;
	allowanceWarning(allowance: Allowance): string | null;
	usageText(variations: number, allowance: Allowance): string;
	variationChoices(max: number, remaining: number): number[];
	statusesChanged(shown: Row[], polled: Row[]): boolean;
};
const {
	allowanceText,
	allowanceWarning,
	statusesChanged,
	usageText,
	variationChoices,
} = wordsModule as Words;

const allowance = {
	limit: 40,
	used: 10,
	reserved: 2,
	remaining: 28,
	resetsAt: "2026-12-01T00:00:00.000Z",
};

test.group("Design Lab page words", () => {
	test("a warning with the exact count shows only with 1 to 5 left (ruling 12)", ({
		assert,
	}) => {
		const left = (remaining: number, limit = 40) =>
			allowanceWarning({ ...allowance, limit, remaining });
		assert.isNull(left(6));
		assert.equal(
			left(5),
			"Only 5 generations left this month. Resets on 1 Dec.",
		);
		assert.equal(
			left(1),
			"Only 1 generation left this month. Resets on 1 Dec.",
		);
		// At 0 the form's own "no generations left" says it.
		assert.isNull(left(0));
		assert.isNull(left(0, 0));
	});

	test("usage is said before a submit", ({ assert }) => {
		assert.equal(
			allowanceText(allowance),
			"28 of 40 generations left this month",
		);
		assert.include(
			usageText(2, allowance),
			"Uses 2 generations of your 28 remaining",
		);
		assert.include(usageText(3, { ...allowance, remaining: 2 }), "Only 2 left");
		assert.include(
			usageText(1, { ...allowance, remaining: 0 }),
			"no generations left",
		);
		assert.deepEqual(variationChoices(4, 2), [1, 2]);
		assert.deepEqual(variationChoices(2, 0), [1]);
	});

	test("a poll answer is a change only when a status or attempt moved", ({
		assert,
	}) => {
		const shown: Row[] = [{ id: "a", status: "queued", attempt: 1 }];
		assert.isFalse(
			statusesChanged(shown, [{ id: "a", status: "queued", attempt: 1 }]),
		);
		assert.isTrue(
			statusesChanged(shown, [{ id: "a", status: "completed", attempt: 1 }]),
		);
		assert.isTrue(
			statusesChanged(shown, [{ id: "a", status: "queued", attempt: 2 }]),
		);
		assert.isTrue(statusesChanged(shown, []));
	});
});
