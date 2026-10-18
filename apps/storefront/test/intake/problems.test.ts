import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TattooApiError } from "@tattoo-drip/sdk";
import {
	afterBlockEnds,
	describeChallengeFailure,
	describeSubmitError,
	formatWait,
	noticeValues,
	type ProblemContext,
	type SubmitProblem,
	unexpectedProblem,
} from "../../src/intake/problems.ts";

const SITA_ID = "0199f000-0000-7000-8000-000000000048";
const CONTEXT: ProblemContext = {
	sentArtistId: null,
	artistName: (id) => (id === SITA_ID ? "Sita Rai" : null),
};
/** The API's message, which the form must never show for these codes. */
const DETAIL = "internal-detail-never-shown";

function notice(
	code: Extract<SubmitProblem, { kind: "notice" }>["code"],
	flags: {
		retry?: boolean;
		contact?: boolean;
		reload?: boolean;
		waitSeconds?: number;
	} = {},
): SubmitProblem {
	return {
		kind: "notice",
		code,
		retry: flags.retry ?? false,
		contact: flags.contact ?? false,
		reload: flags.reload ?? false,
		waitSeconds: flags.waitSeconds ?? null,
	};
}

const apiError = (
	status: number,
	code?: string,
	extra: { fields?: Record<string, string[]>; retryAfter?: number } = {},
) =>
	new TattooApiError(
		status,
		code ? { code, message: DETAIL, fields: extra.fields } : undefined,
		{
			retryAfter: extra.retryAfter,
		},
	);

describe("describeSubmitError", () => {
	test("every code the API or the SDK can give becomes its notice", () => {
		const table: Array<[TattooApiError | Error, SubmitProblem]> = [
			[
				apiError(409, "too_many_open_inquiries"),
				notice("already-waiting", { contact: true }),
			],
			[
				apiError(409, "studio_not_accepting"),
				notice("studio-closed", { contact: true }),
			],
			[
				apiError(403, "challenge_failed"),
				notice("challenge-failed", { retry: true, contact: true }),
			],
			[
				apiError(503, "challenge_unavailable"),
				notice("challenge-unavailable", { retry: true, contact: true }),
			],
			[apiError(413, "payload_too_large"), notice("too-large")],
			[apiError(413), notice("too-large")],
			[apiError(400, "bad_request"), notice("cut-off", { retry: true })],
			[apiError(404, "not_found"), notice("page-outdated", { reload: true })],
			[apiError(0, "timeout"), notice("timeout", { retry: true })],
			[apiError(0, "network_error"), notice("offline", { retry: true })],
			[
				apiError(415, "unsupported_media_type"),
				notice("server", { retry: true, contact: true }),
			],
			[
				apiError(405, "method_not_allowed"),
				notice("server", { retry: true, contact: true }),
			],
			[
				apiError(500, "internal_error"),
				notice("server", { retry: true, contact: true }),
			],
			[apiError(502), notice("server", { retry: true, contact: true })],
			[apiError(404), notice("server", { retry: true, contact: true })],
			[
				apiError(200, "invalid_response"),
				notice("server", { retry: true, contact: true }),
			],
			[
				new TypeError("x is not a function"),
				notice("server", { retry: true, contact: true }),
			],
			[
				new DOMException("The operation was aborted.", "AbortError") as Error,
				notice("server", { retry: true, contact: true }),
			],
		];
		for (const [error, expected] of table) {
			const problem = describeSubmitError(error, CONTEXT);
			assert.deepEqual(
				problem,
				expected,
				`${(error as TattooApiError).code ?? error.name} ${(error as TattooApiError).status ?? ""}`,
			);
			assert.doesNotMatch(JSON.stringify(problem), new RegExp(DETAIL));
		}
	});

	test("rate limits say how long", () => {
		assert.deepEqual(
			describeSubmitError(
				apiError(429, "rate_limited", { retryAfter: 86_400 }),
				CONTEXT,
			),
			notice("rate-limited", { contact: true, waitSeconds: 86_400 }),
		);
		assert.deepEqual(
			describeSubmitError(apiError(429, "rate_limited"), CONTEXT),
			notice("rate-limited", { contact: true, waitSeconds: 60 }),
		);
		assert.deepEqual(
			describeSubmitError(
				apiError(429, undefined, { retryAfter: 30 }),
				CONTEXT,
			),
			notice("rate-limited", { contact: true, waitSeconds: 30 }),
		);
	});

	test("field errors land on their fields, with the API's own words", () => {
		const problem = describeSubmitError(
			apiError(422, "validation_failed", {
				fields: {
					contactPhone: [
						"Enter a phone number, like 9812345678 or +977 1 4123456.",
					],
					preferredArtistId: [
						"Choose an artist from the list, or none.",
						"second",
					],
					"referenceImages.1": ["Upload a JPEG, PNG or WebP image."],
					referenceImages: ["Attach up to 5 images."],
					website: ["ignored"],
					challengeToken: ["ignored"],
					idea: [""],
				},
			}),
			CONTEXT,
		);

		assert.deepEqual(problem, {
			kind: "fields",
			fields: {
				contactPhone:
					"Enter a phone number, like 9812345678 or +977 1 4123456.",
				preferredArtistId: "Choose an artist from the list, or none.",
			},
			photos: {
				1: "This photo wasn't accepted: Upload a JPEG, PNG or WebP image. Remove it, then send again.",
			},
			photosError: "Attach up to 5 images.",
		});
	});

	test("a validation error the form can't place says some answers weren't accepted", () => {
		assert.deepEqual(
			describeSubmitError(
				apiError(422, "validation_failed", { fields: { website: ["x"] } }),
				CONTEXT,
			),
			notice("invalid"),
		);
		assert.deepEqual(
			describeSubmitError(apiError(422, "validation_failed"), CONTEXT),
			notice("invalid"),
		);
	});

	test("an artist who just closed is named on the artist choice", () => {
		assert.deepEqual(
			describeSubmitError(apiError(409, "artist_not_accepting"), {
				...CONTEXT,
				sentArtistId: SITA_ID,
			}),
			{
				kind: "fields",
				fields: {
					preferredArtistId:
						"Sita Rai just stopped taking new inquiries. Choose another artist, or No preference.",
				},
				photos: {},
				photosError: null,
			},
		);
		assert.deepEqual(
			describeSubmitError(apiError(409, "artist_not_accepting"), CONTEXT),
			{
				kind: "fields",
				fields: {
					preferredArtistId:
						"That artist just stopped taking new inquiries. Choose another artist, or No preference.",
				},
				photos: {},
				photosError: null,
			},
		);
	});
});

