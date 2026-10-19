export type * from "@tattoo-drip/types";
export {
	type CreateBookingInput,
	createTattooClient,
	type RequestOptions,
	type TattooClient,
	type TattooClientOptions,
} from "./client.js";
export {
	isTattooApiError,
	TattooApiError,
	type TattooApiErrorOptions,
} from "./errors.js";
