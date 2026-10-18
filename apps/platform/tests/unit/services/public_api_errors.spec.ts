import { Exception } from "@adonisjs/core/exceptions";
import { errors as httpErrors } from "@adonisjs/core/http";
import { LimiterResponse, errors as limiterErrors } from "@adonisjs/limiter";
import { test } from "@japa/runner";
import { errors as vineErrors } from "@vinejs/vine";
import {
	ApiException,
	apiErrorFor,
	apiErrorIsReported,
} from "#services/public_api_errors";

const SECRET = "connection refused at 10.0.0.5:5432 for tattoo_drip_app";

const shared = (status: number, code: string, message: string) => ({
	status,
	body: { error: { code, message } },
	headers: {},
});

test.group("apiErrorFor", () => {
	test("a VineJS error is validation_failed with its messages by field", ({
		assert,
	}) => {
		const error = new vineErrors.E_VALIDATION_ERROR([
			{
				field: "client.phone",
				message: "Enter a phone number",
				rule: "required",
			},
			{ field: "client.phone", message: "Use the +977 format", rule: "regex" },
			{
				field: "referenceImages.0",
				message: "Use a JPEG, PNG or WebP image",
				rule: "file",
			},
		]);

		assert.deepEqual(apiErrorFor(error), {
			status: 422,
			body: {
				error: {
					code: "validation_failed",
					message: "Some fields are invalid.",
					fields: {
						"client.phone": ["Enter a phone number", "Use the +977 format"],
						"referenceImages.0": ["Use a JPEG, PNG or WebP image"],
					},
				},
			},
			headers: {},
		});
	});

	test("an ApiException keeps its status, code and message, without fields", ({
		assert,
	}) => {
		const error = new ApiException(
			409,
			"too_many_open_inquiries",
			"This studio already has your request.",
		);

		assert.deepEqual(apiErrorFor(error), {
			status: 409,
			body: {
				error: {
					code: "too_many_open_inquiries",
					message: "This studio already has your request.",
				},
			},
			headers: {},
		});
	});

	test("only a validation_failed ApiException carries fields", ({ assert }) => {
		const fields = { "client.phone": ["Already open"] };

		assert.deepEqual(
			apiErrorFor(
				new ApiException(422, "validation_failed", "Check the fields.", fields),
			),
			{
				status: 422,
				body: {
					error: {
						code: "validation_failed",
						message: "Check the fields.",
						fields,
					},
				},
				headers: {},
			},
		);
		assert.throws(
			() =>
				// @ts-expect-error fields are refused for any other code
				new ApiException(409, "too_many_open_inquiries", "Open.", fields),
			/cannot carry fields/,
		);
	});

	test("ApiException.notFound is a 404 even when other methods match", ({
		assert,
	}) => {
		assert.deepEqual(
			apiErrorFor(ApiException.notFound(), ["GET", "HEAD"]),
			shared(404, "not_found", "Not found."),
		);
	});

	test("a route miss is not_found, or method_not_allowed with Allow when another method matches", ({
		assert,
	}) => {
		const miss = new httpErrors.E_ROUTE_NOT_FOUND(["PUT", "/api/v1/x"]);

		assert.deepEqual(apiErrorFor(miss), shared(404, "not_found", "Not found."));
		assert.deepEqual(apiErrorFor(miss, ["GET", "HEAD"]), {
			...shared(405, "method_not_allowed", "This method is not allowed here."),
			headers: { Allow: "GET, HEAD" },
		});
	});

	test("framework errors map by status, with the shared message", ({
		assert,
	}) => {
		const cases: [unknown, number, string, string][] = [
			[
				Object.assign(new SyntaxError(`Unexpected token in ${SECRET}`), {
					status: 400,
				}),
				400,
				"bad_request",
				"The request could not be read.",
			],
			[
				new Exception(SECRET, { status: 404, code: "E_ROW_NOT_FOUND" }),
				404,
				"not_found",
				"Not found.",
			],
			[
				new Exception(SECRET, {
					status: 413,
					code: "E_REQUEST_ENTITY_TOO_LARGE",
				}),
				413,
				"payload_too_large",
				"The request is too large.",
			],
			[
				new Exception(SECRET, { status: 415, code: "E_ENCODING_UNSUPPORTED" }),
				415,
				"unsupported_media_type",
				"This content type or encoding is not supported.",
			],
		];

		for (const [error, status, code, message] of cases) {
			assert.deepEqual(apiErrorFor(error), shared(status, code, message), code);
		}
	});

	test("a 422 that is not a VineJS error is a 400 bad_request", ({
		assert,
	}) => {
		const strictJson = new Exception(
			"Invalid JSON, only supports object and array",
			{ status: 422 },
		);

		assert.deepEqual(
			apiErrorFor(strictJson),
			shared(400, "bad_request", "The request could not be read."),
		);
	});

	test("another 4xx keeps its status with bad_request", ({ assert }) => {
		assert.deepEqual(
			apiErrorFor(new Exception(SECRET, { status: 409 })),
			shared(409, "bad_request", "The request could not be read."),
		);
	});

	test("a rate limit is rate_limited with Retry-After and the limiter's headers", ({
		assert,
	}) => {
		const error = new limiterErrors.E_TOO_MANY_REQUESTS(
			new LimiterResponse({
				limit: 10,
				remaining: 0,
				consumed: 11,
				availableIn: 42,
			}),
		);

		const { status, body, headers } = apiErrorFor(error);

		assert.equal(status, 429);
		assert.deepEqual(body, {
			error: {
				code: "rate_limited",
				message: "Too many requests. Try again later.",
			},
		});
		assert.equal(headers["Retry-After"], "42");
		assert.equal(headers["X-RateLimit-Limit"], "10");
		assert.equal(headers["X-RateLimit-Remaining"], "0");
		assert.isString(headers["X-RateLimit-Reset"]);
	});

	test("anything else is internal_error and never shows its message", ({
		assert,
	}) => {
		for (const error of [
			new Error(SECRET),
			new Exception(SECRET, { status: 503 }),
			SECRET,
			null,
			undefined,
		]) {
			const result = apiErrorFor(error);
			assert.deepEqual(
				result,
				shared(500, "internal_error", "Something went wrong. Try again later."),
			);
			assert.notInclude(JSON.stringify(result), "10.0.0.5");
		}
	});
});

