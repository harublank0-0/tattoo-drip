import type { ReactNode, Ref } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { fill } from "../../intake/copy.ts";
import { linkRel } from "../../studio/links.ts";
import { copy } from "../copy.ts";
import type { LoadProblem } from "../problems.ts";
import {
	type DepositContact,
	type DepositView,
	headingTemplate,
	type MethodView,
	payByLine,
	stateTemplate,
} from "../view-model.ts";
import { CopyButton } from "./copy-button.tsx";

/*
 * The deposit page's blocks (TAT-65b). Props only: no router or query hooks,
 * so test/deposit/render.test.ts renders them with react-dom/server. API
 * text renders as text, names inside sentences in <bdi> (<Fill>), user text
 * with dir="auto". No link here starts with "#": following one would
 * replace the token in the URL.
 */

/**
 * Around every state: one h1, and who runs the page. The h1 names the
 * deposit's state once it is read (TAT-106); before that, and while it is
 * due, it asks to pay the studio (headingTemplate).
 */
export function DepositFrame({
	studioName,
	view = null,
	children,
}: {
	studioName: string;
	/** The deposit, once read; null (or left out) while it loads and for a link that doesn't work. */
	view?: Pick<DepositView, "state" | "amount"> | null;
	children?: ReactNode;
}) {
	return (
		<>
			<main className="deposit">
				<h1 className="deposit-title">
					<Fill
						template={headingTemplate(view)}
						values={{ studio: studioName }}
					/>
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

/** Before the deposit arrives (and on the server, which never sees the token). */
export function DepositLoading({ studioName }: { studioName: string }) {
	return (
		<>
			<div className="deposit-skeleton" aria-busy="true">
				<p className="sr-only">{copy.loading}</p>
				<span
					className="deposit-skeleton-line deposit-skeleton-amount"
					aria-hidden="true"
				/>
				<span className="deposit-skeleton-line" aria-hidden="true" />
				<span
					className="deposit-skeleton-line deposit-skeleton-short"
					aria-hidden="true"
				/>
			</div>
			<noscript>
				<p className="deposit-note">
					<Fill template={copy.noScript} values={{ studio: studioName }} />
				</p>
			</noscript>
		</>
	);
}

/**
 * A link that doesn't work, a rate limit, or a read that failed (TAT-65's
 * words). While Try again runs (`retrying`) the message and the button stay,
 * so focus isn't lost; the button is `aria-disabled` and a polite status says
 * what is happening. `failures` changes with every failed read, so a repeated
 * failure is a new alert and is announced again.
 */
export function LoadProblemView({
	problem,
	onRetry,
	retrying = false,
	failures = 0,
	ref,
}: {
	problem: LoadProblem;
	onRetry?: () => void;
	retrying?: boolean;
	failures?: number;
	ref?: Ref<HTMLParagraphElement>;
}) {
	const retryable = problem === "failed" && onRetry;
	return (
		<div className="deposit-state">
			<p
				key={failures}
				ref={ref}
				className="deposit-state-title"
				role="alert"
				tabIndex={-1}
			>
				{copy.load[problem]}
			</p>
			{retryable ? (
				<>
					<button
						type="button"
						className="action action-secondary"
						aria-disabled={retrying ? true : undefined}
						onClick={() => {
							if (!retrying) onRetry();
						}}
					>
						{retrying ? copy.load.retrying : copy.load.retry}
					</button>
					<p className="deposit-send-status" aria-live="polite">
						{retrying ? copy.loading : ""}
					</p>
				</>
			) : null}
		</div>
	);
}

/**
 * The state message's polite live region (spec ruling 18): a change that
 * arrives on its own (the tab regains focus and the studio has decided) is
 * announced. `quiet` while the client's own Send is on its way: the message
 * then takes focus, which announces it, and a live region would say it a
 * second time. Empty, it takes no space but stays in the accessibility tree.
 */
export function StateRegion({
	quiet = false,
	children,
}: {
	quiet?: boolean;
	children?: ReactNode;
}) {
	return (
		<div className="deposit-live" aria-live={quiet ? "off" : "polite"}>
			{children}
		</div>
	);
}

/** The brief (folded when long, spec ruling 10) and the artist. */
export function DepositIntro({ view }: { view: DepositView }) {
	if (!view.brief && !view.artistName) return null;
	return (
		<div className="deposit-intro">
			{view.brief ? (
				view.briefLong ? (
					<details className="deposit-brief">
						<summary>{copy.briefSummary}</summary>
						<p className="user-text" dir="auto">
							{view.brief}
						</p>
					</details>
				) : (
					<p className="user-text" dir="auto">
						{view.brief}
					</p>
				)
			) : null}
			{view.artistName ? (
				<p className="deposit-muted">
					<Fill
						template={copy.withArtist}
						values={{ artist: view.artistName }}
					/>
				</p>
			) : null}
		</div>
	);
}

/** Every state but `due`: its sentence (focusable: focus moves here after a send), and for `submitted` the amount and code. */
export function StateMessage({
	view,
	studioName,
	received,
	ref,
}: {
	view: DepositView;
	studioName: string;
	received: string | null;
	ref?: Ref<HTMLParagraphElement>;
}) {
	return (
		<div className="deposit-state">
			<p ref={ref} className="deposit-state-title" tabIndex={-1}>
				<Fill
					template={stateTemplate(view, received)}
					values={{ studio: studioName, date: received ?? "" }}
				/>
			</p>
			{view.state === "submitted" ? (
				<dl className="deposit-details">
					<dt>{copy.states.amount}</dt>
					<dd translate="no">{view.dueText}</dd>
					<dt>{copy.code.title}</dt>
					<dd className="deposit-number" translate="no">
						{view.referenceCode}
					</dd>
				</dl>
			) : null}
		</div>
	);
}

/** `due`: the amount, the code, how to pay, the policy, then `form` (the screenshot form, or nothing). */
export function DueView({
	view,
	studioName,
	today,
	form,
}: {
	view: DepositView;
	studioName: string;
	today: string | null;
	form: ReactNode;
}) {
	const firstQr = view.methods.find((method) => method.qr)?.id ?? null;
	return (
		<>
			<section className="deposit-block" aria-labelledby="deposit-due-title">
				<h2 id="deposit-due-title">{copy.due.title}</h2>
				<p className="deposit-amount" translate="no">
					{view.dueText}
				</p>
				{view.partial ? (
					<p>{fill(copy.due.partial, { amount: view.amountText })}</p>
				) : null}
				<p>{payByLine(view, today)}</p>
			</section>
			<section className="deposit-block" aria-labelledby="deposit-code-title">
				<h2 id="deposit-code-title">{copy.code.title}</h2>
				<div className="deposit-code-row">
					<p className="deposit-code" translate="no">
						{view.referenceCode}
					</p>
					<CopyButton
						text={view.referenceCode}
						label={fill(copy.code.copyLabel, { code: view.referenceCode })}
						visible={copy.code.copy}
					/>
				</div>
				<p>{copy.code.hint}</p>
			</section>
			{view.methods.length > 0 ? (
				<section
					className="deposit-block"
					aria-labelledby="deposit-methods-title"
				>
					<h2 id="deposit-methods-title">{copy.methods.title}</h2>
					{firstQr ? (
						<p className="deposit-muted">{copy.methods.samePhone}</p>
					) : null}
					<ul className="deposit-methods">
						{view.methods.map((method) => (
							<li key={method.id} className="deposit-method">
								<MethodCard
									method={method}
									studioName={studioName}
									eager={method.id === firstQr}
								/>
							</li>
						))}
					</ul>
				</section>
			) : (
				<p className="deposit-note">{copy.methods.none}</p>
			)}
			{view.policy ? (
				<section
					className="deposit-block"
					aria-labelledby="deposit-policy-title"
				>
					<h2 id="deposit-policy-title">{copy.policyTitle}</h2>
					<p className="user-text" dir="auto">
						{view.policy}
					</p>
				</section>
			) : null}
			{form}
		</>
	);
}

/** One way to pay: its label, its QR (a square reserved while it loads), its details. */
export function MethodCard({
	method,
	studioName,
	eager,
}: {
	method: MethodView;
	studioName: string;
	eager: boolean;
}) {
	const hasDetails = Boolean(
		method.bankName || method.accountName || method.accountNumber,
	);
	return (
		<>
			<h3 dir="auto">{method.label}</h3>
			{method.qr ? (
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
						loading={eager ? "eager" : "lazy"}
						decoding="async"
						referrerPolicy="no-referrer"
					/>
					<figcaption>{copy.methods.scan[method.kind]}</figcaption>
				</figure>
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
		</>
	);
}

/** The studio's chat links, under every state (spec ruling 9). */
export function ContactLine({
	studioName,
	contact,
}: {
	studioName: string;
	contact: DepositContact;
}) {
	const links = [
		contact.whatsapp ? { href: contact.whatsapp, label: copy.whatsapp } : null,
		contact.viber ? { href: contact.viber, label: copy.viber } : null,
	].filter((link) => link !== null);
	if (links.length === 0) return null;
	return (
		<p className="deposit-contact">
			<span>
				<Fill template={copy.contact} values={{ studio: studioName }} />
			</span>
			{links.map((link) => (
				<a
					key={link.href}
					className="text-link"
					href={link.href}
					rel={linkRel(link.href)}
				>
					{link.label}
				</a>
			))}
		</p>
	);
}
