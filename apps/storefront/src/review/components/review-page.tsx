import type { ReactNode, Ref } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { isAllowedHref, linkRel } from "../../studio/links.ts";
import { logoSizes } from "../../studio/srcset.ts";
import type { LogoImage } from "../../studio/theme/config.ts";
import type { ContactLink } from "../../studio/view-model.ts";
import { copy } from "../copy.ts";
import type { LoadProblem } from "../problems.ts";

/*
 * The review page's blocks (Reviews and Fresh ink). Props only: no router
 * or query hooks, so test/review/ renders them with react-dom/server. API
 * text renders as text, names inside sentences in <bdi> (<Fill>). No link
 * here starts with "#": following one would replace the token in the URL.
 */

/** The studio's mark: its first user-perceived character. */
export function studioInitial(name: string): string {
	const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
	for (const { segment } of segmenter.segment(name.trim())) return segment;
	return "";
}

/** Around every state: the studio's header, one h1 and who runs the page. */
export function ReviewFrame({
	studioName,
	logo = null,
	heading,
	headingRef,
	children,
}: {
	studioName: string;
	logo?: LogoImage | null;
	/** The h1's template: `{studio}` is filled. */
	heading: string;
	headingRef?: Ref<HTMLHeadingElement>;
	children?: ReactNode;
}) {
	return (
		<>
			<main className="review">
				<header className="deposit-header">
					{logo ? (
						<img
							className="deposit-logo"
							src={logo.src}
							srcSet={logo.srcSet}
							sizes={logo.srcSet ? logoSizes(logo, "deposit") : undefined}
							width={logo.width}
							height={logo.height}
							alt=""
							decoding="async"
							referrerPolicy="no-referrer"
							data-tile={logo.tile === "dark" ? "dark" : undefined}
						/>
					) : (
						<span className="deposit-mark" aria-hidden="true">
							{studioInitial(studioName)}
						</span>
					)}
					<p className="deposit-studio" dir="auto">
						{studioName}
					</p>
				</header>
				<h1 className="deposit-title" ref={headingRef} tabIndex={-1}>
					<Fill template={heading} values={{ studio: studioName }} />
				</h1>
				{children}
			</main>
			<footer className="deposit-footer">
				<p>
					<Fill template={copy.footer} values={{ studio: studioName }} />
				</p>
			</footer>
		</>
	);
}

/** Before the page arrives (and on the server, which never sees the token). */
export function ReviewLoading() {
	return (
		<div className="deposit-skeleton" aria-busy="true">
			<p className="sr-only">{copy.loading}</p>
			<span className="deposit-skeleton-line" aria-hidden="true" />
			<span
				className="deposit-skeleton-line deposit-skeleton-short"
				aria-hidden="true"
			/>
		</div>
	);
}

/**
 * A link that doesn't work (unknown, revoked, expired, or reviews off: the
 * API's one 404), a rate limit, or a read that failed. A dead link never
 * shows what was posted, only how to reach the studio (ruling 4).
 */
export function ReviewProblem({
	problem,
	studioName,
	contact,
	onRetry,
	ref,
}: {
	problem: LoadProblem;
	studioName: string;
	contact: readonly ContactLink[];
	onRetry?: () => void;
	ref?: Ref<HTMLParagraphElement>;
}) {
	return (
		<div className="deposit-state">
			<p ref={ref} className="deposit-state-title" role="alert" tabIndex={-1}>
				<Fill
					template={
						problem === "dead"
							? copy.dead
							: problem === "limited"
								? copy.limited
								: copy.failed
					}
					values={{ studio: studioName }}
				/>
			</p>
			{problem !== "dead" && onRetry ? (
				<button
					type="button"
					className="action action-secondary"
					onClick={onRetry}
				>
					{copy.tryAgain}
				</button>
			) : null}
			{problem === "dead" ? (
				<ContactLinks studioName={studioName} contact={contact} />
			) : null}
		</div>
	);
}

/** The studio's contact links (only those the page may render). */
export function ContactLinks({
	studioName,
	contact,
}: {
	studioName: string;
	contact: readonly ContactLink[];
}) {
	const links = contact.filter((link) => isAllowedHref(link.href));
	if (links.length === 0) return null;
	return (
		<div className="deposit-contact">
			<p>
				<Fill template={copy.deadContact} values={{ studio: studioName }} />
			</p>
			<ul className="review-contact-list">
				{links.map((link) => (
					<li key={`${link.kind}:${link.href}`}>
						<a
							className="text-link"
							href={link.href}
							rel={linkRel(link.href)}
							referrerPolicy="no-referrer"
						>
							{link.label}
						</a>
					</li>
				))}
			</ul>
		</div>
	);
}

/** The heading's template for a state. */
export function headingFor(
	state: "loading" | "open" | "saved" | LoadProblem,
): string {
	switch (state) {
		case "dead":
			return copy.headingDead;
		case "limited":
			return copy.headingLimited;
		case "failed":
			return copy.headingFailed;
		case "saved":
			return copy.headingSaved;
		default:
			return copy.heading;
	}
}
