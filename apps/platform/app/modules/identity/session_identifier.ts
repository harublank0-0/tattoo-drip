/**
 * What a signed-in session keeps (TAT-18): the user's id and the account's
 * session version, as `<id>.<version>`. A password reset raises the
 * version, so every session that still holds the old one finds no user on
 * its next request, whatever the session store (production keeps sessions
 * in cookies). SessionVersionUserProvider writes and checks it.
 */
const IDENTIFIER =
	/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([1-9][0-9]{0,8})$/;

export function sessionIdentifier(user: {
	id: string;
	sessionVersion: number;
}): string {
	if (!Number.isInteger(user.sessionVersion) || user.sessionVersion < 1) {
		throw new Error(
			"Sign in a user loaded from the database: its session version is missing",
		);
	}
	return `${user.id}.${user.sessionVersion}`;
}

/**
 * The id and version a session holds, or null for anything else. A session
 * from before TAT-18 holds the bare id, so it signs out once.
 */
export function parseSessionIdentifier(
	value: unknown,
): { userId: string; version: number } | null {
	if (typeof value !== "string") return null;
	const match = IDENTIFIER.exec(value);
	if (!match) return null;
	return { userId: match[1], version: Number(match[2]) };
}
