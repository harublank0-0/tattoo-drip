import assert from "node:assert/strict";
import { test } from "node:test";
import { TattooApiError } from "@tattoo-drip/sdk";
import { copy } from "../../src/review/copy.ts";
import { loadProblemOf, writeOutcome } from "../../src/review/problems.ts";

const error = (
	status: number,
	code: string,
	fields?: Record<string, string[]>,
) =>
	new TattooApiError(status, {
		code,
		message: "",
		...(fields ? { fields } : {}),
	});

test("a 404 at any time is the dead link (unknown, revoked or expired)", () => {
	assert.equal(loadProblemOf(error(404, "not_found")), "dead");
	assert.equal(loadProblemOf(error(429, "rate_limited")), "limited");
	assert.equal(loadProblemOf(error(503, "service_busy")), "failed");
	assert.deepEqual(writeOutcome(error(404, "not_found")), { kind: "gone" });
});

test("the API's field errors land on the form's fields", () => {
	const outcome = writeOutcome(
		error(422, "validation_failed", {
			"review.body": ["Write at least 20 characters."],
			"post.styles": ["Choose up to 3 styles from the list."],
			shownName: ["Write the name to show, up to 40 characters."],
		}),
	);
	assert.equal(outcome.kind, "fields");
	assert.deepEqual(
		outcome.kind === "fields" ? outcome.problems.map((p) => p.field) : [],
		["body", "styles", "shownName"],
	);
	assert.deepEqual(writeOutcome(error(409, "post_needs_photo")), {
		kind: "fields",
		problems: [{ field: "media", message: copy.errors.postNeedsPhoto }],
	});
	assert.deepEqual(writeOutcome(error(409, "review_locked")), {
		kind: "notice",
		message: copy.errors.locked,
	});
	assert.equal(writeOutcome(error(403, "challenge_failed")).kind, "notice");
});
