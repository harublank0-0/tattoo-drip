import { test } from "@japa/runner";
import {
	decodeWorkCursor,
	encodeWorkCursor,
	type WorkCursor,
} from "#modules/artists/work_cursor";

const AT = "2026-10-30T04:05:06.123456Z";
const ID = "0199f000-0000-7000-8000-000000000001";
const text = (value: string) => Buffer.from(value).toString("base64url");

test.group("the work photos cursor (TAT-126)", () => {
	test("a cursor goes there and back", ({ assert }) => {
		const cursor: WorkCursor = { at: AT, id: ID };

		const encoded = encodeWorkCursor(cursor);

		assert.match(encoded, /^[A-Za-z0-9_-]+$/);
		assert.deepEqual(decodeWorkCursor(encoded), cursor);
	});

	test("anything else is null", ({ assert }) => {
		const bad = [
			"",
			"abc",
			text("x~y"),
			text(`2026-10-30T04:05:06.123Z~${ID}`),
			text(`${AT}~not-a-uuid`),
			text(`${AT}~${ID.toUpperCase()}`),
			text(`${AT}~${ID}~more`),
			text(`${AT}${ID}`),
			// Shaped right, but not a time Postgres accepts.
			text(`2026-13-45T04:05:06.123456Z~${ID}`),
			text(`2026-02-30T04:05:06.123456Z~${ID}`),
			text(`0000-01-01T00:00:00.000000Z~${ID}`),
			// Not canonical base64url: padding, other alphabets, trailing bits.
			`${encodeWorkCursor({ at: AT, id: ID })}=`,
			Buffer.from(`${AT}~${ID}`).toString("base64"),
			"a".repeat(201),
		];
		for (const value of bad) {
			assert.isNull(decodeWorkCursor(value), JSON.stringify(value));
		}
	});
});
