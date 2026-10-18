import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	isDnsName,
	STORED_SLUG,
	tenantFromHost,
} from "../../src/tenancy/host.ts";

const BASE = "tattoodrip.com";
const DEV = "localhost";
const long = (length: number) => "a".repeat(length);

describe("tenantFromHost", () => {
	const tenants: Array<[host: string, base: string, slug: string]> = [
		["blackneedle.tattoodrip.com", BASE, "blackneedle"],
		// Hosts are case-insensitive; the port and one trailing dot are ignored.
		["BlackNeedle.TattooDrip.COM", BASE, "blackneedle"],
		["blackneedle.tattoodrip.com:443", BASE, "blackneedle"],
		["blackneedle.tattoodrip.com.", BASE, "blackneedle"],
		["blackneedle.localhost:3000", DEV, "blackneedle"],
		["black-needle-2.tattoodrip.com", BASE, "black-needle-2"],
		// Grandfathered shapes, reserved words and punycode: the API decides.
		["12345.tattoodrip.com", BASE, "12345"],
		["a--b.tattoodrip.com", BASE, "a--b"],
		["admin.tattoodrip.com", BASE, "admin"],
		["xn--bcher-kva.tattoodrip.com", BASE, "xn--bcher-kva"],
		[`${long(63)}.tattoodrip.com`, BASE, long(63)],
	];
	for (const [host, base, slug] of tenants) {
		test(`${host} is the studio ${slug}`, () => {
			assert.deepEqual(tenantFromHost(host, base), { kind: "tenant", slug });
		});
	}

	const landings: Array<[host: string, base: string]> = [
		["tattoodrip.com", BASE],
		["TATTOODRIP.COM.", BASE],
		["tattoodrip.com:443", BASE],
		["www.tattoodrip.com", BASE],
		["WWW.TattooDrip.com", BASE],
		["localhost:3000", DEV],
		["www.localhost:3000", DEV],
	];
	for (const [host, base] of landings) {
		test(`${host} is the landing page`, () => {
			assert.deepEqual(tenantFromHost(host, base), { kind: "landing" });
		});
	}

	const nothing: Array<[host: string | null | undefined, base: string]> = [
		[null, BASE],
		[undefined, BASE],
		["", BASE],
		["ab.tattoodrip.com", BASE], // too short for a slug
		[`${long(64)}.tattoodrip.com`, BASE], // longer than a DNS label
		["-black.tattoodrip.com", BASE],
		["black-.tattoodrip.com", BASE],
		["black_needle.tattoodrip.com", BASE],
		["a.b.tattoodrip.com", BASE], // two labels under the base
		["www.blackneedle.tattoodrip.com", BASE],
		["blackneedle..tattoodrip.com", BASE],
		[".tattoodrip.com", BASE],
		["blackneedle.tattoodrip.com..", BASE],
		["127.0.0.1:3000", DEV],
		["10.0.0.1", BASE],
		["[::1]:3000", DEV],
		["blackneedle.tattoodrip.com:", BASE],
		["blackneedle.tattoodrip.com:http", BASE],
		["blackneedle.tattoodrip.com:123456", BASE],
		["user@blackneedle.tattoodrip.com", BASE],
		["blackneedle.tattoodrip.com/flash", BASE],
		[" blackneedle.tattoodrip.com", BASE],
		["bläckneedle.tattoodrip.com", BASE], // non-ASCII
		["\u212Aelvin.tattoodrip.com", BASE], // the Kelvin sign U+212A lowercases to "k"
		[`${long(300)}.tattoodrip.com`, BASE],
	];
	for (const [host, base] of nothing) {
		test(`${JSON.stringify(host)} is no studio`, () => {
			assert.deepEqual(tenantFromHost(host, base), { kind: "none" });
		});
	}

	const foreign: Array<[host: string, base: string, hostname: string]> = [
		["blackneedle.example.com", BASE, "blackneedle.example.com"],
		["Studio.Example.COM.", BASE, "studio.example.com"],
		["tattoodrip.com.evil.test", BASE, "tattoodrip.com.evil.test"],
		[
			"blackneedle.tattoodrip.com.evil.test",
			BASE,
			"blackneedle.tattoodrip.com.evil.test",
		],
		["eviltattoodrip.com", BASE, "eviltattoodrip.com"],
		["blackneedle.tattoodrip.com", DEV, "blackneedle.tattoodrip.com"],
	];
	for (const [host, base, hostname] of foreign) {
		test(`${host} is outside ${base}`, () => {
			assert.deepEqual(tenantFromHost(host, base), {
				kind: "foreign",
				hostname,
			});
		});
	}
});

describe("isDnsName", () => {
	test("accepts lowercase DNS names", () => {
		for (const name of ["tattoodrip.com", "localhost", "a-b.example.co"]) {
			assert.ok(isDnsName(name), name);
		}
	});

	test("refuses IPv4 addresses, empty or bad labels and long names", () => {
		for (const name of [
			"127.0.0.1",
			"a..b",
			".a",
			"-a.com",
			"a-.com",
			"a_b.com",
			"",
			`${long(64)}.com`,
			`${long(60)}.`.repeat(5).slice(0, -1),
		]) {
			assert.ok(!isDnsName(name), name);
		}
	});
});

describe("STORED_SLUG", () => {
	test("is the platform's stored shape, the database CHECK tenant_slugs_slug_format", () => {
		assert.equal(STORED_SLUG.source, "^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$");
		assert.equal(STORED_SLUG.flags, "");
	});

	test("accepts every stored slug, grandfathered ones too", () => {
		for (const slug of [
			"abc",
			"blackneedle",
			"12345",
			"a--b",
			"xn--abc",
			"www",
			long(63),
		]) {
			assert.ok(STORED_SLUG.test(slug), slug);
		}
	});

	test("refuses what no stored slug can be", () => {
		for (const value of [
			"",
			"ab",
			"-ab",
			"ab-",
			"Abc",
			"a_b",
			"a.b",
			"a b",
			long(64),
		]) {
			assert.ok(!STORED_SLUG.test(value), value);
		}
	});
});
