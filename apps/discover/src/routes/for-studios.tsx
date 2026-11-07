import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
	EditorialSection,
	PageContainer,
	SectionHeading,
} from "#/components/discovery/layout";
import { buttonVariants } from "#/components/ui/button";
import { paths, studioOsLinks } from "#/lib/routes";
import { pageMeta } from "#/lib/seo";

/**
 * `/for-studios` (D06): Studio OS for tattoo professionals. Every claim is
 * a feature Studio OS has today (apps/platform and apps/storefront,
 * checked when this page was written; docs/discover/frontend.md lists
 * the evidence); what is planned says so. No screenshots exist, so the
 * page is typographic: no mock interfaces, figures or testimonials.
 */
export const Route = createFileRoute("/for-studios")({
	head: () => ({
		meta: pageMeta({
			title: "Studio OS: tattoo studio management software",
			description:
				"Studio OS runs a tattoo studio's requests, quotes, deposits, sessions, clients and its own website, for studios and independent artists.",
		}),
	}),
	component: ForStudios,
});

/** The project's path through Studio OS (the platform's project statuses). */
const LIFECYCLE = [
	"Request",
	"Review",
	"Quote",
	"Deposit",
	"Session",
	"Healing check",
];

const WORKFLOWS: { title: string; body: ReactNode }[] = [
	{
		title: "Requests in one inbox",
		body: "Clients send their idea from your site with up to five reference pictures, the placement, size, preferred dates and budget. You and the artist they asked for are alerted by email and in the app. Accept a request as a project or decline it.",
	},
	{
		title: "Quotes",
		body: "A fixed price, or an hourly rate with estimated hours, with a deposit and an expiry date. Revise a quote until the project is booked.",
	},
	{
		title: "Deposits and payments",
		body: "Send a deposit link with your QR codes (Fonepay, eSewa, Khalti, bank) and a reference code. The client uploads a screenshot and you verify it. Record cash and bank payments at the desk; the balance due is worked out for you.",
	},
	{
		title: "Calendar and sessions",
		body: "Consultations, tattoo sessions and touch-ups in a day, week, month or list view, per artist or the whole studio. Overlapping bookings are refused. Mark a session done, a no-show or cancelled, or move it. Book walk-ins and phone bookings directly.",
	},
	{
		title: "One-tap client messages",
		body: "Open the client's WhatsApp or Viber with your own message ready: received, quote, deposit link, booking confirmation, reminder and aftercare. Nothing is sent automatically.",
	},
	{
		title: "Clients",
		body: "One record per phone number, with each client's projects, references and payments.",
	},
	{
		title: "Today",
		body: "Every member's home: what needs them now, with a setup checklist for a new studio.",
	},
	{
		title: "On your phone",
		body: "Studio OS is made for phones and installs to your home screen as a web app.",
	},
];

function Lead({ children }: { children: ReactNode }) {
	return <p className="max-w-2xl text-lg text-muted-foreground">{children}</p>;
}

