import { ArrowUpRight, X } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { BookingForm } from "./booking-form";

export function BookingDialog({
	variant = "default",
	size = "lg",
	initialData,
}: Pick<ComponentProps<typeof Button>, "variant" | "size"> & {
	initialData?: Partial<{
		source: "general" | "flash";
		flashPieceId: string;
		flashPieceTitle: string;
		flashPiecePrice: number;
	}>;
}) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant={variant} size={size}>
					Start a booking
					<ArrowUpRight data-icon="inline-end" aria-hidden="true" />
				</Button>
			</DialogTrigger>
			<DialogContent
				className="sm:max-w-[480px] max-h-[90vh]"
				showCloseButton={false}
			>
				<DialogHeader>
					<DialogTitle>Start a booking</DialogTitle>
					<DialogDescription>
						Tell me a little about your idea. We'll talk through the design,
						placement, and timing before arranging a session in Kathmandu.
					</DialogDescription>
				</DialogHeader>
				<BookingForm initialData={initialData} />
				<DialogClose asChild className="mt-4">
					<Button variant="ghost" size="sm">
						<X className="size-4 mr-2" aria-hidden="true" />
						Close
					</Button>
				</DialogClose>
			</DialogContent>
		</Dialog>
	);
}
