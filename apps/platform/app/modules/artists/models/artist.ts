import { compose } from "@adonisjs/core/helpers";
import { ArtistSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

/**
 * A public profile of one artist in one tenant. Read and change artists
 * through ArtistService, not from other modules directly.
 */
export default class Artist extends compose(ArtistSchema, withSoftDeletes) {}
