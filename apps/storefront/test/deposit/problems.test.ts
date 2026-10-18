import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TattooApiError } from "@tattoo-drip/sdk";
import { copy } from "../../src/deposit/copy.ts";
import {
	describeLoadError,
	describeProofError,
	firstMessage,
	focusAfterReread,
	formatWait,
	type ProofProblem,
	screenFor,
	sentGone,
	summaryItems,
	validateProofForm,
} from "../../src/deposit/problems.ts";
import { PAGE } from "./fixtures.ts";

const api = (
	status: number,
	code: string,
	extra: { fields?: Record<string, string[]>; retryAfter?: number } = {},
) =>
	new TattooApiError(
		status,
		{ code, message: "The API's own words.", fields: extra.fields },
		{ retryAfter: extra.retryAfter },
	);

const notice = (
	code: string,
	refetch = false,
	waitSeconds: number | null = null,
) => ({ kind: "notice", code, refetch, waitSeconds });

function fieldsOf(problem: ProofProblem) {
	assert.equal(problem.kind, "fields");
	return problem.kind === "fields" ? problem.fields : {};
}

describe("loading the page", () => {
	test("a link that doesn't work, a rate limit, anything else", () => {
		assert.equal(describeLoadError(api(404, "not_found")), "dead");
		assert.equal(describeLoadError(api(404, "unknown_error")), "dead");
		assert.equal(describeLoadError(api(429, "rate_limited")), "rate-limited");
		for (const error of [
			api(0, "network_error"),
			api(0, "timeout"),
			api(500, "internal_error"),
			api(200, "invalid_response"),
			new TypeError("x"),
		]) {
			assert.equal(describeLoadError(error), "failed");
		}
	});

	test("loading, then the page", () => {
		assert.deepEqual(screenFor({ data: undefined, error: null }), {
			kind: "loading",
		});
		assert.deepEqual(screenFor({ data: PAGE, error: null }), {
			kind: "page",
			page: PAGE,
		});
	});

	test("a link that stopped working replaces the page, even over data already shown", () => {
		assert.deepEqual(screenFor({ data: PAGE, error: api(404, "not_found") }), {
			kind: "problem",
			problem: "dead",
		});
	});

	test("any other failed refresh keeps the page shown", () => {
		for (const error of [api(0, "network_error"), api(429, "rate_limited")]) {
			assert.deepEqual(screenFor({ data: PAGE, error }), {
				kind: "page",
				page: PAGE,
			});
		}
	});

	test("a read that can't start offline says to check the connection, not a skeleton for ever", () => {
		assert.deepEqual(
			screenFor({ data: undefined, error: null, fetchStatus: "paused" }),
			{ kind: "problem", problem: "failed" },
		);
		// Only a first read with nothing yet: a running read is still loading, and a
		// paused refresh keeps the page shown.
		for (const fetchStatus of ["fetching", "idle"] as const) {
			assert.deepEqual(
				screenFor({ data: undefined, error: null, fetchStatus }),
				{ kind: "loading" },
			);
		}
		assert.deepEqual(
			screenFor({ data: PAGE, error: null, fetchStatus: "paused" }),
			{ kind: "page", page: PAGE },
		);
	});

	test("a send answered 404 replaces the page too, whatever a follow-up read does", () => {
		for (const error of [
			null,
			api(0, "network_error"),
			api(503, "service_busy"),
		]) {
			assert.deepEqual(screenFor({ data: PAGE, error, sendGone: true }), {
				kind: "problem",
				problem: "dead",
			});
		}
		assert.deepEqual(screenFor({ data: PAGE, error: null, sendGone: false }), {
			kind: "page",
			page: PAGE,
		});
	});

	test("the send's 404 stands until a read succeeds after it", () => {
		assert.equal(sentGone(null, 5_000), false);
		assert.equal(sentGone(5_000, 0), true);
		assert.equal(sentGone(5_000, 4_999), true);
		assert.equal(sentGone(5_000, 5_000), true);
		assert.equal(sentGone(5_000, 5_001), false);
	});

	test("a failed first read says why", () => {
		assert.deepEqual(
			screenFor({ data: undefined, error: api(429, "rate_limited") }),
			{ kind: "problem", problem: "rate-limited" },
		);
		assert.deepEqual(
			screenFor({ data: undefined, error: api(500, "internal_error") }),
			{ kind: "problem", problem: "failed" },
		);
	});
});

describe("focusAfterReread", () => {
	test("moves focus to the page's new message, unless it stays due, couldn't be read, or is the dead link the send already showed", () => {
		assert.equal(focusAfterReread("changed", "due"), false);
		assert.equal(focusAfterReread("offline", "failed"), false);
		assert.equal(focusAfterReread("offline", "submitted"), true);
		assert.equal(focusAfterReread("not-due", "paid"), true);
		assert.equal(focusAfterReread("not-due", "gone"), true);
		assert.equal(focusAfterReread("gone", "gone"), false);
		assert.equal(focusAfterReread("gone", "submitted"), true);
	});
});

