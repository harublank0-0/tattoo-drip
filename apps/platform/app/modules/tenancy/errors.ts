/**
 * Another tenant got this slug first, usually by racing past validation.
 * Show it as a field error on `slug`.
 */
export class SlugTakenError extends Error {
	constructor(readonly slug: string) {
		super(`The slug "${slug}" is already taken`);
		this.name = "SlugTakenError";
	}
}

/**
 * Removing or demoting this membership would leave the tenant without an
 * owner. Every tenant must keep at least one.
 */
export class LastOwnerError extends Error {
	constructor(readonly tenantId: string) {
		super("A tenant must keep at least one owner");
		this.name = "LastOwnerError";
	}
}

/**
 * The tenant already holds MAX_TENANT_SLUGS slugs and asked for a new one.
 * Switching back to one of its own old slugs is still allowed. Show it as
 * a field error on `slug`.
 */
export class SlugLimitError extends Error {
	constructor(readonly tenantId: string) {
		super(`Tenant ${tenantId} holds the most slugs allowed`);
		this.name = "SlugLimitError";
	}
}