function ForStudios() {
	const { discover } = Route.useRouteContext();
	const { getStarted, signIn } = studioOsLinks(discover.settings.studioOsUrl);

	return (
		<>
			{/* Hero: the promise, Get started, and the features below. */}
			<section
				aria-labelledby="for-studios-title"
				className="border-b border-line"
			>
				<PageContainer className="grid gap-12 py-12 sm:py-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-16 lg:py-24">
					<div className="flex flex-col gap-8">
						<div className="flex flex-col gap-5">
							<p className="eyebrow text-accent">
								Studio OS for tattoo professionals
							</p>
							<h1
								id="for-studios-title"
								className="max-w-[14ch] font-display text-display-xl font-bold"
							>
								Your studio. Beautifully managed.
							</h1>
							<Lead>
								Studio OS runs the work between a client's first message and the
								healed tattoo: requests, quotes, deposits, sessions, clients and
								your studio's own website. For studios and independent artists.
							</Lead>
						</div>
						<div className="flex flex-wrap items-center gap-3">
							<a
								href={getStarted}
								className={buttonVariants({ variant: "accent", size: "lg" })}
							>
								Get started
							</a>
							<a
								href="#features"
								className={buttonVariants({ variant: "outline", size: "lg" })}
							>
								Explore features
							</a>
						</div>
						<p className="text-sm text-ink-muted">
							Already use Studio OS?{" "}
							<a
								href={signIn}
								className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-4 lg:min-h-0"
							>
								Sign in
							</a>
						</p>
					</div>
					<ol
						aria-label="A tattoo's path through Studio OS"
						className="border-t border-ink"
					>
						{LIFECYCLE.map((stage, index) => (
							<li
								key={stage}
								className="flex items-baseline justify-between gap-4 border-b border-line py-3"
							>
								<span className="font-display text-display-md font-bold">
									{stage}
								</span>
								<span
									aria-hidden="true"
									className="text-sm text-ink-muted tabular-nums"
								>
									{String(index + 1).padStart(2, "0")}
								</span>
							</li>
						))}
					</ol>
				</PageContainer>
			</section>

			{/* Booking and client workflows: an editorial list, not a card grid. */}
			<section
				id="features"
				aria-labelledby="workflows-title"
				className="scroll-mt-20 py-16 lg:py-24"
			>
				<PageContainer className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
					<div className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
						<SectionHeading
							id="workflows-title"
							eyebrow="Booking and client workflows"
							title="From first message to healed tattoo"
							intro="Each tattoo is a project that moves from review to quote, deposit, sessions and the healing check, with notes and when you last contacted the client."
						/>
					</div>
					<dl className="border-t border-ink">
						{WORKFLOWS.map((item) => (
							<div
								key={item.title}
								className="grid gap-2 border-b border-line py-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-8"
							>
								<dt className="font-display text-2xl font-bold">
									{item.title}
								</dt>
								<dd className="text-muted-foreground">{item.body}</dd>
							</div>
						))}
					</dl>
				</PageContainer>
			</section>

			{/* The studio website: themes as type specimens, never a screenshot. */}
			<EditorialSection tone="night" labelledBy="website-title">
				<div className="grid gap-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-16">
					<div className="flex flex-col gap-6">
						<SectionHeading
							id="website-title"
							eyebrow="Your studio website"
							title="A site that looks like your studio"
							intro="Every studio gets its own public site at its own page link, where clients see your work and send requests."
						/>
						<ul className="flex flex-col gap-3 text-night-ink">
							{[
								"Recent work, a gallery and each artist's portfolio",
								"Flash designs clients can ask for in one tap",
								"Good to know: opening hours with Open now, closed days, walk-ins, the age rule, your deposit policy, aftercare and FAQ",
								"The request form, and a deposit page for each project",
							].map((line) => (
								<li key={line} className="flex gap-3">
									<span
										aria-hidden="true"
										className="mt-2.5 h-px w-4 shrink-0 bg-accent-bright"
									/>
									<span>{line}</span>
								</li>
							))}
						</ul>
					</div>
					<div className="flex flex-col gap-4">
						<p className="eyebrow text-night-muted">
							Two themes to choose from
						</p>
						<div className="grid gap-4 sm:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
							<div className="flex min-h-56 flex-col justify-between bg-paper p-6 text-ink">
								<span className="eyebrow text-ink-muted">Light</span>
								<div>
									<p className="font-display text-display-md font-bold">
										Stencil &amp; Ink
									</p>
									<p className="mt-2 text-sm text-ink-muted">
										Paper, black ink and a stencil line. Made for phones.
									</p>
								</div>
							</div>
							<div className="flex min-h-56 flex-col justify-between border border-night-line bg-night-raised p-6 sm:mt-12">
								<span className="eyebrow text-night-muted">Dark</span>
								<div>
									<p className="font-display text-display-md font-bold">
										Ink Noir
									</p>
									<p className="mt-2 text-sm text-night-muted">
										Dark and photo-first, with a menu of your pages.
									</p>
								</div>
							</div>
						</div>
						<p className="text-night-muted">
							Add your logo, pick a colour and a heading font, and set the order
							of the page's sections. Custom domains are planned.
						</p>
					</div>
				</div>
			</EditorialSection>

			{/* Artists and the team. */}
			<EditorialSection labelledBy="artists-title">
				<div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
					<SectionHeading
						id="artists-title"
						eyebrow="Portfolio and artists"
						title="Every artist, their work and their flash"
					/>
					<div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
						<div className="flex flex-col gap-2 border-t border-ink pt-4">
							<h3 className="font-display text-2xl font-bold">
								Artist profiles
							</h3>
							<p className="text-muted-foreground">
								A bio, photo, styles and social links, and a switch for whether
								they're taking requests, with a message when they're not.
							</p>
						</div>
						<div className="flex flex-col gap-2 border-t border-ink pt-4 sm:mt-10">
							<h3 className="font-display text-2xl font-bold">Portfolio</h3>
							<p className="text-muted-foreground">
								Work photos for each artist, shown on your site and, if you
								list, on Discover.
							</p>
						</div>
						<div className="flex flex-col gap-2 border-t border-ink pt-4">
							<h3 className="font-display text-2xl font-bold">Flash</h3>
							<p className="text-muted-foreground">
								Designs with a picture, size and optional price. A one-of-a-kind
								design is marked taken once it's booked.
							</p>
						</div>
						<div className="flex flex-col gap-2 border-t border-ink pt-4 sm:mt-10">
							<h3 className="font-display text-2xl font-bold">Your team</h3>
							<p className="text-muted-foreground">
								Invite members as owners or artists. Artists see their own
								projects and sessions; owners see everything.
							</p>
						</div>
					</div>
				</div>
			</EditorialSection>

			{/* Solo or studio. */}
			<EditorialSection tone="sunk" labelledBy="who-title">
				<SectionHeading
					id="who-title"
					eyebrow="Independent artists included"
					title="One artist or a full studio"
					intro="Choose what you are when you set up. The tools are the same."
					className="mb-10"
				/>
				<div className="grid border-t border-ink lg:grid-cols-2">
					<div className="flex flex-col gap-2 border-b border-line py-6 lg:border-r lg:pr-10">
						<h3 className="font-display text-display-md font-bold">Studio</h3>
						<p className="text-muted-foreground">
							A shop with one or more artists: invite your team and run the
							whole calendar.
						</p>
					</div>
					<div className="flex flex-col gap-2 border-b border-line py-6 lg:pl-10">
						<h3 className="font-display text-display-md font-bold">
							Independent artist
						</h3>
						<p className="text-muted-foreground">
							Just you, working on your own, with your own site and requests.
						</p>
					</div>
				</div>
			</EditorialSection>

			{/* Discover listing: optional, and not launched yet. */}
			<EditorialSection labelledBy="discover-title">
				<div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
					<div className="flex flex-col gap-4">
						<SectionHeading
							id="discover-title"
							eyebrow="Tattoo Drip Discover"
							title="Get found, if you choose to"
						/>
						<p
							role="note"
							className="border-l-2 border-accent pl-4 text-sm text-ink-muted"
						>
							Discover is being prepared for launch. The listing controls are
							already in Studio OS.
						</p>
					</div>
					<ul className="border-t border-ink">
						{[
							"Off by default: an owner turns the listing on, accepts the listing terms and picks the studio's city.",
							"A readiness checklist and a preview show what clients will see before you list.",
							"Choose which artists and which work photos appear. Artists can switch their own profile off.",
							"Turn the listing off at any time and your studio leaves Discover; your site and bookings carry on as before.",
							"Clients who find you on Discover book on your own site, never through Discover.",
						].map((line) => (
							<li
								key={line}
								className="border-b border-line py-4 text-muted-foreground"
							>
								{line}
							</li>
						))}
					</ul>
				</div>
			</EditorialSection>

			{/* Getting started: the real signup and onboarding steps. */}
			<EditorialSection tone="sunk" labelledBy="start-title">
				<SectionHeading
					id="start-title"
					eyebrow="Getting started"
					title="Set up in three steps"
					className="mb-10"
				/>
				<ol className="flex flex-col border-t border-ink">
					{[
						{
							title: "Create your account",
							body: "Sign up with your email and a password, then confirm your email.",
						},
						{
							title: "Set up your business",
							body: "Its name, studio or independent artist, your page link and your time zone.",
						},
						{
							title: "Follow the checklist",
							body: "Add your artists, add a payment QR code, write your deposit policy and share your studio link.",
						},
					].map((step, index) => (
						<li
							key={step.title}
							className="grid gap-2 border-b border-line py-6 sm:grid-cols-[4rem_minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline sm:gap-8"
						>
							<span
								aria-hidden="true"
								className="font-display text-display-md font-bold text-accent"
							>
								{index + 1}
							</span>
							<h3 className="font-display text-2xl font-bold">{step.title}</h3>
							<p className="text-muted-foreground">{step.body}</p>
						</li>
					))}
				</ol>
			</EditorialSection>

			{/* Final call to action. */}
			<EditorialSection labelledBy="for-studios-cta">
				<div className="flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between">
					<div className="flex max-w-2xl flex-col gap-4">
						<h2
							id="for-studios-cta"
							className="font-display text-display-lg font-bold"
						>
							Bring your studio to Studio OS.
						</h2>
						<p className="text-lg text-ink-muted">
							Set up your studio and its website, then list on Discover when
							you're ready.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<a
							href={getStarted}
							className={buttonVariants({ variant: "accent", size: "lg" })}
						>
							Get started
						</a>
						<Link
							to={paths.pricing()}
							className="inline-flex min-h-11 items-center gap-2 px-2 font-medium underline-offset-4 hover:underline"
						>
							Pricing
							<ArrowRightIcon className="size-4" aria-hidden="true" />
						</Link>
					</div>
				</div>
			</EditorialSection>
		</>
	);
}