describe("describeProofError", () => {
	test("every refusal, and whether to read the page again", () => {
		const cases: Array<[unknown, ReturnType<typeof notice>]> = [
			[api(409, "deposit_changed"), notice("changed", true)],
			[api(409, "deposit_not_due"), notice("not-due", true)],
			[api(409, "unknown_error"), notice("not-due", true)],
			[api(404, "not_found"), notice("gone", true)],
			[api(404, "unknown_error"), notice("gone", true)],
			[
				api(429, "rate_limited", { retryAfter: 1200 }),
				notice("rate-limited", false, 1200),
			],
			[api(429, "rate_limited"), notice("rate-limited", false, 60)],
			[api(429, "unknown_error"), notice("rate-limited", false, 60)],
			[api(400, "bad_request"), notice("cut-off")],
			[api(415, "unsupported_media_type"), notice("cut-off")],
			[api(503, "service_busy", { retryAfter: 5 }), notice("busy")],
			[api(500, "internal_error"), notice("server")],
			[api(200, "invalid_response"), notice("server")],
			[new TypeError("x"), notice("server")],
		];
		for (const [error, expected] of cases) {
			assert.deepEqual(describeProofError(error), expected, String(error));
		}
	});

	test("a timeout, a network error and a 408 read the page again: the upload may have landed", () => {
		for (const error of [
			api(0, "timeout"),
			api(0, "network_error"),
			api(408, "request_timeout"),
		]) {
			assert.deepEqual(describeProofError(error), notice("offline", true));
		}
	});

	test("a too-large upload is the screenshot's own problem", () => {
		for (const error of [
			api(413, "payload_too_large"),
			api(413, "unknown_error"),
		]) {
			assert.deepEqual(fieldsOf(describeProofError(error)), {
				proof: copy.form.tooLarge,
			});
		}
	});

	test("validation_failed puts the API's message under its field", () => {
		assert.deepEqual(
			fieldsOf(
				describeProofError(
					api(422, "validation_failed", {
						fields: { proof: ["The image could not be read."] },
					}),
				),
			),
			{ proof: "The image could not be read." },
		);
		assert.deepEqual(
			fieldsOf(
				describeProofError(
					api(422, "validation_failed", {
						fields: {
							method: ["Choose one of the page's payment methods."],
							proof: ["Bad."],
						},
					}),
				),
			),
			{ method: "Choose one of the page's payment methods.", proof: "Bad." },
		);
		const long = "x".repeat(400);
		assert.equal(
			fieldsOf(
				describeProofError(
					api(422, "validation_failed", { fields: { proof: [long] } }),
				),
			).proof?.length,
			300,
		);
	});

	test("an amount the API refuses means the page is stale; nothing placeable is a notice", () => {
		assert.deepEqual(
			describeProofError(
				api(422, "validation_failed", { fields: { expectedAmount: ["x"] } }),
			),
			notice("changed", true),
		);
		assert.deepEqual(
			describeProofError(
				api(422, "validation_failed", { fields: { other: ["x"] } }),
			),
			notice("invalid"),
		);
		assert.deepEqual(
			describeProofError(api(422, "validation_failed")),
			notice("invalid"),
		);
	});
});

describe("the form's own checks", () => {
	test("a method must be one the page lists", () => {
		assert.equal(
			validateProofForm({ method: "esewa" }, ["esewa", "bank"]),
			null,
		);
		assert.deepEqual(validateProofForm({ method: "" }, ["esewa", "bank"]), {
			method: copy.form.required.method,
		});
		assert.deepEqual(validateProofForm({ method: "cash" }, ["esewa"]), {
			method: copy.form.required.method,
		});
	});

	test("the summary lists the method, then the screenshot", () => {
		assert.deepEqual(
			summaryItems("Choose how you paid.", "Add a screenshot of your payment."),
			[
				{
					target: "method-0",
					label: copy.form.summaryLabels.method,
					message: "Choose how you paid.",
				},
				{
					target: "proof-input",
					label: copy.form.summaryLabels.proof,
					message: "Add a screenshot of your payment.",
				},
			],
		);
		assert.deepEqual(summaryItems(undefined, null), []);
	});

	test("firstMessage reads the API's lists and the form's errors", () => {
		assert.equal(firstMessage(["", "  First.  ", "Second."]), "First.");
		assert.equal(firstMessage("Alone."), "Alone.");
		assert.equal(
			firstMessage([{ message: "From the form." }]),
			"From the form.",
		);
		assert.equal(firstMessage([1, null, {}]), undefined);
		assert.equal(firstMessage(undefined), undefined);
	});

	test("formatWait: rounded up, in minutes or hours (TAT-57's rule)", () => {
		assert.equal(formatWait(10), "a minute");
		assert.equal(formatWait(60), "a minute");
		assert.equal(formatWait(61), "2 minutes");
		assert.equal(formatWait(1200), "20 minutes");
		assert.equal(formatWait(3600), "an hour");
		assert.equal(formatWait(3601), "2 hours");
	});
});
