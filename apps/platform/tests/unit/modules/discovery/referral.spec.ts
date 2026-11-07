import { createHmac, hkdfSync } from "node:crypto";
import { test } from "@japa/runner";
import {
	linkReferral,
	MAX_REFERRAL_LENGTH,
	REFERRAL_TTL_SECONDS,
	signReferral,
	verifyReferral,
} from "#modules/discovery/referral";
import env from "#start/env";

const STUDIO = "0b6f8e2c-6a4a-4f1e-9a51-1b0c2d3e4f50";
const OTHER = "1c7f9f3d-7b5b-4a2f-8b62-2c1d3e4f5a61";
const NOW = new Date("2026-11-06T10:00:00.000Z");
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const later = (secs: number) => new Date(NOW.getTime() + secs * 1000);

/** A token for an arbitrary payload, signed with the real key (what a forger with the key could make). */
function signed(payload: unknown, key = referralKey()) {
	const text = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${text}.${createHmac("sha256", key).update(text).digest("base64url")}`;
}

function referralKey(appKey = env.get("APP_KEY").release()) {
	return Buffer.from(
		hkdfSync(
			"sha256",
			appKey,
			"",
			"tattoo-drip discover referral token key v1",
			32,
		),
	);
}

const payload = (over: Record<string, unknown> = {}) => ({
	v: 1,
	p: "booking_referral",
	iss: "discover",
	sid: STUDIO,
	iat: seconds(NOW),
	exp: seconds(NOW) + REFERRAL_TTL_SECONDS,
	...over,
});

test.group("Discover referral tokens", () => {
	test("a fresh token verifies for its studio, with when it was issued", ({
		assert,
	}) => {
		const token = signReferral(STUDIO, NOW);
		assert.deepEqual(verifyReferral(token, STUDIO, NOW), {
			valid: true,
			issuedAt: new Date(seconds(NOW) * 1000),
		});
		assert.isTrue(
			verifyReferral(token, STUDIO, later(REFERRAL_TTL_SECONDS - 1)).valid,
		);
		assert.isBelow(token.length, 300);
	});

	test("it holds nothing about a person: only version, purpose, issuer, studio and times", ({
		assert,
	}) => {
		const [text] = signReferral(STUDIO, NOW).split(".");
		const decoded = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
		assert.deepEqual(Object.keys(decoded).sort(), [
			"exp",
			"iat",
			"iss",
			"p",
			"sid",
			"v",
		]);
		assert.deepEqual(decoded, payload());
	});

	test("expires after 30 days", ({ assert }) => {
		const token = signReferral(STUDIO, NOW);
		assert.deepEqual(
			verifyReferral(token, STUDIO, later(REFERRAL_TTL_SECONDS)),
			{
				valid: false,
				reason: "expired",
			},
		);
	});

	test("is for one studio only", ({ assert }) => {
		assert.deepEqual(verifyReferral(signReferral(STUDIO, NOW), OTHER, NOW), {
			valid: false,
			reason: "studio",
		});
	});

	test("a token from the future beyond the clock allowance is refused", ({
		assert,
	}) => {
		assert.isTrue(
			verifyReferral(signReferral(STUDIO, later(299)), STUDIO, NOW).valid,
		);
		assert.deepEqual(
			verifyReferral(signReferral(STUDIO, later(301)), STUDIO, NOW),
			{
				valid: false,
				reason: "not_yet_valid",
			},
		);
	});

	test("a tampered payload or signature fails the signature check", ({
		assert,
	}) => {
		const token = signReferral(STUDIO, NOW);
		const [text, signature] = token.split(".");
		const forged = Buffer.from(
			JSON.stringify(payload({ sid: OTHER })),
		).toString("base64url");
		const flipped = `${signature.slice(0, -2)}${signature.endsWith("AA") ? "BB" : "AA"}`;
		for (const bad of [
			`${forged}.${signature}`,
			`${text}.${flipped}`,
			`${text}.${signature.slice(0, -4)}`,
			`${text}x.${signature}`,
			signed(payload(), referralKey("another-app-key-of-32-characters!!")),
		]) {
			assert.deepEqual(
				verifyReferral(bad, STUDIO, NOW),
				{ valid: false, reason: "signature" },
				bad,
			);
		}
	});

	test("a signed token of another version or purpose is refused", ({
		assert,
	}) => {
		assert.deepEqual(verifyReferral(signed(payload({ v: 2 })), STUDIO, NOW), {
			valid: false,
			reason: "version",
		});
		for (const over of [{ p: "login" }, { iss: "storefront" }]) {
			assert.deepEqual(verifyReferral(signed(payload(over)), STUDIO, NOW), {
				valid: false,
				reason: "purpose",
			});
		}
		for (const over of [
			{ iat: "now" },
			{ exp: 1.5 },
			{ sid: "not-a-uuid" },
			{ sid: 7 },
		]) {
			assert.deepEqual(verifyReferral(signed(payload(over)), STUDIO, NOW), {
				valid: false,
				reason: "malformed",
			});
		}
		assert.deepEqual(verifyReferral(signed([1, 2]), STUDIO, NOW), {
			valid: false,
			reason: "version",
		});
		assert.deepEqual(verifyReferral(signed(null), STUDIO, NOW), {
			valid: false,
			reason: "malformed",
		});
	});

	test("missing, non-string, oversized or misshapen input is refused without throwing", ({
		assert,
	}) => {
		for (const missing of [undefined, null, ""]) {
			assert.deepEqual(verifyReferral(missing, STUDIO, NOW), {
				valid: false,
				reason: "missing",
			});
		}
		for (const bad of [
			42,
			{ token: "x" },
			["a.b"],
			"no-dot",
			"a.b.c",
			"a b.c",
			".sig",
			"payload.",
			"x".repeat(MAX_REFERRAL_LENGTH + 1),
			`${"a".repeat(10)}.%%%`,
		]) {
			assert.deepEqual(
				verifyReferral(bad, STUDIO, NOW),
				{ valid: false, reason: "malformed" },
				String(bad),
			);
		}
	});
	test("a booking link's token is the same for the whole hour, then changes", ({
		assert,
	}) => {
		const hour = new Date("2026-11-06T10:00:00.000Z");
		const token = linkReferral(STUDIO, hour);
		assert.equal(token, signReferral(STUDIO, hour));
		assert.equal(linkReferral(STUDIO, later(59 * 60 + 59)), token);
		assert.notEqual(linkReferral(STUDIO, later(60 * 60)), token);
		assert.deepEqual(verifyReferral(token, STUDIO, later(3599)), {
			valid: true,
			issuedAt: hour,
		});
	});

	test("only one spelling of a signature verifies", ({ assert }) => {
		const token = signReferral(STUDIO, NOW);
		const [text, signature] = token.split(".");
		// 32 bytes are 43 characters: the last carries 2 spare bits.
		const last =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
		const index = last.indexOf(signature.at(-1) ?? "");
		const respelt = `${signature.slice(0, -1)}${last[index ^ 1]}`;
		assert.deepEqual(
			Buffer.from(respelt, "base64url"),
			Buffer.from(signature, "base64url"),
		);
		assert.deepEqual(verifyReferral(`${text}.${respelt}`, STUDIO, NOW), {
			valid: false,
			reason: "malformed",
		});
	});
});
