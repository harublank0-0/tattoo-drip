import { ArrowRight } from "lucide-react";

export function Intro() {
	return (
		<section
			id="intro"
			className="page-container section-space reveal grid gap-8 md:grid-cols-[1fr_2fr] md:gap-16"
			aria-labelledby="intro-title"
		>
			<h2 id="intro-title" className="eyebrow max-w-44 text-muted-foreground">
				Tattoos made
				<br />
				to belong to you
			</h2>
			<div>
				<p className="editorial-copy">
					Every tattoo begins with a conversation.{" "}
					<span className="text-muted-foreground">
						From the first idea to the final line, each piece is designed around
						the person wearing it.
					</span>
				</p>
				<a className="text-link mt-9" href="#about">
					About the artist
					<ArrowRight className="size-4" aria-hidden="true" />
				</a>
			</div>
		</section>
	);
}
