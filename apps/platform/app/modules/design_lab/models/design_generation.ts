import { DesignGenerationSchema } from "#database/schema";
import type { GenerationInputs } from "#modules/design_lab/prompt";
import type {
	FailureCode,
	GenerationStatus,
	ProviderMeta,
} from "#modules/design_lab/rules";

/**
 * One provider request for one concept image. `pollingUrlSealed` is server
 * only: never serialise this model to a page or a log.
 */
export default class DesignGeneration extends DesignGenerationSchema {
	declare inputs: GenerationInputs;
	declare status: GenerationStatus;
	declare failureCode: FailureCode | null;
	declare providerMeta: ProviderMeta | null;
}
