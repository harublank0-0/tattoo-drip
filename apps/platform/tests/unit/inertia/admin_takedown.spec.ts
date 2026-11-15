import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `TakedownModule` below restates its shape and the inertia project type-checks the real one.
import * as takedownModule from "../../../inertia/components/admin_takedown.js";

type TakedownModule = {
	CHOOSE_REASON: string;
	initialReason(
		reasons: { value: string; label: string }[],
		defaultReason?: string,
	): string;
};
const { CHOOSE_REASON, initialReason } = takedownModule as TakedownModule;

const REASONS = [
	{ value: "hate", label: "Hate" },
	{ value: "off_topic", label: "Off-topic" },
	{ value: "other", label: "Other" },
];

test.group("Admin takedown form: the reason it starts on", () => {
	test("an unreported item starts on no reason, never the first one", ({
		assert,
	}) => {
		assert.equal(initialReason(REASONS), CHOOSE_REASON);
		assert.equal(CHOOSE_REASON, "");
	});

	test("a reported review starts on its report's reason", ({ assert }) => {
		assert.equal(initialReason(REASONS, "off_topic"), "off_topic");
	});

	test("a reason the list doesn't offer starts on no reason", ({ assert }) => {
		assert.equal(initialReason(REASONS, "rude"), CHOOSE_REASON);
	});

	test("the select is required and offers a disabled Choose a reason option", async ({
		assert,
	}) => {
		const source = await readFile(
			new URL(
				"../../../inertia/components/admin_moderation.tsx",
				import.meta.url,
			),
			"utf8",
		);
		const select = source.slice(
			source.indexOf("<select"),
			source.indexOf("</select>"),
		);
		assert.include(select, "required");
		assert.include(
			select,
			"defaultValue={initialReason(reasons, defaultReason)}",
		);
		assert.match(
			select,
			/<option value=\{CHOOSE_REASON\} disabled>\s*Choose a reason\s*<\/option>/,
		);
	});
});
