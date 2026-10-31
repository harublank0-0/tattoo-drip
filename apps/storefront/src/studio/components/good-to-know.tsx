import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { studioCopy } from "../copy.ts";
import { type GoodToKnowView, goodToKnowIsEmpty } from "../good-to-know.ts";
import { CLOSED_TEXT } from "../hours.ts";

/** One row of the list: a few lines the page builds (`list`) or one text the studio wrote. */
type Item = { label: string; list?: ReactNode; text?: string };

/**
 * The Good to know section (TAT-128): the hours, closed days, walk-ins, age
 * rule and deposit policy as a list, then "Before your session" and
 * "Aftercare" folded in native <details> (long texts, no JavaScript). Each
 * part only when the studio filled it in; nothing at all when it filled in
 * nothing. Studio text is rendered as text.
 */
export function GoodToKnowSection({ view }: { view: GoodToKnowView }) {
	if (goodToKnowIsEmpty(view)) return null;
	const copy = studioCopy.goodToKnow;
	const items: Item[] = [];
	if (view.hours.length > 0) {
		items.push({
			label: copy.hours,
			list: (
				<KnowLines>
					{view.hours.map((line) => (
						<li key={line.days}>
							<span className="know-when">{line.days}</span>{" "}
							<span>{line.hours}</span>
						</li>
					))}
				</KnowLines>
			),
		});
	}
	if (view.closedDays.length > 0) {
		items.push({
			label: copy.closedDays,
			list: (
				<KnowLines>
					{view.closedDays.map((day, index) => (
						// The list never reorders in the browser: the index is stable.
						// biome-ignore lint/suspicious/noArrayIndexKey: two entries may read the same
						<li key={index}>
							<span className="know-when">{day.when}</span>{" "}
							{day.note ? (
								<span className="user-text" dir="auto">
									{day.note}
								</span>
							) : (
								<span>{CLOSED_TEXT}</span>
							)}
						</li>
					))}
				</KnowLines>
			),
		});
	}
	for (const [label, text] of [
		[copy.walkIns, view.walkIns],
		[copy.age, view.ageRule],
		[copy.deposit, view.depositPolicy],
	] as const) {
		if (text !== null) items.push({ label, text });
	}
	const folded = [
		[copy.beforeSession, view.beforeSession],
		[copy.aftercare, view.aftercare],
	] as const;
	return (
		<section
			id="good-to-know"
			className="section"
			aria-labelledby="good-to-know-title"
		>
			<h2 id="good-to-know-title" className="section-title">
				{copy.title}
			</h2>
			{items.length > 0 ? (
				<dl className="know-list">
					{items.map((item) => (
						<div key={item.label} className="know-item">
							<dt>{item.label}</dt>
							{item.text === undefined ? (
								<dd>{item.list}</dd>
							) : (
								<dd className="user-text" dir="auto">
									{item.text}
								</dd>
							)}
						</div>
					))}
				</dl>
			) : null}
			{folded.map(([label, text]) =>
				text === null ? null : (
					<details key={label} className="know-more">
						<summary>
							<span>{label}</span>
							<ChevronDown aria-hidden="true" />
						</summary>
						<p className="user-text measure" dir="auto">
							{text}
						</p>
					</details>
				),
			)}
		</section>
	);
}

/** A few lines of the list: a plain list with no bullets, so WebKit needs its role back. */
function KnowLines({ children }: { children: ReactNode }) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="know-lines" role="list">
			{children}
		</ul>
	);
}
