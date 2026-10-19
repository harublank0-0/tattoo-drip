import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import { hashAccountToken } from "#modules/identity/account_tokens";
import AccountTokenService from "#modules/identity/services/account_token_service";
import { dbClient } from "#services/db_context";
import { altered, expireToken, flowOf, NO_FLOW } from "#tests/helpers/accounts";

const tokens = new AccountTokenService();

function makeUser(email = "ink@tokens-18.example") {
	return User.create({ email, password: "secret-password" });
}

async function rowsOf(userId: string) {
	const { rows } = await dbClient().rawQuery(
		"select purpose, token_hash, email, extract(epoch from expires_at - created_at)::int as seconds from account_tokens where user_id = ? order by purpose",
		[userId],
	);
	return rows as {
		purpose: string;
		token_hash: string;
		email: string;
		seconds: number;
	}[];
}

test.group("AccountTokenService (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("issues a token stored only as its digest, for the account's address, for a day or an hour", async ({
		assert,
	}) => {
		const user = await makeUser();

		const confirm = await tokens.issue(user, "verify_email");
		const reset = await tokens.issue(user, "reset_password");

		assert.deepEqual(await rowsOf(user.id), [
			{
				purpose: "reset_password",
				token_hash: hashAccountToken(reset),
				email: user.email,
				seconds: 60 * 60,
			},
			{
				purpose: "verify_email",
				token_hash: hashAccountToken(confirm),
				email: user.email,
				seconds: 24 * 60 * 60,
			},
		]);
	});

	test("a new token replaces the account's older one of that purpose, and leaves the other alone", async ({
		assert,
	}) => {
		const user = await makeUser();
		const first = await tokens.issue(user, "verify_email");
		const reset = await tokens.issue(user, "reset_password");
		const second = await tokens.issue(user, "verify_email");

		assert.deepEqual(await tokens.state(first, "verify_email"), {
			state: "unknown",
		});
		assert.deepEqual(await tokens.state(second, "verify_email"), {
			state: "live",
			userId: user.id,
			email: user.email,
			flow: await flowOf(second),
		});
		assert.equal((await tokens.state(reset, "reset_password")).state, "live");
		assert.lengthOf(await rowsOf(user.id), 2);
	});

	test("a token is used once: the second use finds nothing", async ({
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");
		const flow = await flowOf(token);

		assert.deepEqual(await tokens.consume(token, "reset_password", flow), {
			userId: user.id,
			email: user.email,
		});
		assert.isNull(await tokens.consume(token, "reset_password", flow));
		assert.deepEqual(await tokens.state(token, "reset_password"), {
			state: "unknown",
		});
	});

	test("an expired token reads as expired and can't be used", async ({
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");
		const flow = await flowOf(token);
		await expireToken(user.id, "verify_email");

		assert.deepEqual(await tokens.state(token, "verify_email"), {
			state: "expired",
		});
		assert.isNull(await tokens.consume(token, "verify_email", flow));
		assert.deepEqual(await tokens.state(token, "verify_email"), {
			state: "expired",
		});
	});

	test("a token works only for its own purpose, and an altered one finds nothing", async ({
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");
		const flow = await flowOf(token);

		assert.isNull(await tokens.consume(token, "reset_password", flow));
		assert.equal(
			(await tokens.state(token, "reset_password")).state,
			"unknown",
		);
		assert.equal(
			(await tokens.state(altered(token), "verify_email")).state,
			"unknown",
		);
		assert.isNull(await tokens.consume(altered(token), "verify_email", flow));
		assert.equal((await tokens.state(token, "verify_email")).state, "live");
	});

	test("a token is used only with the flow id of its own row", async ({
		assert,
	}) => {
		const user = await makeUser();
		const other = await makeUser("other@tokens-18.example");
		const token = await tokens.issue(user, "reset_password");
		const otherToken = await tokens.issue(other, "reset_password");

		for (const flow of [
			await flowOf(otherToken),
			NO_FLOW,
			"not-a-flow-id",
			"",
			"' or true --",
		]) {
			assert.isNull(await tokens.consume(token, "reset_password", flow), flow);
		}

		assert.equal((await tokens.state(token, "reset_password")).state, "live");
		assert.deepEqual(
			await tokens.consume(token, "reset_password", await flowOf(token)),
			{ userId: user.id, email: user.email },
		);
	});

	test("revoking removes the account's token of that purpose only", async ({
		assert,
	}) => {
		const user = await makeUser();
		const confirm = await tokens.issue(user, "verify_email");
		const reset = await tokens.issue(user, "reset_password");

		await tokens.revoke(user.id, "verify_email");

		assert.equal(
			(await tokens.state(confirm, "verify_email")).state,
			"unknown",
		);
		assert.equal((await tokens.state(reset, "reset_password")).state, "live");
	});
});
