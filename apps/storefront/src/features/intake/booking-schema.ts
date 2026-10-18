import { z } from "zod";

/**
 * The prototype booking form's schema, kept with the form for TAT-57, which
 * rebuilds it as the intake form (`useCreateInquiry`). Not mounted anywhere.
 */

export interface BookingFormData {
	name: string;
	email: string;
	tattooIdea: string;
	style?: string;
	placement?: string;
	size?: string;
	preferredDates?: string;
	budget?: string;
	referenceLinks?: string;
	website?: string;
	source?: "general" | "flash";
	flashPieceId?: string;
	flashPieceTitle?: string;
	flashPiecePrice?: number;
}

export const bookingSchema = z.object({
	name: z.string().min(2, "Name must be at least 2 characters"),
	email: z.string().email("Valid email required"),
	tattooIdea: z
		.string()
		.min(20, "Please describe your idea in at least 20 characters"),
	style: z.string().optional(),
	placement: z.string().optional(),
	size: z.string().optional(),
	preferredDates: z.string().optional(),
	budget: z.string().optional(),
	referenceLinks: z.string().optional(),
	website: z.string().optional(),
	source: z.enum(["general", "flash"]).optional(),
	flashPieceId: z.string().optional(),
	flashPieceTitle: z.string().optional(),
	flashPiecePrice: z.number().optional(),
});

export type BookingSchema = z.infer<typeof bookingSchema>;

export const styleOptions = [
	{ value: "", label: "Select a style (optional)" },
	{ value: "Blackwork", label: "Blackwork" },
	{ value: "Fine Line", label: "Fine Line" },
	{ value: "Ornamental", label: "Ornamental" },
	{ value: "Custom", label: "Custom" },
	{ value: "Japanese", label: "Japanese" },
	{ value: "Flash", label: "Flash (pre-designed)" },
] as const;
