import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import {
	canonicalizeEmails,
	EMAIL_CANONICAL_CHECK,
	refuseCaseDuplicates,
} from "#database/migrations/1791680000000_canonicalize_user_emails";
import User from "#models/user";
import { canonicalEmail } from "#modules/identity/email_address";
import { dbClient, withTransaction } from "#services/db_context";

const PASSWORD = "secret-password";

/** A users row written straight to the table, past the model's hooks. */
function insertUser(email: string) {
	return withTransaction((trx) =>
		trx.rawQuery(
			"insert into users (email, password, created_at) values (?, ?, now()) returning id, session_version, email_verified_at",
			[email, "not-a-hash"],
		),
	);
}

const PROBE = "td_probe_emails.users";

/**
 * Runs `fn` against a scratch users table on the owner connection. DDL is
 * transactional: the schema exists only until the rollback, and the real
 * users table is never touched.
 */
async function withProbe(
	emails: string[],
	fn: (probe: TransactionClientContract) => Promise<void>,
) {
	const probe = await db.connection("owner").transaction();
	try {
		await probe.rawQuery("create schema td_probe_emails");
		await probe.rawQuery(
			`create table ${PROBE} (id serial primary key, email varchar(254) not null unique)`,
		);
		for (const email of emails) {
			await probe.rawQuery(`insert into ${PROBE} (email) values (?)`, [email]);
		}
		await fn(probe);
	} finally {
		await probe.rollback();
	}
}

async function probeEmails(probe: TransactionClientContract) {
	const { rows } = await probe.rawQuery(
		`select email from ${PROBE} order by id`,
	);
	return (rows as { email: string }[]).map(({ email }) => email);
}

test.group("Users and account tokens tables (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an address is stored only in its canonical form", async ({
		assert,
	}) => {
		for (const email of ["INK@table-18.example", " ink@table-18.example"]) {
			await assert.rejects(() => insertUser(email), /users_email_canonical/);
		}
		await insertUser("ink@table-18.example");
	});

	test("the model stores the canonical address, so case never makes a second account", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "  Ink@Table-18.EXAMPLE ",
			password: PASSWORD,
		});

		assert.equal(user.email, "ink@table-18.example");
		assert.equal(
			(await User.findOrFail(user.id)).email,
			"ink@table-18.example",
		);
		await assert.rejects(
			() =>
				withTransaction(() =>
					User.create({ email: "INK@table-18.example", password: PASSWORD }),
				),
			/users_email_unique/,
		);
	});

	test("a new account starts unconfirmed at session version 1", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "new@table-18.example",
			password: PASSWORD,
		});
		assert.equal(user.sessionVersion, 1);
		assert.isNull(user.emailVerifiedAt);
		assert.isFalse(user.emailVerified);

		const stored = await User.findOrFail(user.id);
		assert.equal(stored.sessionVersion, 1);
		assert.isNull(stored.emailVerifiedAt);

		const { rows } = await insertUser("raw@table-18.example");
		assert.equal(rows[0].session_version, 1);
		assert.isNull(rows[0].email_verified_at);
	});

	test("the session version stays positive", async ({ assert }) => {
		const user = await User.create({
			email: "version@table-18.example",
			password: PASSWORD,
		});
		await assert.rejects(
			() =>
				withTransaction((trx) =>
					trx.rawQuery("update users set session_version = 0 where id = ?", [
						user.id,
					]),
				),
			/users_session_version_positive/,
		);
	});

	test("account tokens: one per account and purpose, each digest once, known purposes, gone with the account", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "tokens@table-18.example",
			password: PASSWORD,
		});
		const other = await User.create({
			email: "other@table-18.example",
			password: PASSWORD,
		});
		const row = (
			userId: string,
			purpose: string,
			digit: number,
			expires = "now() + interval '1 hour'",
		) =>
			withTransaction((trx) =>
				trx.rawQuery(
					`insert into account_tokens (user_id, purpose, token_hash, email, expires_at, created_at) values (?, ?, ?, ?, ${expires}, now())`,
					[
						userId,
						purpose,
						String(digit).repeat(64),
						"tokens@table-18.example",
					],
				),
			);

		await row(user.id, "verify_email", 1);
		await row(user.id, "reset_password", 2);
		await assert.rejects(
			() => row(user.id, "verify_email", 3),
			/account_tokens_user_id_purpose_unique/,
		);
		await assert.rejects(
			() => row(other.id, "verify_email", 1),
			/account_tokens_token_hash_unique/,
		);
		await assert.rejects(
			() => row(other.id, "sign_in", 4),
			/account_tokens_purpose_check/,
		);
		await assert.rejects(
			() => row(other.id, "verify_email", 5, "now()"),
			/account_tokens_expires_after_creation/,
		);

		await dbClient().rawQuery("delete from users where id = ?", [user.id]);
		const { rows } = await dbClient().rawQuery(
			"select count(*)::int as n from account_tokens where user_id = ?",
			[user.id],
		);
		assert.equal(rows[0].n, 0);
	});

	test("the cleanup refuses case-variant duplicates and changes nothing", async ({
		assert,
	}) => {
		const emails = [
			"ink@example.com",
			"INK@example.com",
			" Ink@Example.com",
			"other@example.com",
		];
		await withProbe(emails, async (probe) => {
			await assert.rejects(
				() =>
					probe.transaction((inner) =>
						inner.rawQuery(refuseCaseDuplicates(PROBE)),
					),
				/1 email address\(es\) belong to more than one account/,
			);
			assert.deepEqual(await probeEmails(probe), emails);
		});
	});

	test("the cleanup makes every other address canonical, exactly as canonicalEmail does", async ({
		assert,
	}) => {
		const emails = [
			"  Ink@Example.COM ",
			"ÉVA@Example.com",
			"plain@example.com",
			"a.b+tag@Gmail.com",
			// btrim() strips only U+0020: these stay as typed, in SQL and in JS.
			"\tInk@tab.example",
			" Ink@space.example",
			"\u3000Ink@wide.example",
			"\u00a0Ink@nbsp.example ",
		];
		await withProbe(emails, async (probe) => {
			await probe.rawQuery(refuseCaseDuplicates(PROBE));
			await probe.rawQuery(canonicalizeEmails(PROBE));

			assert.deepEqual(await probeEmails(probe), emails.map(canonicalEmail));
			await probe.rawQuery(
				`alter table ${PROBE} add constraint probe_canonical ${EMAIL_CANONICAL_CHECK}`,
			);
		});
	});
});
