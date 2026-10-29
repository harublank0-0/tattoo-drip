/**
 * The password rule of every form that sets one (TAT-95): signup, a reset link
 * and the account page. 128 fits password managers' long passwords; scrypt
 * takes any length (it pre-hashes long input), so this is a policy bound only.
 * Sign-in has no length rule, so no stored password is ever refused. The
 * dashboard prints the range from a copy (`PASSWORD_HINT`), pinned by a test.
 */
export const PASSWORD_LENGTH = { min: 8, max: 128 } as const;

/** "8 to 128 characters", for messages. */
export const PASSWORD_RANGE = `${PASSWORD_LENGTH.min} to ${PASSWORD_LENGTH.max} characters`;
