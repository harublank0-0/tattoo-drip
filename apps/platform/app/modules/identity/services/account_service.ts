import { inject } from "@adonisjs/core";
import { DateTime } from "luxon";
import User from "#models/user";
import {
	accountUrl,
	linkPath,
	type TokenPurpose,
} from "#modules/identity/account_tokens";
import { canonicalEmail } from "#modules/identity/email_address";
import AccountExistsMail from "#modules/identity/emails/account_exists_mail";
import PasswordChangedMail, {
	changedAtText,
} from "#modules/identity/emails/password_changed_mail";
import ResetPasswordMail from "#modules/identity/emails/reset_password_mail";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";
import { SessionEndedError } from "#modules/identity/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AccountTokenService, {
	type TokenState,
} from "#modules/identity/services/account_token_service";
import { clearLoginFailures } from "#modules/identity/services/auth_limits";
import { afterCommit, withTransaction } from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";
import { sendMailInTransaction } from "#services/mail_in_transaction";
import env from "#start/env";

export type SignupInput = {
	fullName: string | null;
	email: string;
	password: string;
};

/** A link on this platform, for an email. */
function appLink(path: string) {
	return accountUrl(env.get("APP_URL"), path);
}

/**
 * Accounts (TAT-18): signup, email confirmation and password reset. Each
 * method runs in one transaction (a savepoint inside a request's) and
 * queues its email with sendMailInTransaction, so an email exists only if
 * its writes committed. Tokens come from AccountTokenService.
 *
 * Lock order, the same in every method that takes more than one lock, so
 * two of them can't wait on each other (a deadlock aborts one valid
 * request): the reset token's row, then the confirmation token's row, then
 * the user's row. `resetPassword` (reset row, verify row, user),
 * `confirmEmail` (verify row, user) and `markVerified` (verify row, user)
 * all follow it, and so do the account page's writes (TAT-95):
 * `changePassword` (reset row via revoke, then the user) and
 * `signOutOtherSessions` (the user only). A new method that touches two of
 * them keeps this order.
 */
@inject()
export default class AccountService {
	constructor(private tokens: AccountTokenService) {}

	/**
	 * Signs a person up without telling whether the address already has an
	 * account (spec ruling 6). A new address gets an unconfirmed account and
	 * a confirmation link; a taken one gets "you already have an account"
	 * with a reset link, and its account doesn't change. Either way the
	 * model hashes the password once, one token is written and one email is
	 * queued. Nobody is signed in.
	 */
	async signUp(input: SignupInput): Promise<void> {
		const email = canonicalEmail(input.email);
		await withTransaction(async (trx) => {
			const created = await this.createAccount({
				fullName: input.fullName,
				email,
				password: input.password,
			});
			if (created) {
				const token = await this.tokens.issue(created, "verify_email");
				await sendMailInTransaction(
					new VerifyEmailMail({
						to: created.email,
						url: this.linkFor("verify_email", token),
					}),
					trx,
				);
				return;
			}
			const existing = await User.findByOrFail("email", email);
			const token = await this.tokens.issue(existing, "reset_password");
			await sendMailInTransaction(
				new AccountExistsMail({
					to: existing.email,
					signInUrl: appLink("/login"),
					resetUrl: this.linkFor("reset_password", token),
				}),
				trx,
			);
		});
	}

	/**
	 * The new account, or null when the address is taken. The insert runs in
	 * a savepoint, after the model hashed the password.
	 */
	private async createAccount(input: SignupInput): Promise<User | null> {
		try {
			return await withTransaction(() => User.create(input));
		} catch (error) {
			if (isUniqueViolation(error, "users_email_unique")) return null;
			throw error;
		}
	}

	/**
	 * A new confirmation link for an account whose address isn't confirmed
	 * (spec ruling 15). The older link stops working.
	 */
	async sendVerification(user: User): Promise<void> {
		await withTransaction(async (trx) => {
			const token = await this.tokens.issue(user, "verify_email");
			await sendMailInTransaction(
				new VerifyEmailMail({
					to: user.email,
					url: this.linkFor("verify_email", token),
				}),
				trx,
			);
		});
	}

	/** What a link's page shows: live (with its address), expired or unknown. */
	tokenState(token: string, purpose: TokenPurpose): Promise<TokenState> {
		return this.tokens.state(token, purpose);
	}

	/**
	 * Confirms the address a live confirmation link was sent to, once
	 * (spec ruling 16). Whoever is signed in doesn't matter: the link proves
	 * the mailbox, and it signs nobody in. `flow` is the id of the link the
	 * page showed. Null for a dead link, a flow that isn't that link's, or a
	 * link sent to an address the account no longer has. Lock order: the
	 * confirmation token's row (consume), then the user (see the class).
	 */
	async confirmEmail(token: string, flow: string): Promise<User | null> {
		return withTransaction(async () => {
			const claim = await this.tokens.consume(token, "verify_email", flow);
			if (!claim) return null;
			const user = await User.query()
				.where("id", claim.userId)
				.forUpdate()
				.first();
			if (!user || user.email !== claim.email) return null;
			if (!user.emailVerifiedAt) {
				user.emailVerifiedAt = DateTime.now();
				await user.save();
			}
			return user;
		});
	}

