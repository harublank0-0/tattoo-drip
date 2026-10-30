import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { claimStateOf, isClaimed } from "#modules/flash/claims";

const at = DateTime.fromISO("2026-10-30T09:00:00Z");
const free = { claimedAt: null, claimedProjectId: null };
const byHand = { claimedAt: at, claimedProjectId: null };
const byP = { claimedAt: at, claimedProjectId: "project-p" };

test.group("claimStateOf (TAT-129)", () => {
	test("an unclaimed design is none from everywhere", ({ assert }) => {
		assert.equal(claimStateOf(free, { projectId: null, open: true }), "none");
		assert.equal(claimStateOf(free, { projectId: "q", open: true }), "none");
		assert.equal(claimStateOf(free, { projectId: "q", open: false }), "none");
	});

	test("a design claimed by hand is taken for an open record and none for a closed one", ({
		assert,
	}) => {
		assert.equal(claimStateOf(byHand, { projectId: "q", open: true }), "taken");
		assert.equal(claimStateOf(byHand, { projectId: "q", open: false }), "none");
	});

	test("a design claimed by project P is here for P, taken for another open project, none for a closed one", ({
		assert,
	}) => {
		assert.equal(
			claimStateOf(byP, { projectId: "project-p", open: true }),
			"here",
		);
		// "here" is the claiming project's, whether or not it is still open.
		assert.equal(
			claimStateOf(byP, { projectId: "project-p", open: false }),
			"here",
		);
		assert.equal(claimStateOf(byP, { projectId: "q", open: true }), "taken");
		assert.equal(claimStateOf(byP, { projectId: "q", open: false }), "none");
	});

	test("an inquiry has no project: an open request for a claimed design is taken", ({
		assert,
	}) => {
		assert.equal(claimStateOf(byP, { projectId: null, open: true }), "taken");
		assert.equal(
			claimStateOf(byHand, { projectId: null, open: true }),
			"taken",
		);
		assert.equal(claimStateOf(byP, { projectId: null, open: false }), "none");
	});

	test("isClaimed is about the claim time alone", ({ assert }) => {
		assert.isFalse(isClaimed(free));
		assert.isTrue(isClaimed(byHand));
		assert.isTrue(isClaimed(byP));
	});
});
