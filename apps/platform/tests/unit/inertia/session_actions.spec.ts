import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `SessionsModule` below restates its shape and the inertia project type-checks the real one.
import * as sessionsModule from "../../../inertia/components/sessions.js";

type Outcome = "completed" | "no_show" | "cancelled";
type SessionsModule = {
	sessionActions(outcomes: Outcome[], canMove: boolean): string[];
	outcomeQuestion(outcome: Outcome, whenText: string): string;
};
const { sessionActions, outcomeQuestion } = sessionsModule as SessionsModule;

const WHEN = "Mon 2 Nov 2026, 15:45–17:45";

test.group("sessionActions", () => {
	test("Done and No-show first, then Move, then Cancel session", ({
		assert,
	}) => {
		assert.deepEqual(
			sessionActions(["completed", "no_show", "cancelled"], true),
			["completed", "no_show", "move", "cancelled"],
		);
		assert.deepEqual(sessionActions(["no_show", "cancelled"], true), [
			"no_show",
			"move",
			"cancelled",
		]);
		assert.deepEqual(sessionActions(["cancelled"], true), [
			"move",
			"cancelled",
		]);
		assert.deepEqual(sessionActions([], false), []);
	});
});

test.group("outcomeQuestion", () => {
	test("names the session, says what changes and that it's final", ({
		assert,
	}) => {
		assert.equal(
			outcomeQuestion("completed", WHEN),
			`Mark the session on ${WHEN} as done? An outcome can't be changed afterwards.`,
		);
		assert.equal(
			outcomeQuestion("no_show", WHEN),
			`Mark the session on ${WHEN} as a no-show? Its time is freed, and an outcome can't be changed afterwards.`,
		);
		assert.equal(
			outcomeQuestion("cancelled", WHEN),
			`Cancel the session on ${WHEN}? Its time is freed, and an outcome can't be changed afterwards.`,
		);
	});
});
