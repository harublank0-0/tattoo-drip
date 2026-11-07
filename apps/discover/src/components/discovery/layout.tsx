import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/** The page's width and gutters: 90rem at most, the gutters from `page-gutter`. */
export function PageContainer({
	className,
	children,
	width = "wide",
}: {
	className?: string;
	children: ReactNode;
	/** `wide` for galleries and grids, `reading` for text. */
	width?: "wide" | "reading";
}) {
	return (
		<div
			className={cn(
				"page-gutter mx-auto w-full",
				width === "wide" ? "max-w-[90rem]" : "max-w-3xl",
				className,
			)}
		>
			{children}
		</div>
	);
}

/**
 * A full-bleed band with the page's vertical rhythm. `night` is a dark
 * immersive section whose children read the night tokens (src/styles.css).
 */
export function EditorialSection({
	tone = "paper",
	className,
	children,
	labelledBy,
}: {
	tone?: "paper" | "sunk" | "night";
	className?: string;
	children: ReactNode;
	/** The id of the section's heading, so the region has a name. */
	labelledBy?: string;
}) {
	return (
		<section
			aria-labelledby={labelledBy}
			className={cn(
				"py-16 lg:py-24",
				tone === "sunk" && "bg-paper-sunk",
				tone === "night" && "night",
				className,
			)}
		>
			<PageContainer>{children}</PageContainer>
		</section>
	);
}

/** A section's eyebrow, display heading and optional intro. */
export function SectionHeading({
	id,
	eyebrow,
	title,
	intro,
	level = 2,
	className,
}: {
	id?: string;
	eyebrow?: string;
	title: string;
	intro?: ReactNode;
	level?: 1 | 2 | 3;
	className?: string;
}) {
	const Heading = `h${level}` as const;
	return (
		<div className={cn("flex max-w-3xl flex-col gap-4", className)}>
			{eyebrow && <p className="eyebrow text-muted-foreground">{eyebrow}</p>}
			<Heading
				id={id}
				className={cn(
					"font-display font-bold",
					level === 1
						? "text-display-xl"
						: level === 2
							? "text-display-lg"
							: "text-display-md",
				)}
			>
				{title}
			</Heading>
			{intro && (
				<div className="max-w-2xl text-lg text-muted-foreground">{intro}</div>
			)}
		</div>
	);
}

export type Crumb = { label: string; to?: string };

/** Where the page sits; the last crumb is the page itself (aria-current). */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
	return (
		<nav aria-label="Breadcrumb">
			<ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
				{items.map((item, index) => {
					const last = index === items.length - 1;
					return (
						<li key={item.to ?? item.label} className="flex items-center gap-2">
							{item.to && !last ? (
								<Link
									to={item.to}
									className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline lg:min-h-0"
								>
									{item.label}
								</Link>
							) : (
								<span
									aria-current={last ? "page" : undefined}
									className={last ? "text-foreground" : undefined}
								>
									{item.label}
								</span>
							)}
							{!last && <span aria-hidden="true">/</span>}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

/** A page's header: breadcrumbs, the h1 and an intro, then optional actions. */
export function PageHeader({
	title,
	eyebrow,
	intro,
	breadcrumbs,
	children,
}: {
	title: string;
	eyebrow?: string;
	intro?: ReactNode;
	breadcrumbs?: Crumb[];
	children?: ReactNode;
}) {
	return (
		<header className="border-b border-line pt-8 pb-12 lg:pt-12 lg:pb-16">
			<PageContainer className="flex flex-col gap-8">
				{breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
				<SectionHeading
					level={1}
					eyebrow={eyebrow}
					title={title}
					intro={intro}
				/>
				{children}
			</PageContainer>
		</header>
	);
}
