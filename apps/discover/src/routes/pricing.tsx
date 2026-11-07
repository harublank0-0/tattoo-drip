import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import {
	EditorialSection,
	PageContainer,
	SectionHeading,
} from "#/components/discovery/layout";
import { buttonVariants } from "#/components/ui/button";
import { paths, studioOsLinks } from "#/lib/routes";
import { pageMeta } from "#/lib/seo";

/**
 * `/pricing` (D06): informational. Studio OS has no plans or billing yet
 * (no plan, subscription or payment-provider code in apps/platform), so
 * the page says the details are being finalised, that nothing here takes
 * payment, and what is included today. No tiers, figures, trials or
 * discounts. Not indexed until real pricing is published: a search result
 * would otherwise keep "being finalised" after prices exist.
 */
export const Route = createFileRoute("/pricing")({
	// Never indexed, whatever DISCOVER_INDEXING says (the root reads it).
	staticData: { noindex: true },
	head: () => ({
		meta: pageMeta({
			title: "Pricing",
			description:
				"Studio OS pricing for tattoo studios and independent artists is being finalised and will be published before billing starts.",
		}),
	}),
	component: Pricing,
});

const INCLUDED = [
	"Requests in one inbox, with reference pictures",
	"Quotes, deposit links with your QR codes, and payments with the balance due",
	"A calendar of consultations, sessions and touch-ups",
	"One-tap WhatsApp and Viber messages in your own words",
	"Client records, artist profiles, portfolios and flash designs",
	"Your own studio website, in one of two themes",
	"Discover listing controls, for when Discover opens",
];

function Pricing() {
	const { discover } = Route.useRouteContext();
	const { getStarted } = studioOsLinks(discover.settings.studioOsUrl);

	return (
		<>
			<section aria-labelledby="pricing-title" className="border-b border-line">
				<PageContainer className="flex flex-col gap-8 py-12 sm:py-16 lg:py-24">
					<div className="flex max-w-3xl flex-col gap-5">
						<p className="eyebrow text-accent">Pricing</p>
						<h1
							id="pricing-title"
							className="font-display text-display-xl font-bold"
						>
							Simple plans for tattoo professionals.
						</h1>
						<p className="max-w-2xl text-lg text-ink-muted">
							Pricing details are being finalised. They will be published here
							before billing starts.
						</p>
					</div>
					<p
						role="note"
						className="max-w-2xl border-l-2 border-accent pl-4 text-ink-muted"
					>
						Nothing on this site takes payment, and Studio OS asks for no
						payment details when you sign up.
					</p>
					<div className="flex flex-wrap items-center gap-3">
						<a
							href={getStarted}
							className={buttonVariants({ variant: "accent", size: "lg" })}
						>
							Get started
						</a>
						<Link
							to={paths.forStudios()}
							className={buttonVariants({ variant: "outline", size: "lg" })}
						>
							See what Studio OS does
						</Link>
					</div>
				</PageContainer>
			</section>

			<EditorialSection labelledBy="included-title">
				<div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
					<SectionHeading
						id="included-title"
						eyebrow="Included today"
						title="What Studio OS does now"
						intro="For studios and independent artists alike."
					/>
					<ul className="border-t border-ink">
						{INCLUDED.map((line) => (
							<li key={line} className="border-b border-line py-4 text-lg">
								{line}
							</li>
						))}
					</ul>
				</div>
			</EditorialSection>

			<EditorialSection tone="sunk" labelledBy="pricing-discover-title">
				<div className="flex flex-col items-start gap-6 lg:flex-row lg:items-end lg:justify-between">
					<div className="flex max-w-2xl flex-col gap-4">
						<h2
							id="pricing-discover-title"
							className="font-display text-display-md font-bold"
						>
							Discover has no paid placement.
						</h2>
						<p className="text-muted-foreground">
							Listed studios and artists appear in the same order for everyone
							(by default, most recently listed first). No one can pay to rank
							higher.
						</p>
					</div>
					<Link
						to={paths.studios()}
						className="inline-flex min-h-11 items-center gap-2 font-medium underline-offset-4 hover:underline"
					>
						Explore studios
						<ArrowRightIcon className="size-4" aria-hidden="true" />
					</Link>
				</div>
			</EditorialSection>
		</>
	);
}
