import { ArrowRight } from "lucide-react";
import { artist } from "#/data/mock/artist";

export function ArtistIntro() {
	return (
		<section
			id="about"
			className="page-container section-space grid items-center gap-12 md:grid-cols-2 md:gap-20 lg:gap-28"
			aria-labelledby="artist-title"
		>
			<figure className="reveal">
				<img
					src={artist.portrait}
					alt={`${artist.name} at work in his Kathmandu tattoo studio`}
					width={1000}
					height={1250}
					loading="lazy"
					decoding="async"
					className="aspect-[4/5] w-full bg-secondary object-cover grayscale"
				/>
				<figcaption className="eyebrow mt-4 flex justify-between text-muted-foreground">
					<span>{artist.name}</span>
					<span>In the studio</span>
				</figcaption>
			</figure>
			<div className="reveal">
				<p className="eyebrow text-accent">The artist</p>
				<h2
					id="artist-title"
					className="mt-7 font-display text-5xl leading-[1.08] tracking-tight lg:text-6xl"
				>
					I’m Suraj, a tattoo artist based in{" "}
					<em className="font-normal">Kathmandu.</em>
				</h2>
				<div className="mt-8 flex flex-col gap-5 text-sm leading-[1.9] text-muted-foreground">
					{artist.biography.slice(0, 2).map((paragraph) => (
						<p key={paragraph}>{paragraph}</p>
					))}
				</div>
				<details className="artist-more mt-7">
					<summary className="text-link">
						More about me
						<ArrowRight
							className="size-4 transition-transform"
							aria-hidden="true"
						/>
					</summary>
					<div className="mt-5 flex flex-col gap-5 text-sm leading-[1.9] text-muted-foreground">
						{artist.biography.slice(2).map((paragraph) => (
							<p key={paragraph}>{paragraph}</p>
						))}
					</div>
				</details>
				<p
					className="mt-10 font-display text-4xl italic text-accent"
					aria-hidden="true"
				>
					Suraj.
				</p>
			</div>
		</section>
	);
}
