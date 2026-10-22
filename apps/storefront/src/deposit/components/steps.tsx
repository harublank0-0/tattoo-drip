import { ArrowDown } from "lucide-react";
import type { ReactNode } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { fill } from "../../intake/template.ts";
import { showProofStep } from "../browser.ts";
import { copy } from "../copy.ts";
import type { MethodView } from "../view-model.ts";
import { CopyButton } from "./copy-button.tsx";

/*
 * The deposit page's steps (TAT-110): a numbered heading, the Pay with group
 * and the picked method's panel. Props only, like deposit-page.tsx, so the
 * render tests can use react-dom/server. Nothing here links to "#".
 */

/**
 * A step's h2: the numeral is decoration (a square like the studio page's
 * steps), and "Step N: " is for screen readers, so the heading reads the same
 * to everyone. `focusable` lets the "I've paid" button move focus here.
 */
export function StepHeading({
	step,
	id,
	focusable = false,
	children,
}: {
	step: number;
	id: string;
	focusable?: boolean;
	children: ReactNode;
}) {
	return (
		<h2
			id={id}
			className="deposit-step-title"
			tabIndex={focusable ? -1 : undefined}
		>
			<span className="deposit-step-number" aria-hidden="true">
				{step}
			</span>
			<span className="sr-only">{fill(copy.steps.label, { count: step })}</span>
			{children}
		</h2>
	);
}

/**
 * Which way the client pays, as native radios in one group, outside the
 * screenshot form (Enter can send nothing from here). Arrow keys move and
 * select. The radio dot stays visible: the choice never relies on colour
 * alone. Two or more methods; one needs no choice.
 */
export function PayWith({
	methods,
	selected,
	onSelect,
}: {
	methods: readonly MethodView[];
	selected: MethodView;
	onSelect(id: string): void;
}) {
	if (methods.length < 2) return null;
	return (
		<fieldset className="deposit-paywith">
			<legend className="sr-only">{copy.payWith.legend}</legend>
			<div className="deposit-paywith-options">
				{methods.map((method, index) => (
					<label key={method.id} className="deposit-paywith-option">
						<input
							type="radio"
							name="pay-with"
							id={`pay-with-${index}`}
							value={method.id}
							checked={method.id === selected.id}
							onChange={() => onSelect(method.id)}
							// Tapping the method that already shows fires no change event, and it
							// is still the client saying how they pay.
							onClick={() => {
								if (method.id === selected.id) onSelect(method.id);
							}}
						/>
						<span dir="auto">{method.label}</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}

/**
 * "I've paid": a button that takes the client to step 3. On a phone it sticks
 * to the bottom of the screen while they are in steps 1 and 2, and settles in
 * its own place, above step 3, when they get there (styles.css); on a desktop
 * the QR sits beside the steps and the bar is hidden. Secondary, so Send is
 * the one primary action. A button, never a link to "#proof-title".
 */
export function PaidBar() {
	return (
		<div className="deposit-paid-bar">
			<button
				type="button"
				className="action action-secondary"
				onClick={showProofStep}
			>
				<ArrowDown aria-hidden="true" className="size-5" />
				{copy.paidButton}
			</button>
		</div>
	);
}

/**
 * The picked method: its QR (a square reserved while it loads), what to do
 * with it, and its details. The caller keys it by the method's identity and
 * QR, so a switch makes a fresh image (the previous QR never shows while the next one
 * loads: scanning the wrong code is the worst thing this page can do) and a
 * fresh Copy button (no "Copied" beside another method's number).
 */
export function MethodPanel({
	method,
	single,
	studioName,
}: {
	method: MethodView;
	/** The studio lists only this one: no chips, so the panel says what it is. */
	single: boolean;
	studioName: string;
}) {
	const hasDetails = Boolean(
		method.bankName || method.accountName || method.accountNumber,
	);
	return (
		<div className="deposit-method-panel">
			{single ? (
				<p className="deposit-pay-single" dir="auto">
					<Fill template={copy.payWith.only} values={{ label: method.label }} />
				</p>
			) : null}
			{method.qr ? (
				<>
					<figure className="deposit-qr-figure">
						<img
							className="deposit-qr"
							src={method.qr}
							alt={fill(copy.methods.qrAlt, {
								label: method.label,
								studio: studioName,
							})}
							width={280}
							height={280}
							loading="eager"
							decoding="async"
							referrerPolicy="no-referrer"
						/>
						<figcaption>{copy.methods.scan[method.kind]}</figcaption>
					</figure>
					<p className="deposit-muted deposit-same-phone">
						{copy.methods.samePhone}
					</p>
				</>
			) : null}
			{hasDetails ? (
				<dl className="deposit-details">
					{method.bankName ? (
						<>
							<dt>{copy.methods.bankName}</dt>
							<dd dir="auto">{method.bankName}</dd>
						</>
					) : null}
					{method.accountName ? (
						<>
							<dt>{copy.methods.accountName}</dt>
							<dd dir="auto">{method.accountName}</dd>
						</>
					) : null}
					{method.accountNumber ? (
						<>
							<dt>{copy.methods.accountNumber[method.kind]}</dt>
							<dd>
								<span className="deposit-number" translate="no">
									{method.accountNumber}
								</span>
								<CopyButton
									text={method.accountNumber}
									label={fill(copy.methods.copyLabel, {
										number: method.accountNumber,
									})}
									visible={copy.methods.copy}
								/>
							</dd>
						</>
					) : null}
				</dl>
			) : null}
			{!method.qr && !hasDetails ? (
				<p className="deposit-note">
					<Fill
						template={copy.methods.missing}
						values={{ studio: studioName }}
					/>
				</p>
			) : null}
		</div>
	);
}
