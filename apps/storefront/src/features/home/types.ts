import { z } from "zod";

export type AvailabilityStatus = "available" | "limited" | "packed" | "closed";

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

export const availabilityStyles: Record<AvailabilityStatus, string> = {
	available: "bg-accent/10 text-accent border-accent/30",
	limited: "bg-amber-500/10 text-amber-400 border-amber-500/30",
	packed: "bg-orange-500/10 text-orange-400 border-orange-500/30",
	closed: "bg-muted text-muted-foreground border-border",
};

export const availabilityLabels = {
	available: "Currently accepting bookings",
	limited: (details: string) => `Limited availability — ${details}`,
	packed: (details: string) => `Fully booked — ${details}`,
	closed: (details: string) => `Reopening — ${details}`,
};

export const styleOptions = [
	{ value: "", label: "Select a style (optional)" },
	{ value: "Blackwork", label: "Blackwork" },
	{ value: "Fine Line", label: "Fine Line" },
	{ value: "Ornamental", label: "Ornamental" },
	{ value: "Custom", label: "Custom" },
	{ value: "Japanese", label: "Japanese" },
	{ value: "Flash", label: "Flash (pre-designed)" },
] as const;
