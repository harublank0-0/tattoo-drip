import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Email confirmation and server-side sign-out (TAT-18).
 * `email_verified_at`: when the address was confirmed (a link, a completed
 * password reset, or an operator's account:verify); null for every account
 * that exists today, since a backfill would prove nothing.
 * `session_version`: what each signed-in session must match; a password
 * reset raises it, which signs out every session, cookie-stored ones too.
 */
export default class extends BaseSchema {
	protected tableName = "users";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.timestamp("email_verified_at", { useTz: true }).nullable();
			table.integer("session_version").notNullable().defaultTo(1);
		});
		this.schema.raw(
			"alter table users add constraint users_session_version_positive check (session_version > 0)",
		);
	}

	async down() {
		this.schema.raw(
			"alter table users drop constraint users_session_version_positive",
		);
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("session_version");
			table.dropColumn("email_verified_at");
		});
	}
}
