import { DateTime } from "luxon";
import User from "#models/user";

/** The platform admin: admin@platform.example is in .env.test's PLATFORM_ADMIN_EMAILS. */
export async function adminUser(): Promise<User> {
	return User.create({
		email: "admin@platform.example",
		password: "secret-password",
		emailVerifiedAt: DateTime.utc(),
	});
}
