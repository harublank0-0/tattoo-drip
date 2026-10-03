import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { bookingEmailHref } from "#/data/mock/artist";
import { type FlashPiece, flash, formatFlashPrice } from "#/data/mock/flash";

function FlashDetails({ piece }: { piece: FlashPiece }) {
	return (
		<div className="flex flex-col gap-5">
			<img
				src={piece.image}
				alt={`${piece.title} tattoo flash drawing in black ink`}
				width={400}
				height={500}
				loading="lazy"
				className="aspect-[4/5] max-h-[45svh] w-full bg-paper object-contain"
			/>
			<div>
				<h3 className="font-display text-3xl">{piece.title}</h3>
				<p className="eyebrow mt-2 text-accent">
					{formatFlashPrice(piece)} USD · {piece.size} ·{" "}
					{piece.available ? "Available" : "Reserved"}
				</p>
				<p className="mt-4 text-sm leading-relaxed text-muted-foreground">
					{piece.description}
				</p>
			</div>
			<Button asChild variant="outline">
				<a href={bookingEmailHref(`Flash enquiry: ${piece.title}`)}>
					Enquire about this piece
					<ArrowUpRight data-icon="inline-end" aria-hidden="true" />
				</a>
			</Button>
		</div>
	);
}

export function FlashPreview() {
	return (
		<section
			id="flash"
			className="page-container pb-24 md:pb-36"
			aria-labelledby="flash-title"
		>
			<div className="section-heading reveal">
				<div>
					<p className="eyebrow mb-4 text-accent">Drawn & ready</p>
					<h2 id="flash-title" className="section-title">
						Flash<span className="text-accent">.</span>
					</h2>
				</div>
				<p className="max-w-72 text-sm leading-relaxed text-muted-foreground">
					Original designs available to tattoo as shown, with limited
					availability.
				</p>
			</div>
			<div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4 md:gap-6">
				{flash.map((piece) => (
					<Dialog key={piece.id}>
						<DialogTrigger asChild>
							<button
								type="button"
								className="group text-left"
								aria-label={`View ${piece.title}, ${formatFlashPrice(piece)}, ${piece.available ? "available" : "reserved"}`}
							>
								<div className="overflow-hidden bg-paper">
									<img
										src={piece.image}
										alt={`${piece.title} black ink flash design`}
										width={400}
										height={500}
										loading="lazy"
										decoding="async"
										className="aspect-[4/5] w-full object-contain transition-transform duration-500 motion-safe:group-hover:scale-[1.04]"
									/>
								</div>
								<span className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
									<span className="font-display text-2xl">{piece.title}</span>
									<span className="text-xs text-muted-foreground">
										{formatFlashPrice(piece)}
									</span>
								</span>
								<span className="mt-2 flex items-center gap-2 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
									<span className="size-1 rounded-full bg-accent" />
									{piece.available ? "Available" : "Reserved"}
								</span>
							</button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>{piece.title}</DialogTitle>
								<DialogDescription>
									Original flash · Pricing in USD. Placement and final size
									confirmed together.
								</DialogDescription>
							</DialogHeader>
							<FlashDetails piece={piece} />
						</DialogContent>
					</Dialog>
				))}
			</div>
			<div className="mt-12 flex justify-center">
				<Dialog>
					<DialogTrigger asChild>
						<button type="button" className="text-link">
							View flash
							<ArrowRight className="size-4" aria-hidden="true" />
						</button>
					</DialogTrigger>
					<DialogContent className="sm:max-w-4xl">
						<DialogHeader>
							<DialogTitle>The flash collection</DialogTitle>
							<DialogDescription>
								Four original designs, ready for their person. Prices are in USD
								at the suggested size. Email to discuss a design; availability
								is confirmed personally. Enquiry links use a placeholder address
								for this concept.
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-12 sm:grid-cols-2">
							{flash.map((piece) => (
								<FlashDetails key={piece.id} piece={piece} />
							))}
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</section>
	);
}
