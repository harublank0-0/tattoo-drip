import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	VISITOR_IP_HEADER,
	visitorAddress,
	withVisitorAddress,
} from "../../src/tenancy/visitor.ts";
import { fakeFetch, json } from "./helpers.ts";

const request = (headers: Record<string, string> = {}, ip?: string) =>
	Object.assign(
		new Request("http://internal.invalid/", { headers }),
		ip ? { ip } : {},
	);

describe("visitorAddress", () => {
	test("is the first X-Forwarded-For value when it is an IP", () => {
		assert.equal(
			visitorAddress(request({ "x-forwarded-for": "203.0.113.7" })),
			"203.0.113.7",
		);
		assert.equal(
			visitorAddress(request({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" })),
			"203.0.113.7",
		);
		assert.equal(
			visitorAddress(request({ "x-forwarded-for": "2001:db8::1" })),
			"2001:db8::1",
		);
	});

	test("falls back to the socket address, else none", () => {
		assert.equal(visitorAddress(request({}, "198.51.100.4")), "198.51.100.4");
		assert.equal(
			visitorAddress(request({ "x-forwarded-for": "unknown" }, "198.51.100.4")),
			"198.51.100.4",
		);
		assert.equal(
			visitorAddress(request({ "x-forwarded-for": "999.1.1.1" })),
			undefined,
		);
		assert.equal(
			visitorAddress(request({ "x-forwarded-for": "<script>" })),
			undefined,
		);
		assert.equal(visitorAddress(request()), undefined);
	});
});

describe("withVisitorAddress", () => {
	test("adds X-Visitor-IP and keeps the other headers", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, {}));
		const wrapped = withVisitorAddress(fetch, "203.0.113.7");
		await wrapped?.("http://api.test/x", {
			headers: { authorization: "Bearer k" },
		});
		const headers = new Headers(calls[0].init.headers);
		assert.equal(VISITOR_IP_HEADER, "x-visitor-ip");
		assert.equal(headers.get("x-visitor-ip"), "203.0.113.7");
		assert.equal(headers.get("authorization"), "Bearer k");
	});

	test("without an address it is the fetch it was given", () => {
		const { fetch } = fakeFetch(() => json(200, {}));
		assert.equal(withVisitorAddress(fetch, undefined), fetch);
		assert.equal(withVisitorAddress(undefined, undefined), undefined);
	});
});
