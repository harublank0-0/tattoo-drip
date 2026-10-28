/**
 * The session that asked was ended by another request after it signed in
 * (TAT-95): a reset, a password change or "Sign out of other devices" on
 * another device raised the account's session version meanwhile.
 */
export class SessionEndedError extends Error {
	constructor() {
		super("This session was signed out by another request");
	}
}
