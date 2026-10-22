import type { Ref } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { fill } from "../../intake/template.ts";
import { copy, type ProofNoticeCode } from "../copy.ts";
import {
	DEFAULT_WAIT_SECONDS,
	formatWait,
	type SummaryItem,
} from "../problems.ts";

/** A refusal after Send (spec ruling 17): fixed words, announced, shown above Send. */
export function ProofNoticeView({
	code,
	waitSeconds,
	studioName,
}: {
	code: ProofNoticeCode;
	waitSeconds: number | null;
	studioName: string;
}) {
	const text = copy.notices[code];
	const values = {
		studio: studioName,
		wait: formatWait(waitSeconds ?? DEFAULT_WAIT_SECONDS),
	};
	return (
		<div className="deposit-alert" role="alert">
			<p className="deposit-alert-title">
				<Fill template={text.title} values={values} />
			</p>
			{text.body ? (
				<p>
					<Fill template={text.body} values={values} />
				</p>
			) : null}
		</div>
	);
}

/**
 * What to fix before sending, focused after a refused Send. Its items are
 * buttons that focus the control: a "#field" link would replace the token
 * in the URL.
 */
export function ProofSummary({
	items,
	ref,
}: {
	items: readonly SummaryItem[];
	ref?: Ref<HTMLElement>;
}) {
	return (
		<section
			ref={ref}
			className="deposit-alert"
			tabIndex={-1}
			aria-labelledby="proof-summary-title"
		>
			<p id="proof-summary-title" className="deposit-alert-title">
				{items.length === 1
					? copy.form.summaryOne
					: fill(copy.form.summaryMany, { count: items.length })}
			</p>
			<ul>
				{items.map((item) => (
					<li key={item.target}>
						<button
							type="button"
							className="deposit-summary-link"
							onClick={() => document.getElementById(item.target)?.focus()}
						>
							{item.label}: {item.message}
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