test.group("ApiException.of", () => {
	test("an endpoint's code comes with its status and its one message", ({
		assert,
	}) => {
		const cases = [
			[
				"artist_not_accepting",
				"This artist isn't taking new requests right now. Choose another artist, or none.",
			],
			[
				"studio_not_accepting",
				"This studio isn't taking new requests right now.",
			],
			[
				"too_many_open_inquiries",
				"You already have requests waiting with this studio. They will reply on WhatsApp or Viber.",
			],
		] as const;

		for (const [code, message] of cases) {
			assert.deepEqual(
				apiErrorFor(ApiException.of(code)),
				{ status: 409, body: { error: { code, message } }, headers: {} },
				code,
			);
		}
	});

	test("a shared code works the same, with fields", ({ assert }) => {
		const error = ApiException.of("validation_failed", {
			preferredArtistId: ["Choose an artist from the list, or none."],
		});

		assert.deepEqual(apiErrorFor(error), {
			status: 422,
			body: {
				error: {
					code: "validation_failed",
					message: "Some fields are invalid.",
					fields: {
						preferredArtistId: ["Choose an artist from the list, or none."],
					},
				},
			},
			headers: {},
		});
		assert.deepEqual(apiErrorFor(ApiException.of("not_found")), {
			status: 404,
			body: { error: { code: "not_found", message: "Not found." } },
			headers: {},
		});
	});
});

test.group("The deposit codes", () => {
	test("deposit_not_due and deposit_changed are 409s with their one message", ({
		assert,
	}) => {
		const cases = [
			[
				"deposit_not_due",
				"This deposit can't be paid here right now. Reload the page to see why.",
			],
			[
				"deposit_changed",
				"The deposit amount changed. Check the new amount before you upload.",
			],
		] as const;

		for (const [code, message] of cases) {
			assert.deepEqual(
				apiErrorFor(ApiException.of(code)),
				{ status: 409, body: { error: { code, message } }, headers: {} },
				code,
			);
		}
	});
});

test.group("The challenge codes", () => {
	test("challenge_failed is a 403 and challenge_unavailable a 503, each with its one message", ({
		assert,
	}) => {
		const cases = [
			[
				403,
				"challenge_failed",
				"We couldn't confirm this request came from a person. Please try again.",
			],
			[
				503,
				"challenge_unavailable",
				"We couldn't run the security check. Try again in a minute.",
			],
		] as const;

		for (const [status, code, message] of cases) {
			assert.deepEqual(
				apiErrorFor(ApiException.of(code)),
				{ status, body: { error: { code, message } }, headers: {} },
				code,
			);
		}
	});
});

test.group("Busy and slow (TAT-38)", () => {
	test("a pool with no free connection in time is service_busy, retried after 10 s, and reported", ({
		assert,
	}) => {
		const error = Object.assign(
			new Error(
				"Knex: Timeout acquiring a connection. The pool is probably full.",
			),
			{ name: "KnexTimeoutError" },
		);
		const { status, body, headers } = apiErrorFor(error);
		assert.equal(status, 503);
		assert.equal(body.error.code, "service_busy");
		assert.notInclude(body.error.message, "Knex");
		assert.equal(headers["Retry-After"], "10");
		assert.isTrue(apiErrorIsReported(error));
	});

	test("retryLater carries Retry-After; a busy refusal is not reported", ({
		assert,
	}) => {
		const limited = apiErrorFor(ApiException.retryLater("rate_limited", 10));
		assert.equal(limited.status, 429);
		assert.equal(limited.body.error.code, "rate_limited");
		assert.equal(limited.headers["Retry-After"], "10");

		const busy = ApiException.retryLater("service_busy", 10);
		assert.equal(apiErrorFor(busy).status, 503);
		assert.equal(apiErrorFor(busy).headers["Retry-After"], "10");
		assert.isFalse(apiErrorIsReported(busy));
		assert.isFalse(apiErrorIsReported(ApiException.notFound()));
		assert.isTrue(apiErrorIsReported(ApiException.of("challenge_unavailable")));
		assert.isTrue(apiErrorIsReported(new Error(SECRET)));
		assert.deepEqual(apiErrorFor(ApiException.of("service_busy")).headers, {});
	});

	test("a 408 is request_timeout", ({ assert }) => {
		const { status, body } = apiErrorFor(
			new Exception("Request timeout", {
				status: 408,
				code: "E_REQUEST_TIMEOUT",
			}),
		);
		assert.equal(status, 408);
		assert.equal(body.error.code, "request_timeout");
	});
});
