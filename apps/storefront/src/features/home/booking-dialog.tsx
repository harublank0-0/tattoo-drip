import { ArrowUpRight, Mail } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { artist, bookingEmailHref } from "#/data/mock/artist";

export function BookingDialog({
	variant = "default",
	size = "lg",
}: Pick<ComponentProps<typeof Button>, "variant" | "size">) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant={variant} size={size}>
					Start a booking
					<ArrowUpRight data-icon="inline-end" aria-hidden="true" />
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Every piece starts with a conversation.</DialogTitle>
					<DialogDescription>
						Tell me a little about your idea. We’ll talk through the design,
						placement, and timing before arranging a session in Kathmandu.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
					<p>In your enquiry, include:</p>
					<ul className="ml-4 flex list-disc flex-col gap-2">
						<li>Your idea and any reference images</li>
						<li>Placement and approximate size</li>
						<li>Your preferred dates and budget</li>
					</ul>
				</div>
				<Button asChild size="lg">
					<a href={bookingEmailHref()}>
						Open email draft
						<Mail data-icon="inline-end" aria-hidden="true" />
					</a>
				</Button>
				<p className="text-xs leading-relaxed text-muted-foreground">
					This opens your email app; a session is only confirmed after we’ve
					agreed on the details. Concept preview:{" "}
					<span className="break-all">{artist.email}</span> is a placeholder
					contact.
				</p>
			</DialogContent>
		</Dialog>
	);
}
