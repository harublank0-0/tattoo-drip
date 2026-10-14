/**
 * Whether `error` is PostgreSQL's unique violation (23505) of the named
 * constraint or unique index. Recover from it after the savepoint that
 * raised it has rolled back (withTransaction does that).
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "23505" &&
		"constraint" in error &&
		error.constraint === constraint
	);
}

/**
 * Whether `error` is PostgreSQL's exclusion violation (23P01) of the named
 * exclusion constraint. Recover from it after the savepoint that raised it
 * has rolled back (withTransaction does that).
 */
export function isExclusionViolation(
	error: unknown,
	constraint: string,
): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "23P01" &&
		"constraint" in error &&
		error.constraint === constraint
	);
}
