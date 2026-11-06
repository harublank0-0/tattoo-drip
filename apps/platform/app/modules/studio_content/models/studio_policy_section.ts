import { StudioPolicySectionSchema } from "#database/schema";

/**
 * One titled section of the studio's policies, in place `position`
 * (0-based). Plain text. Read and replace through StudioContentService,
 * which writes the whole list at once and dates the policies.
 */
export default class StudioPolicySection extends StudioPolicySectionSchema {}
