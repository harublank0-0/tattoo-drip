export type * from "@tattoo-drip/types";
export {
	type CreateBookingInput,
	createTattooClient,
	type TattooClient,
	type TattooClientOptions,
} from "./client.js";
export { isTattooApiError, TattooApiError } from "./errors.js";
