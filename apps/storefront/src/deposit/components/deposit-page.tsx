import type { ReactNode, Ref } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { fill } from "../../intake/template.ts";
import { linkRel } from "../../studio/links.ts";
import type { BrandImage } from "../../studio/theme/config.ts";
import { copy } from "../copy.ts";
import type { LoadProblem } from "../problems.ts";
import {
	type DepositContact,
	type DepositView,
	headingTemplate,
	type MethodView,
	payByLine,
	receiptAmount,
	stateTemplate,
	studioInitial,
} from "../view-model.ts";
import { CopyButton } from "./copy-button.tsx";
import { MethodPanel, PayWith, StepHeading } from "./steps.tsx";

/*
 * The deposit page's blocks (TAT-65b). Props only: no router or query hooks,
 * so test/deposit/render.test.ts renders them with react-dom/server. API
 * text renders as text, names inside sentences in <bdi> (<Fill>), user text
 * with dir="auto". No link here starts with "#": following one would
 * replace the token in the URL.
 */

/**
 * Around every state: one h1, and who runs the page. The h1 names the
 * deposit's state once it is read (TAT-106) and says what a load problem's
 * message says (TAT-119); while it loads, and while it is due, it asks to pay
 * the studio (headingTemplate).
 */
export function DepositFrame({
	studioName,
	logo = null,
	artistName = null,
	view = null,
	problem = null,
	children,
}: {
	studioName: string;
	/** The studio's checked logo (DepositShell.logo), or null for its initial. */
	logo?: BrandImage | null;
	/** The project's artist, once the deposit is read. */
	artistName?: string | null;
	/** The deposit, once read; null (or left out) while it loads. */
	view?: Pick<DepositView, "state" | "amount"> | null;
	/** A link that doesn't work, a rate limit or a failed read: the h1 matches it. */
	problem?: LoadProblem | null;
	children?: ReactNode;
}) {
	return (
		<>
			<main className="deposit">
				<DepositHeader
					studioName={studioName}
					logo={logo}
					artistName={artistName}
				/>
				<h1 className="deposit-title">
					<Fill
						template={headingTemplate(view, problem)}
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

/**
 * Who the page is for (TAT-110): the studio's mark and name, then the
 * project's artist once the deposit is read. The mark is the studio's checked
 * logo (decoration: its name is beside it, so `alt` is empty), else the first
 * user-perceived character of its name, never the cover. Server-rendered.
 */
function DepositHeader({
	studioName,
	logo,
	artistName,
}: {
	studioName: string;
	logo: BrandImage | null;
	artistName: string | null;
}) {
	return (
		<header className="deposit-header">
			{logo ? (
				<img
					className="deposit-logo"
					src={logo.src}
					width={logo.width}
					height={logo.height}
					alt=""
					decoding="async"
					fetchPriority="low"
					referrerPolicy="no-referrer"
				/>
			) : (
				<span className="deposit-mark" aria-hidden="true">
					{studioInitial(studioName)}
				</span>
			)}
			<div className="deposit-header-text">
				<p className="deposit-studio" dir="auto">
					{studioName}
				</p>
				{artistName ? (
					<p className="deposit-muted">
						<Fill template={copy.withArtist} values={{ artist: artistName }} />
					</p>
				) : null}
			</div>
		</header>
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

/** The brief, folded when long (spec ruling 10). The artist is in the header (TAT-110). */
export function DepositIntro({ view }: { view: DepositView }) {
	if (!view.brief) return null;
	return (
		<div className="deposit-intro">
			{view.briefLong ? (
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
			)}
		</div>
	);
}

/** Every state but `due`: its sentence (focusable: focus moves here after a send), and for `submitted` and a paid deposit the amount and code (receiptAmount). */
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
	const amount = receiptAmount(view);
	return (
		<div className="deposit-state">
			<p ref={ref} className="deposit-state-title" tabIndex={-1}>
				<Fill
					template={stateTemplate(view, received)}
					values={{ studio: studioName, date: received ?? "" }}
				/>
			</p>
			{amount !== null ? (
				<dl className="deposit-details">
					<dt>{copy.states.amount}</dt>
					<dd translate="no">{amount}</dd>
					<dt>{copy.code.title}</dt>
					<dd className="deposit-number" translate="no">
						{view.referenceCode}
					</dd>
				</dl>
			) : null}
		</div>
	);
}

/**
 * `due` (TAT-110): the amount and who it goes to, then three numbered steps,
 * the first two here (copy the code, pay) and the third in `form` (the
 * screenshot form, or nothing), then the policy. The picked method's panel is
 * a sibling of the steps, so a desktop can set it beside them (styles.css).
 */
export function DueView({
	view,
	studioName,
	today,
	selected,
	onSelect,
	form,
}: {
	view: DepositView;
	studioName: string;
	today: string | null;
	/** The method whose QR and details show (selectedMethod), or null without methods. */
	selected: MethodView | null;
	onSelect(id: string): void;
	form: ReactNode;
}) {
	return (
		<div className="deposit-due">
			<section
				className="deposit-block deposit-due-amount"
				aria-labelledby="deposit-due-title"
			>
				<h2 id="deposit-due-title" className="sr-only">
					{copy.due.title}
				</h2>
				<p className="deposit-amount" translate="no">
					{view.dueText}
				</p>
				{view.partial ? (
					<p>{fill(copy.due.partial, { amount: view.amountText })}</p>
				) : null}
				<p>{payByLine(view, today)}</p>
				<p className="deposit-muted">
					<Fill template={copy.due.direct} values={{ studio: studioName }} />
				</p>
			</section>
			<section
				className="deposit-block deposit-due-code"
				aria-labelledby="deposit-code-title"
			>
				<StepHeading step={1} id="deposit-code-title">
					{copy.steps.code}
				</StepHeading>
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
			<section
				className="deposit-block deposit-due-pay"
				aria-labelledby="deposit-pay-title"
			>
				<StepHeading step={2} id="deposit-pay-title">
					{copy.steps.pay}
				</StepHeading>
				{selected ? (
					<PayWith
						methods={view.methods}
						selected={selected}
						onSelect={onSelect}
					/>
				) : (
					<p className="deposit-note">{copy.methods.none}</p>
				)}
			</section>
			{selected ? (
				<MethodPanel
					key={selected.id}
					method={selected}
					single={view.methods.length === 1}
					studioName={studioName}
				/>
			) : null}
			{form}
			{view.policy ? (
				<section
					className="deposit-block deposit-due-policy"
					aria-labelledby="deposit-policy-title"
				>
					<h2 id="deposit-policy-title">{copy.policyTitle}</h2>
					<p className="user-text" dir="auto">
						{view.policy}
					</p>
				</section>
			) : null}
		</div>
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
