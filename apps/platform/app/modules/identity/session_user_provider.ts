import { SessionLucidUserProvider } from "@adonisjs/auth/session";
import type { SessionGuardUser } from "@adonisjs/auth/types/session";
import type User from "#models/user";
import {
	parseSessionIdentifier,
	sessionIdentifier,
} from "#modules/identity/session_identifier";

/**
 * The session guard's user provider, with the account's session version in
 * what the session stores (TAT-18): `<id>.<version>` instead of the id.
 * When a session's version isn't the account's current one, no user is
 * found, so every check (auth, guest, silent auth) treats the session as
 * signed out. It loads the user exactly as before: no extra query. The
 * model stays lazily imported, as config/auth.ts needs.
 */
export class SessionVersionUserProvider extends SessionLucidUserProvider<
	typeof User
> {
	override async createUserForGuard(
		user: User,
	): Promise<SessionGuardUser<User>> {
		const adapter = await super.createUserForGuard(user);
		return {
			getId: () => sessionIdentifier(user),
			getOriginal: () => adapter.getOriginal(),
		};
	}

	override async findById(
		identifier: unknown,
	): Promise<SessionGuardUser<User> | null> {
		const parsed = parseSessionIdentifier(identifier);
		if (!parsed) return null;
		const found = await super.findById(parsed.userId);
		if (!found || found.getOriginal().sessionVersion !== parsed.version) {
			return null;
		}
		return found;
	}
}
