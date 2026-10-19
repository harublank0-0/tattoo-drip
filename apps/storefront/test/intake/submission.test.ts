import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTattooClient } from "@tattoo-drip/sdk";
import type { IntakeValues } from "../../src/intake/rules.ts";
import { toInquiryInput } from "../../src/intake/submission.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";

const API = "http://api.test";
const SITA_ID = "0199f000-0000-7000-8000-000000000048";
const FULL: IntakeValues = {
	idea: "  A fine-line peony with two leaves\n",
	placement: " Left forearm ",
	approximateSize: "About 10 cm",
	preferredDates: "Any weekday in November",
	preferredArtistId: SITA_ID,
	budget: " NPR 15000 ",
	sourceChannel: "instagram",
	contactName: " Asha Gurung ",
	contactPhone: " 98-1234-5678 ",
	contactEmail: " asha@example.com ",
};
const SHORT: IntakeValues = {
	...FULL,
	preferredArtistId: "",
	budget: " ",
	contactEmail: "",
};
const photo = (size: number) =>
	new File([new Uint8Array(size)], "reference.jpg", { type: "image/jpeg" });

describe("toInquiryInput", () => {
	test("names every answer as the contract does, trimmed, the photos in order", () => {
		const images = [photo(3), photo(5)];

		assert.deepEqual(toInquiryInput(FULL, images, ""), {
			idea: "A fine-line peony with two leaves",
			placement: "Left forearm",
			approximateSize: "About 10 cm",
			preferredDates: "Any weekday in November",
			preferredArtistId: SITA_ID,
			budget: "NPR 15000",
			sourceChannel: "instagram",
			contactName: "Asha Gurung",
			contactPhone: "98-1234-5678",
			contactEmail: "asha@example.com",
			referenceImages: images,
			honeypot: "",
		});
	});

	test("leaves the empty optional answers out", () => {
		const input = toInquiryInput(SHORT, [], "");

		assert.equal(input.preferredArtistId, undefined);
		assert.equal(input.budget, undefined);
		assert.equal(input.contactEmail, undefined);
		assert.deepEqual(input.referenceImages, []);
	});

	test("sends Devanagari digits as ASCII ones", () => {
		assert.equal(
			toInquiryInput({ ...FULL, contactPhone: "९८१२३४५६७८" }, [], "")
				.contactPhone,
			"9812345678",
		);
	});

	test("passes the honeypot's value through as it is", () => {
		assert.equal(
			toInquiryInput(FULL, [], "https://spam.example").honeypot,
			"https://spam.example",
		);
	});

	test("refuses to build an inquiry without a source channel", () => {
		assert.throws(
			() => toInquiryInput({ ...FULL, sourceChannel: "" }, [], ""),
			/validateIntake/,
		);
	});
});

describe("on the wire (the SDK's real inquiries.create)", () => {
	async function sent(
		values: IntakeValues,
		images: File[],
		honeypot: string,
		challengeToken?: string,
	) {
		const { calls, fetch } = fakeFetch(() =>
			json(201, { data: { id: "0199f000-0000-7000-8000-000000000057" } }),
		);
		const client = createTattooClient({
			baseUrl: API,
			tenant: "black-needle-48",
			fetch,
		});
		await client.inquiries.create({
			...toInquiryInput(values, images, honeypot),
			challengeToken,
		});
		const [call] = calls;
		return {
			call,
			form: call.init.body as FormData,
			headers: new Headers(call.init.headers),
		};
	}

	test("one multipart POST with exactly the contract's fields and the token in a header", async () => {
		const { call, form, headers } = await sent(
			FULL,
			[photo(3), photo(5)],
			"",
			"token-57",
		);

		assert.equal(call.url, `${API}/api/v1/tenants/black-needle-48/inquiries`);
		assert.equal(call.init.method, "POST");
		assert.equal(call.init.credentials, "omit");
		assert.equal(headers.get("x-challenge-token"), "token-57");
		assert.deepEqual(
			[...form.keys()],
			[
				"idea",
				"placement",
				"approximateSize",
				"preferredDates",
				"preferredArtistId",
				"budget",
				"sourceChannel",
				"contactName",
				"contactPhone",
				"contactEmail",
				"referenceImages",
				"referenceImages",
			],
		);
		const images = form.getAll("referenceImages") as File[];
		assert.deepEqual(
			images.map((image) => [image.name, image.size, image.type]),
			[
				["reference.jpg", 3, "image/jpeg"],
				["reference.jpg", 5, "image/jpeg"],
			],
		);
		assert.equal(form.get("contactPhone"), "98-1234-5678");
	});

	test("no optional field when empty, no website when the honeypot is empty, no token field ever", async () => {
		const { form, headers } = await sent(SHORT, [], "");

		for (const name of [
			"preferredArtistId",
			"budget",
			"contactEmail",
			"referenceImages",
			"website",
			"challengeToken",
			"honeypot",
		]) {
			assert.equal(form.has(name), false, name);
		}
		assert.equal(
			headers.get("x-challenge-token"),
			null,
			"no token in development",
		);
	});

	test("a filled honeypot goes as website, for the API to refuse", async () => {
		const { form } = await sent(SHORT, [], "https://spam.example");

		assert.equal(form.get("website"), "https://spam.example");
		assert.equal(form.has("honeypot"), false);
	});
});
