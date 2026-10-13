import { compose } from "@adonisjs/core/helpers";
import { ClientSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

/**
 * A person who contacts a studio: one live client per normalized phone per
 * tenant. Services arrive with the intake and clients tickets (TAT-51,
 * TAT-41); until then read and change clients through this model only inside
 * a tenant context. `softDelete()` does not cascade to the client's inquiries
 * and projects yet (only `Tenant.softDelete` does); do not call it elsewhere
 * before TAT-42 defines client deletion.
 */
export default class Client extends compose(ClientSchema, withSoftDeletes) {}
