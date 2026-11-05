import { ChevronDown, MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { studioCopy } from "../../../copy.ts";
import {
	type GoodToKnowView,
	goodToKnowIsEmpty,
} from "../../../good-to-know.ts";
import { CLOSED_TEXT } from "../../../hours.ts";
import { isAllowedHref, linkRel } from "../../../links.ts";
import type { StudioView } from "../../../view-model.ts";
import { inkNoirHomeCopy } from "./copy.ts";
import { SectionHead } from "./parts.tsx";

const copy = inkNoirHomeCopy.experience;
const labels = studioCopy.goodToKnow;

/**
 * The visit: what the studio wrote in Good to know (hours, closed days,
 * walk-ins, age, deposit, then "Before your session" and "Aftercare" folded in
 * native <details>) beside where to find it, with its map link. Only what the
 * studio filled in; nothing at all when it filled in nothing and has no
 * address. The `good-to-know` id keeps old `/#good-to-know` links landing
 * here. Studio text is rendered as text.
 */
export function StudioExperience({
	view,
	studio,
}: {
	view: GoodToKnowView;
	studio: StudioView;
}) {
	const address =
		studio.address && isAllowedHref(studio.address.mapsHref)
			? studio.address
			: null;
	if (goodToKnowIsEmpty(view) && !address) return null;
	const rows: { label: string; body: ReactNode; text?: boolean }[] = [];
	if (view.hours.length > 0) {
		rows.push({
			label: labels.hours,
			body: (
				<VisitLines>
					{view.hours.map((line) => (
						<li key={line.days}>
							<span className="ink-when">{line.days}</span>{" "}
							<span>{line.hours}</span>
						</li>
					))}
				</VisitLines>
			),
		});
	}
	if (view.closedDays.length > 0) {
		rows.push({
			label: labels.closedDays,
			body: (
				<VisitLines>
					{view.closedDays.map((day, index) => (
						// The list never reorders in the browser: the index is stable.
						// biome-ignore lint/suspicious/noArrayIndexKey: two entries may read the same
						<li key={index}>
							<span className="ink-when">{day.when}</span>{" "}
							{day.note ? (
								<span className="user-text" dir="auto">
									{day.note}
								</span>
							) : (
								<span>{CLOSED_TEXT}</span>
							)}
						</li>
					))}
				</VisitLines>
			),
		});
	}
	for (const [label, text] of [
		[labels.walkIns, view.walkIns],
		[labels.age, view.ageRule],
		[labels.deposit, view.depositPolicy],
	] as const) {
		if (text !== null) rows.push({ label, body: text, text: true });
	}
	const folded = [
		[labels.beforeSession, view.beforeSession],
		[labels.aftercare, view.aftercare],
	] as const;
	return (
		<section
			id="good-to-know"
			className="ink-section ink-visit"
			aria-labelledby="good-to-know-title"
		>
			<div className="ink-container ink-visit-grid">
				<div className="ink-visit-lead">
					<SectionHead id="good-to-know-title" label={copy.eyebrow}>
						{copy.title}
					</SectionHead>
					{address ? (
						<div className="ink-visit-address">
							<p className="ink-visit-find">{copy.find}</p>
							<p className="user-text" dir="auto">
								{address.text}
							</p>
							<a
								className="ink-link ink-visit-map"
								href={address.mapsHref}
								rel={linkRel(address.mapsHref)}
							>
								<MapPin aria-hidden="true" />
								<span>{copy.directions}</span>
							</a>
						</div>
					) : null}
				</div>
				{rows.length > 0 || folded.some(([, text]) => text !== null) ? (
					<div className="ink-visit-body">
						{rows.length > 0 ? (
							<dl className="ink-visit-list">
								{rows.map((row) => (
									<div key={row.label} className="ink-visit-row">
										<dt>{row.label}</dt>
										{row.text ? (
											<dd className="user-text" dir="auto">
												{row.body}
											</dd>
										) : (
											<dd>{row.body}</dd>
										)}
									</div>
								))}
							</dl>
						) : null}
						{folded.map(([label, text]) =>
							text === null ? null : (
								<details key={label} className="ink-visit-more">
									<summary>
										<span>{label}</span>
										<ChevronDown aria-hidden="true" />
									</summary>
									<p className="user-text" dir="auto">
										{text}
									</p>
								</details>
							),
						)}
					</div>
				) : null}
			</div>
		</section>
	);
}

/** A few lines in a row: a plain list with no bullets, so WebKit needs its role back. */
function VisitLines({ children }: { children: ReactNode }) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="ink-visit-lines" role="list">
			{children}
		</ul>
	);
}
