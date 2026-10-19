import { TenantSlugSchema } from "#database/schema";

/**
 * A slug a tenant holds: its current one or an old one (TAT-24). The
 * tenants_register_slug trigger writes these rows and row-level security
 * lets the app neither change nor delete one, so never create, save or
 * delete this model. Read it through TenancyService.
 */
export default class TenantSlug extends TenantSlugSchema {}
