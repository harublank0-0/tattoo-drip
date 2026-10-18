import { withAuthFinder } from "@adonisjs/auth/mixins/lucid";
import { compose } from "@adonisjs/core/helpers";
import hash from "@adonisjs/core/services/hash";
import { beforeCreate, beforeSave } from "@adonisjs/lucid/orm";
import { UserSchema } from "#database/schema";
import { canonicalEmail } from "#modules/identity/email_address";

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
	/**
	 * The database's defaults, in memory too (TAT-18): Lucid reads back only
	 * the id after an insert, and signing in needs the session version.
	 */
	@beforeCreate()
	static startUnconfirmed(user: User) {
		if (user.$attributes.sessionVersion === undefined) user.sessionVersion = 1;
		if (user.$attributes.emailVerifiedAt === undefined) {
			user.emailVerifiedAt = null;
		}
	}

	/**
	 * Every write stores the canonical address (TAT-18); the
	 * users_email_canonical check backs it up.
	 */
	@beforeSave()
	static canonicalizeEmail(user: User) {
		if (user.$dirty.email) user.email = canonicalEmail(user.email);
	}

	/** Whether the address is confirmed: by a link, a completed reset or account:verify. */
	get emailVerified() {
		return Boolean(this.emailVerifiedAt);
	}

	get initials() {
		const [first, last] = this.fullName
			? this.fullName.split(" ")
			: this.email.split("@");
		if (first && last) {
			return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
		}
		return `${first.slice(0, 2)}`.toUpperCase();
	}
}
