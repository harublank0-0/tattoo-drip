import { test } from "@japa/runner";
import {
	decodeDiscoverCursor,
	encodeDiscoverCursor,
	MAX_CURSOR_LENGTH,
} from "#modules/discovery/cursor";

const ID = "0b6f8e2c-6a4a-4f1e-9a51-1b0c2d3e4f50";
const raw = (value: unknown) =>
	Buffer.from(JSON.stringify(value)).toString("base64url");

test.group("Discover cursors", () => {
	test("round-trip for each sort", ({ assert }) => {
		for (const cursor of [
			{ sort: "name" as const, value: "black needle", id: ID },
			{ sort: "-name" as const, value: "लोटस इङ्क", id: ID },
			{ sort: "newest" as const, value: "2026-10-01T10:00:00.123456Z", id: ID },
		]) {
			assert.deepEqual(
				decodeDiscoverCursor(encodeDiscoverCursor(cursor), cursor.sort),
				cursor,
			);
		}
	});

	test("a cursor of another sort is not one", ({ assert }) => {
		const name = encodeDiscoverCursor({ sort: "name", value: "a", id: ID });
		assert.isNull(decodeDiscoverCursor(name, "-name"));
		assert.isNull(decodeDiscoverCursor(name, "newest"));
	});

	test("refuses anything that is not a canonical cursor", ({ assert }) => {
		const good = encodeDiscoverCursor({ sort: "name", value: "a", id: ID });
		for (const bad of [
			"",
			"not base64!",
			`${good}=`,
			`${good}A`,
			raw({ sort: "name", value: "a", id: ID }),
			raw(["name", "a"]),
			raw(["name", "a", ID, "extra"]),
			raw(["name", 7, ID]),
			raw(["name", "a", ID.toUpperCase()]),
			raw(["name", "a", "x' or '1'='1"]),
			raw(["sideways", "a", ID]),
			raw(["name", "a\u0000b", ID]),
			raw(["name", "a\nb", ID]),
			raw(["name", "a".repeat(161), ID]),
			Buffer.from(`["name", "a", "${ID}"]`).toString("base64url"),
			"A".repeat(MAX_CURSOR_LENGTH + 1),
		]) {
			assert.isNull(decodeDiscoverCursor(bad, "name"), bad);
		}
	});

	test("newest needs a real UTC instant with microseconds", ({ assert }) => {
		for (const value of [
			"2026-02-30T00:00:00.000000Z",
			"2026-13-01T00:00:00.000000Z",
			"2026-10-01T24:00:00.000000Z",
			"2026-10-01T10:00:60.000000Z",
			"0000-01-01T00:00:00.000000Z",
			"2026-10-01T10:00:00.000Z",
			"2026-10-01T10:00:00.000000+05:45",
			"2026-10-01 10:00:00.000000Z",
			"yesterday",
		]) {
			assert.isNull(
				decodeDiscoverCursor(raw(["newest", value, ID]), "newest"),
				value,
			);
		}
		assert.isNotNull(
			decodeDiscoverCursor(
				raw(["newest", "2028-02-29T23:59:59.999999Z", ID]),
				"newest",
			),
		);
	});
});
