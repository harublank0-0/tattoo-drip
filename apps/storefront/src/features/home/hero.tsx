import { ArrowDown, ArrowUpRight } from "lucide-react";
import { Button } from "#/components/ui/button";
import { artist } from "#/data/mock/artist";
import { BookingDialog } from "./booking-dialog";
export function Hero() {
	return (
		<section className="hero" aria-labelledby="hero-title">
			<div className="hero-photograph">
				<img
					src={artist.heroImage}
					alt="Close-up of a tattoo artist’s gloved hands carefully inking a design on a client’s arm"
					width={1600}
					height={1068}
					fetchPriority="high"
					className="size-full object-cover"
				/>
			</div>
			<div className="page-container hero-content">
				<div className="hero-location eyebrow">
					<span>Tattoo artist</span>
					<span>{artist.location}</span>
				</div>
				<h1 id="hero-title" className="hero-name">
					Suraj
					<br />
					<span>Rana</span>
					<span className="hero-period">.</span>
				</h1>
				<div className="hero-description">
					<p>{artist.statement}</p>
					<div className="mt-8 flex flex-wrap gap-3">
						<Button asChild size="lg" variant="outline">
							<a href="#work">
								View my work
								<ArrowUpRight data-icon="inline-end" aria-hidden="true" />
							</a>
						</Button>
						<BookingDialog variant="ghost" />
					</div>
				</div>
				<div className="hero-bottom">
					<a href="#intro" className="eyebrow flex min-h-11 items-center gap-4">
						<ArrowDown className="size-4" aria-hidden="true" />
						Scroll to explore
					</a>
					<span className="eyebrow hidden sm:block">By appointment only</span>
				</div>
			</div>
		</section>
	);
}
