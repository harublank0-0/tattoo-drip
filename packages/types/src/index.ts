import type { components, operations, paths } from "./openapi.gen.js";

export type { components, operations, paths };

type Schemas = components["schemas"];

export type ApiError = Schemas["ErrorResponse"]["error"];
export type TattooStyle = Schemas["TattooStyle"];
export type BodyPlacement = Schemas["BodyPlacement"];
export type Image = Schemas["Image"];
export type Logo = Schemas["Logo"];
export type Photo = Schemas["Photo"];
export type ImageVariant = Schemas["ImageVariant"];
export type Money = Schemas["Money"];
export type SocialLink = Schemas["SocialLink"];
export type StorefrontSection = Schemas["StorefrontSection"];
export type StorefrontConfiguration = Schemas["StorefrontConfiguration"];
export type Studio = Schemas["Studio"];
export type OpeningHours = Schemas["OpeningHours"];
export type ClosedDays = Schemas["ClosedDays"];
export type GoodToKnow = Schemas["GoodToKnow"];
export type Artist = Schemas["Artist"];
export type Service = Schemas["Service"];
export type GalleryPhoto = Schemas["GalleryPhoto"];
export type PhotoAngle = Schemas["PhotoAngle"];
export type VideoAngle = Schemas["VideoAngle"];
export type VideoSource = Schemas["VideoSource"];
export type WorkFilters = Schemas["WorkFilters"];
export type FlashDesign = Schemas["FlashDesign"];
export type Price = Schemas["Price"];
export type FlashFilters = Schemas["FlashFilters"];
export type Slot = Schemas["Slot"];
export type SourceChannel = Schemas["SourceChannel"];
export type InquiryInput = Schemas["InquiryInput"];
export type InquiryReceipt = Schemas["InquiryReceipt"];
export type DepositState = Schemas["DepositState"];
export type DepositPaymentMethod = Schemas["DepositPaymentMethod"];
export type DepositPage = Schemas["DepositPage"];
export type DepositSession = Schemas["DepositSession"];
export type DepositProofForm = Schemas["DepositProofForm"];

export type ListServicesQuery = NonNullable<
	operations["listServices"]["parameters"]["query"]
>;
export type ListWorkQuery = NonNullable<
	operations["listWork"]["parameters"]["query"]
>;
export type ListFlashQuery = NonNullable<
	operations["listFlash"]["parameters"]["query"]
>;
export type ListAvailabilityQuery =
	operations["listAvailability"]["parameters"]["query"];
export type WorkPage =
	operations["listWork"]["responses"][200]["content"]["application/json"];
export type FlashPage =
	operations["listFlash"]["responses"][200]["content"]["application/json"];

// Discover (D03): cross-studio public reads, under no studio.
export type DiscoverLocation = Schemas["DiscoverLocation"];
export type DiscoverStudioRef = Schemas["DiscoverStudioRef"];
export type DiscoverStudioSummary = Schemas["DiscoverStudioSummary"];
export type DiscoverStudioDetail = Schemas["DiscoverStudioDetail"];
export type DiscoverArtistSummary = Schemas["DiscoverArtistSummary"];
export type DiscoverArtistDetail = Schemas["DiscoverArtistDetail"];
export type DiscoverTattooSummary = Schemas["DiscoverTattooSummary"];
export type DiscoverTattooDetail = Schemas["DiscoverTattooDetail"];
export type DiscoverStyle = Schemas["TattooStyle"];
/** `sort` of the studio and artist lists. */
export type DiscoverSort = NonNullable<
	operations["listDiscoverStudios"]["parameters"]["query"]
>["sort"];
/** A page of a Discover list: its items and the cursor of the next page. */
export type DiscoverListResponse<T> = { data: T[]; nextCursor: string | null };
export type DiscoverStudiosQuery = NonNullable<
	operations["listDiscoverStudios"]["parameters"]["query"]
>;
export type DiscoverArtistsQuery = NonNullable<
	operations["listDiscoverArtists"]["parameters"]["query"]
>;
export type DiscoverTattoosQuery = NonNullable<
	operations["listDiscoverTattoos"]["parameters"]["query"]
>;
export type DiscoverStudiosPage =
	operations["listDiscoverStudios"]["responses"][200]["content"]["application/json"];
export type DiscoverArtistsPage =
	operations["listDiscoverArtists"]["responses"][200]["content"]["application/json"];
export type DiscoverTattoosPage =
	operations["listDiscoverTattoos"]["responses"][200]["content"]["application/json"];
// Discover D10: the sitemap lists (canonical identifiers only, keyset-paged).
export type DiscoverSitemapStudio = Schemas["DiscoverSitemapStudio"];
export type DiscoverSitemapArtist = Schemas["DiscoverSitemapArtist"];
export type DiscoverSitemapTattoo = Schemas["DiscoverSitemapTattoo"];
export type DiscoverSitemapQuery = NonNullable<
	operations["listDiscoverSitemapTattoos"]["parameters"]["query"]
>;
export type DiscoverSitemapPage<T> = { data: T[]; nextCursor: string | null };
