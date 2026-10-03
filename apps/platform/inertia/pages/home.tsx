import { ArrowUpRight, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "~/components/ui/badge";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
} from "~/components/ui/card";
import MarketingLayout from "~/layouts/marketing";

const links = [
	{
		title: "Documentation",
		description: "Guides & API reference",
		href: "https://docs.adonisjs.com",
	},
	{
		title: "AdonisJS Plus",
		description: "Feature packs and Flow AI",
		href: "https://plus.adonisjs.com",
	},
	{
		title: "Discord",
		description: "Meet fellow AdonisJS developers",
		href: "https://discord.com/invite/vDcEjq6",
	},
];

/** Brand logos keep their own colours, so they don't use theme tokens. */
const stack: { title: string; background: string; logo: ReactNode }[] = [
	{
		title: "AdonisJS",
		background: "#5A45FF",
		logo: (
			<svg viewBox="0 0 160 160" fill="#fff" aria-hidden="true">
				<path
					fillRule="evenodd"
					clipRule="evenodd"
					d="M0 80.0001C0 144.521 15.4786 160 79.9999 160 144.521 160 160 144.521 160 80.0001 160 15.4786 144.521 0 79.9999 0 15.4786 0 0 15.4786 0 80.0001zm32.2607 16.6191l25.0918-57.0266c4.2361-9.613 12.3825-14.8268 22.6474-14.8268 10.265 0 18.4113 5.2138 22.6481 14.8268l25.091 57.0266c1.141 2.77 2.118 6.3538 2.118 9.4498 0 14.175-9.939 24.114-24.114 24.114-4.828 0-8.6629-1.232-12.5444-2.479-3.9771-1.278-8.0036-2.572-13.1987-2.572-5.1349 0-9.2597 1.306-13.3154 2.589-3.9233 1.241-7.7814 2.462-12.4279 2.462-14.1752 0-24.1141-9.939-24.1141-24.114 0-3.096.9776-6.6798 2.1182-9.4498zm47.7392-47.0871L55.2344 105.581c7.332-3.422 15.8043-5.051 24.7655-5.051 8.6358 0 17.434 1.629 24.4401 5.051L79.9999 49.5321z"
				/>
			</svg>
		),
	},
	{
		title: "Inertia",
		background: "#9061F9",
		logo: (
			<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
				<path d="M12.5 8l4 4l-4 4h4.5l4 -4l-4 -4z" />
				<path d="M3.5 8l4 4l-4 4h4.5l4 -4l-4 -4z" />
			</svg>
		),
	},
	{
		title: "React",
		background: "#23272F",
		logo: (
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<g fill="none" stroke="#61DAFB" strokeWidth="1">
					<ellipse cx="12" cy="12" rx="11" ry="4.2" />
					<ellipse
						cx="12"
						cy="12"
						rx="11"
						ry="4.2"
						transform="rotate(60 12 12)"
					/>
					<ellipse
						cx="12"
						cy="12"
						rx="11"
						ry="4.2"
						transform="rotate(120 12 12)"
					/>
				</g>
				<circle cx="12" cy="12" r="2.1" fill="#61DAFB" />
			</svg>
		),
	},
	{
		title: "TypeScript",
		background: "#3178C6",
		logo: (
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<text
					x="12"
					y="17"
					textAnchor="middle"
					fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
					fontWeight="700"
					fontSize="10"
					fill="#fff"
					letterSpacing="-0.5"
				>
					TS
				</text>
			</svg>
		),
	},
	{
		title: "Vite",
		background: "#1E1B2E",
		logo: (
			<svg viewBox="0 0 410 404" aria-hidden="true">
				<defs>
					<linearGradient
						id="viteA"
						x1="6"
						y1="33"
						x2="235"
						y2="344"
						gradientUnits="userSpaceOnUse"
					>
						<stop stopColor="#41D1FF" />
						<stop offset="1" stopColor="#BD34FE" />
					</linearGradient>
					<linearGradient
						id="viteB"
						x1="194"
						y1="8"
						x2="236"
						y2="292"
						gradientUnits="userSpaceOnUse"
					>
						<stop stopColor="#FFEA83" />
						<stop offset=".083" stopColor="#FFDD35" />
						<stop offset="1" stopColor="#FFA800" />
					</linearGradient>
				</defs>
				<path
					d="M399.641 59.5246L215.643 388.545C211.844 395.338 202.084 395.378 198.228 388.618L10.5817 59.5563C6.38087 52.1896 12.6802 43.2665 21.0281 44.7586L205.223 77.6824C206.398 77.8924 207.601 77.8904 208.776 77.6763L389.119 44.8058C397.439 43.2894 403.768 52.1434 399.641 59.5246Z"
					fill="url(#viteA)"
				/>
				<path
					d="M292.965 1.5744L156.801 28.2552C154.563 28.6937 152.906 30.5903 152.771 32.8664L144.395 174.33C144.198 177.662 147.258 180.248 150.51 179.498L188.42 170.749C191.967 169.931 195.172 173.055 194.443 176.622L183.18 231.775C182.422 235.487 185.907 238.661 189.532 237.56L212.947 230.446C216.577 229.344 220.065 232.527 219.297 236.242L201.398 322.875C200.278 328.294 207.486 331.249 210.492 326.603L212.5 323.5L323.454 102.072C325.312 98.3645 322.108 94.137 318.036 94.9233L279.014 102.452C275.347 103.159 272.227 99.7398 273.262 96.1457L298.731 7.66608C299.767 4.06956 296.642 0.649737 292.965 1.5744Z"
					fill="url(#viteB)"
				/>
			</svg>
		),
	},
];

export default function Home() {
	return (
		<div className="flex min-h-svh flex-col items-center justify-center px-6 pt-26 pb-14">
			<Card className="w-full max-w-[580px]">
				<CardHeader className="gap-5">
					<Badge variant="secondary">
						<CircleCheck />
						Server ready
					</Badge>
					<h1 className="font-serif text-3xl leading-tight text-balance sm:text-4xl">
						Welcome to the power of a full-stack React app.
					</h1>
				</CardHeader>

				<CardContent className="flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground">
					<p>
						Powered by Inertia and React, this setup blends server-driven
						routing with rich client-side interactivity that feels seamless,
						fast, and cohesive.
					</p>
					<p>
						This page is simply proof the engine started. Everything from here
						is yours to build.
					</p>

					<ul className="flex flex-col divide-y">
						{links.map(({ title, description, href }) => (
							<li key={href}>
								<a
									href={href}
									target="_blank"
									rel="noreferrer"
									className="group flex items-center gap-3 py-3 transition-[padding] hover:pl-2"
								>
									<span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
									<span className="font-medium text-foreground">{title}</span>
									<span className="truncate">{description}</span>
									<ArrowUpRight className="ml-auto size-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
								</a>
							</li>
						))}
					</ul>
				</CardContent>

				<CardFooter className="justify-between border-t">
					<span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
						Built with
					</span>
					<ul className="group flex" aria-label="Tech stack">
						{stack.map(({ title, background, logo }) => (
							<li
								key={title}
								title={title}
								style={{ background }}
								className="relative -ml-2 grid size-[34px] place-items-center rounded-[9px] shadow-[0_0_0_3px_var(--card),0_2px_6px_rgb(0_0_0/0.18)] transition-[margin] first:ml-0 group-hover:ml-[3px] group-hover:first:ml-0 [&>svg]:size-5"
							>
								{logo}
							</li>
						))}
					</ul>
				</CardFooter>
			</Card>
		</div>
	);
}

Home.layout = [MarketingLayout];
