import { createFileRoute } from "@tanstack/react-router";
import { Footer } from "#/components/layout/footer";
import { Header } from "#/components/layout/header";
import { ArtistIntro } from "#/features/home/artist-intro";
import { BookingCta } from "#/features/home/booking-cta";
import { FeaturedWork } from "#/features/home/featured-work";
import { FlashPreview } from "#/features/home/flash-preview";
import { Hero } from "#/features/home/hero";
import { Intro } from "#/features/home/intro";
import { Specialties } from "#/features/home/specialties";

export const Route = createFileRoute("/")({
	component: Home,
	head: () => ({
		meta: [
			{ title: "Sangi Tattoo Studio — Custom Tattoos in Kathmandu" },
			{
				name: "description",
				content:
					"Independent tattoo artist Suraj Rana in Kathmandu, Nepal. Explore custom blackwork, fine line, ornamental tattoos, and original flash.",
			},
			{
				property: "og:title",
				content: "Sangi Tattoo Studio — Kathmandu, Nepal",
			},
			{
				property: "og:description",
				content:
					"Thoughtful tattoo work. Made with intention. Worn for a lifetime.",
			},
			{ property: "og:type", content: "website" },
		],
	}),
});

function Home() {
	return (
		<div id="top">
			<a href="#main" className="skip-link">
				Skip to content
			</a>
			<Header />
			<main id="main" tabIndex={-1}>
				<Hero />
				<Intro />
				<FeaturedWork />
				<Specialties />
				<ArtistIntro />
				<FlashPreview />
				<BookingCta />
			</main>
			<Footer />
		</div>
	);
}
