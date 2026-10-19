import { BaseSchema } from "@adonisjs/lucid/schema";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";

/**
 * An address in its canonical form (TAT-18): no surrounding spaces, the
 * ASCII letters in lower case. translate() maps exactly those letters, so
 * the rule doesn't depend on the database's locale (lower() does) and is
 * the same as canonicalEmail() in #modules/identity/email_address (copied,
 * not imported: a migration never imports app code).
 */
export const canonicalEmailSql = (column: string) =>
	`translate(btrim(${column}), '${UPPER}', '${LOWER}')`;

/**
 * Run first by up(): two accounts whose addresses differ only in case or
 * surrounding spaces would end up with one address. The migration never
 * merges, renames or deletes an account: it stops, with everything rolled
 * back, and an operator decides (database/README.md, "Canonical emails").
 */
export function refuseCaseDuplicates(table: string) {
	return `
do $$
declare
	clashes integer;
begin
	select count(*) into clashes from (
		select 1 from ${table} group by ${canonicalEmailSql("email")} having count(*) > 1
	) as clashing;
	if clashes > 0 then
		raise exception '${table}: % email address(es) belong to more than one account once upper and lower case and surrounding spaces are ignored. Decide which account keeps each address and change the others by hand (apps/platform/database/README.md, Canonical emails), then migrate again', clashes;
	end if;
end
$$`;
}

/** Rewrites every address that isn't canonical yet. */
export function canonicalizeEmails(table: string) {
	return `update ${table} set email = ${canonicalEmailSql("email")} where email <> ${canonicalEmailSql("email")}`;
}

/** The check that keeps every address canonical, whatever writes it. */
export const EMAIL_CANONICAL_CHECK = `check (email = ${canonicalEmailSql("email")})`;

/**
 * Canonical emails (TAT-18, carry-forward (c) of TAT-8): with the existing
 * users_email_unique, one account per address whatever its case. down()
 * drops the check and leaves the addresses canonical: the old schema
 * accepts them, and their former case carried nothing anything reads.
 */
export default class extends BaseSchema {
	protected tableName = "users";

	async up() {
		this.schema.raw(refuseCaseDuplicates(this.tableName));
		this.schema.raw(canonicalizeEmails(this.tableName));
		this.schema.raw(
			`alter table users add constraint users_email_canonical ${EMAIL_CANONICAL_CHECK}`,
		);
	}

	async down() {
		this.schema.raw("alter table users drop constraint users_email_canonical");
	}
}
