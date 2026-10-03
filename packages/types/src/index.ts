import type { components, operations, paths } from "./openapi.gen.js";

export type { components, operations, paths };

type Schemas = components["schemas"];

export type ApiError = Schemas["ErrorResponse"]["error"];
export type TattooStyle = Schemas["TattooStyle"];
export type BodyPlacement = Schemas["BodyPlacement"];
export type Image = Schemas["Image"];
export type Money = Schemas["Money"];
export type SocialLink = Schemas["SocialLink"];
export type StorefrontSection = Schemas["StorefrontSection"];
export type StorefrontConfiguration = Schemas["StorefrontConfiguration"];
export type Studio = Schemas["Studio"];
export type Artist = Schemas["Artist"];
export type Service = Schemas["Service"];
export type PortfolioProject = Schemas["PortfolioProject"];
export type Slot = Schemas["Slot"];
export type BookingRequestInput = Schemas["BookingRequestInput"];
export type BookingReceipt = Schemas["BookingReceipt"];

export type ListServicesQuery = NonNullable<
	operations["listServices"]["parameters"]["query"]
>;
export type ListPortfolioQuery = NonNullable<
	operations["listPortfolio"]["parameters"]["query"]
>;
export type ListAvailabilityQuery =
	operations["listAvailability"]["parameters"]["query"];
export type PortfolioPage =
	operations["listPortfolio"]["responses"][200]["content"]["application/json"];
