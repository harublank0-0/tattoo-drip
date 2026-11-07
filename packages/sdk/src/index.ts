export type * from "@tattoo-drip/types";
export {
	type CreateInquiryInput,
	createTattooClient,
	INQUIRY_CHALLENGE_ACTION,
	INQUIRY_HONEYPOT_FIELD,
	type RequestOptions,
	type SubmitDepositProofInput,
	type TattooClient,
	type TattooClientOptions,
} from "./client.js";
export {
	createDiscoverClient,
	type DiscoverArtistsListQuery,
	type DiscoverClient,
	type DiscoverClientOptions,
	type DiscoverStudiosListQuery,
	type DiscoverTattoosListQuery,
} from "./discover.js";
export {
	isTattooApiError,
	TattooApiError,
	type TattooApiErrorOptions,
} from "./errors.js";