describe("describeChallengeFailure", () => {
	test("each widget failure has its notice", () => {
		assert.deepEqual(
			describeChallengeFailure("blocked"),
			notice("challenge-blocked", { retry: true, contact: true }),
		);
		assert.deepEqual(
			describeChallengeFailure("expired"),
			notice("challenge-expired", { retry: true }),
		);
		assert.deepEqual(
			describeChallengeFailure("unsupported"),
			notice("challenge-unsupported", { contact: true }),
		);
	});
});

describe("formatWait", () => {
	test("in minutes, then hours, rounded up", () => {
		for (const [seconds, words] of [
			[0, "a minute"],
			[45, "a minute"],
			[60, "a minute"],
			[61, "2 minutes"],
			[1_200, "20 minutes"],
			[3_599, "an hour"],
			[3_600, "an hour"],
			[3_601, "2 hours"],
			[86_400, "24 hours"],
		] as const) {
			assert.equal(formatWait(seconds), words, String(seconds));
		}
	});
});

describe("noticeValues", () => {
	test("the studio's name and the wait", () => {
		assert.deepEqual(
			noticeValues(
				notice("rate-limited", { waitSeconds: 1_200 }) as Extract<
					SubmitProblem,
					{ kind: "notice" }
				>,
				"Black Needle",
			),
			{
				studio: "Black Needle",
				wait: "20 minutes",
			},
		);
	});
});

describe("an answer that isn't shaped as the contract says", () => {
	/** A validation_failed whose `fields` holds whatever it is told. */
	const withFields = (fields: unknown) =>
		apiError(422, "validation_failed", {
			fields: fields as Record<string, string[]>,
		});

	test("a field's message that isn't a list is used if it is text, else ignored", () => {
		assert.deepEqual(
			describeSubmitError(
				withFields({
					idea: "Too long.",
					placement: ["Say where."],
					budget: 42,
					contactName: null,
					referenceImages: { 0: "nope" },
				}),
				CONTEXT,
			),
			{
				kind: "fields",
				fields: { idea: "Too long.", placement: "Say where." },
				photos: {},
				photosError: null,
			},
		);
	});

	test("when nothing in it can be placed, it is the 'some answers weren't accepted' notice", () => {
		for (const fields of [
			{ idea: 7 },
			{ nothing: ["on this form"] },
			{ referenceImages: 42 },
			[],
			"idea",
		]) {
			assert.deepEqual(
				describeSubmitError(withFields(fields), CONTEXT),
				notice("invalid"),
				JSON.stringify(fields),
			);
		}
	});
});

describe("unexpectedProblem", () => {
	test("is the generic notice: try again, or message the studio", () => {
		assert.deepEqual(
			unexpectedProblem(),
			notice("server", { retry: true, contact: true }),
		);
	});
});

describe("afterBlockEnds", () => {
	test("takes the rate-limit notice away once its wait is over", () => {
		const limited = describeSubmitError(
			apiError(429, "rate_limited", { retryAfter: 1200 }),
			CONTEXT,
		);
		assert.equal(limited.kind, "notice");
		assert.equal(
			afterBlockEnds(limited.kind === "notice" ? limited : null),
			null,
		);
	});

	test("leaves every other notice, and no notice, as it is", () => {
		const other = describeSubmitError(apiError(500, "internal_error"), CONTEXT);
		assert.equal(other.kind, "notice");
		if (other.kind === "notice") assert.equal(afterBlockEnds(other), other);
		assert.equal(afterBlockEnds(null), null);
	});
});
