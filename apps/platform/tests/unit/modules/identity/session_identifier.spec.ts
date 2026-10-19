import { test } from "@japa/runner";
import {
	parseSessionIdentifier,
	sessionIdentifier,
} from "#modules/identity/session_identifier";

const ID = "0199f0e2-7a4b-7c3d-8e9f-0123456789ab";

test.group("Session identifier", () => {
	test("is the user's id and the account's session version", ({ assert }) => {
		assert.equal(sessionIdentifier({ id: ID, sessionVersion: 1 }), `${ID}.1`);
		assert.deepEqual(parseSessionIdentifier(`${ID}.12`), {
			userId: ID,
			version: 12,
		});
	});

	test("a bare id, a version of 0 or anything else is no identifier", ({
		assert,
	}) => {
		for (const value of [
			ID,
			`${ID}.0`,
			`${ID}.01`,
			`${ID}.-1`,
			`${ID}.1.2`,
			`${ID.toUpperCase()}.1`,
			`${ID}.1 `,
			"",
			7,
			null,
			undefined,
		]) {
			assert.isNull(parseSessionIdentifier(value), String(value));
		}
	});

	test("refuses to write a session for a user without a version", ({
		assert,
	}) => {
		assert.throws(
			() =>
				sessionIdentifier({
					id: ID,
					sessionVersion: undefined as unknown as number,
				}),
			/session version is missing/,
		);
		assert.throws(
			() => sessionIdentifier({ id: ID, sessionVersion: 0 }),
			/session version is missing/,
		);
	});
});