	/**
	 * Confirms an account's address without a link (spec ruling 20): the
	 * operator's account:verify, once they checked the person some other
	 * way. Revokes the account's confirmation link. Lock order: the
	 * confirmation token's row (revoke), then the user (see the class), so
	 * the account is found without a lock, its link revoked, and only then
	 * locked.
	 */
	async markVerified(
		email: string,
	): Promise<"unknown" | "already" | "confirmed"> {
		return withTransaction(async () => {
			const found = await User.findBy("email", canonicalEmail(email));
			if (!found) return "unknown";
			await this.tokens.revoke(found.id, "verify_email");
			const user = await User.query().where("id", found.id).forUpdate().first();
			if (!user) return "unknown";
			if (user.emailVerifiedAt) return "already";
			user.emailVerifiedAt = DateTime.now();
			await user.save();
			return "confirmed";
		});
	}

	/**
	 * Emails a reset link when an account uses this address, and does
	 * nothing otherwise (spec ruling 11). The caller answers the same either
	 * way.
	 */
	async requestPasswordReset(email: string): Promise<void> {
		await withTransaction(async (trx) => {
			const user = await User.findBy("email", canonicalEmail(email));
			if (!user) return;
			const token = await this.tokens.issue(user, "reset_password");
			await sendMailInTransaction(
				new ResetPasswordMail({
					to: user.email,
					url: this.linkFor("reset_password", token),
				}),
				trx,
			);
		});
	}

	/**
	 * Sets a new password with a live reset link, once (spec ruling 13).
	 * Raises the session version (every session signs out), confirms the
	 * address if it wasn't (the link proved the mailbox), emails the
	 * account's address that its password changed, and once committed
	 * clears the login failures of that stored address. Signs nobody in.
	 * `flow` is the id of the link the page showed. Null for a dead link, a
	 * flow that isn't that link's, or a link sent to an address the account
	 * no longer has. Lock order: the reset token's row (consume), the
	 * confirmation token's row (revoke), then the user (see the class).
	 */
	async resetPassword(
		token: string,
		password: string,
		flow: string,
	): Promise<User | null> {
		return withTransaction(async (trx) => {
			const claim = await this.tokens.consume(token, "reset_password", flow);
			if (!claim) return null;
			// Any confirmation link dies with the reset (the link proved the
			// mailbox), revoked before the user is locked: see the class.
			await this.tokens.revoke(claim.userId, "verify_email");
			const user = await User.query()
				.where("id", claim.userId)
				.forUpdate()
				.first();
			if (!user || user.email !== claim.email) return null;
			user.password = password;
			user.sessionVersion += 1;
			if (!user.emailVerifiedAt) user.emailVerifiedAt = DateTime.now();
			await user.save();
			await sendMailInTransaction(
				new PasswordChangedMail({
					to: user.email,
					changedAt: changedAtText(DateTime.now()),
					resetUrl: appLink("/forgot-password"),
					signedOut: "everywhere",
				}),
				trx,
			);
			const storedEmail = user.email;
			afterCommit(() => clearLoginFailures(storedEmail));
			return user;
		});
	}

	/**
	 * Changes the password of a signed-in account (TAT-95): the caller has
	 * checked the current password (throttlePasswordCheck). Ends a pending
	 * reset link, then, under the user's lock, sets the password and raises the
	 * session version in one UPDATE (every other session is signed out on its
	 * next request), emails the stored address and, once committed, clears its
	 * login failures. Returns the account with its new version, for the
	 * caller to sign the asking session in again. Lock order: the reset
	 * token's row (revoke), then the user (see the class).
	 */
	async changePassword(user: User, password: string): Promise<User> {
		return withTransaction(async (trx) => {
			await this.tokens.revoke(user.id, "reset_password");
			const locked = await this.lockSession(user);
			locked.password = password;
			locked.sessionVersion += 1;
			await locked.save();
			await sendMailInTransaction(
				new PasswordChangedMail({
					to: locked.email,
					changedAt: changedAtText(DateTime.now()),
					resetUrl: appLink("/forgot-password"),
					signedOut: "elsewhere",
				}),
				trx,
			);
			const storedEmail = locked.email;
			afterCommit(() => clearLoginFailures(storedEmail));
			return locked;
		});
	}

	/**
	 * "Sign out of other devices" (TAT-95): raises the session version under the
	 * user's lock, so every other session is signed out on its next request.
	 * Returns the account with its new version, for the caller to sign the
	 * asking session in again.
	 */
	async signOutOtherSessions(user: User): Promise<User> {
		return withTransaction(async () => {
			const locked = await this.lockSession(user);
			locked.sessionVersion += 1;
			await locked.save();
			return locked;
		});
	}

	/**
	 * Locks the account of the session that asked and checks that the session
	 * still holds its current version (`user` is the instance auth loaded, so
	 * its version is the session's). Another request may have raised it since
	 * (a reset, a change or a sign-out elsewhere): then this session is over
	 * and SessionEndedError rolls the caller's work back. Every write of
	 * `users.password` raises `session_version` in the same UPDATE, so an
	 * unchanged version also means the hash the caller checked is the stored
	 * one: keep that true in any new path that sets a password.
	 */
	private async lockSession(user: User): Promise<User> {
		const locked = await User.query().where("id", user.id).forUpdate().first();
		if (!locked || locked.sessionVersion !== user.sessionVersion) {
			throw new SessionEndedError();
		}
		return locked;
	}

	private linkFor(purpose: TokenPurpose, token: string) {
		return appLink(linkPath(purpose, token));
	}
}
