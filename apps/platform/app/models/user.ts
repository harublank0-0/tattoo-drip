import { withAuthFinder } from "@adonisjs/auth/mixins/lucid";
import { compose } from "@adonisjs/core/helpers";
import hash from "@adonisjs/core/services/hash";
import { UserSchema } from "#database/schema";

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
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
