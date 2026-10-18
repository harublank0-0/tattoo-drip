import type { ReactNode, Ref } from "react";
import type { InquiryChannels } from "../../studio/inquiry.ts";
import { linkRel } from "../../studio/links.ts";
import { copy, fill } from "../copy.ts";
import { noticeValues, type SubmitProblem } from "../problems.ts";
import { formatBytes } from "../references.ts";
import { Fill } from "./fill.tsx";

/** What the form is doing, for the status line under Send. */
export type FormPhase =
	| "idle"
	| "preparing"
	| "checking"
	| "interactive"
	| "sending";

export type NoticeProblem = Extract<SubmitProblem, { kind: "notice" }>;

/** One line of the error summary: the control it focuses, the field's name, the message. */
export interface SummaryItem {
	readonly target: string;
	readonly label: ReactNode;
	readonly message: string;
}

export function hasChannels(channels: InquiryChannels): boolean {
	return Boolean(channels.whatsapp || channels.email || channels.instagram);
}

/** The studio's chat links (TAT-48's InquiryChannels): the way on when the form can't help. */
export function ChatLinks({ channels }: { channels: InquiryChannels }) {
	const links: { href: string; label: string }[] = [];
	if (channels.whatsapp) {
		links.push({ href: channels.whatsapp, label: copy.chatLinks.whatsapp });
	}
	if (channels.email) {
		links.push({ href: channels.email, label: copy.chatLinks.email });
	}
	if (channels.instagram) {
		links.push({ href: channels.instagram, label: copy.chatLinks.instagram });
	}
	if (links.length === 0) return null;
	return (
		<span className="intake-chat-links">
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
		</span>
	);
}

/** Every answer to fix, each linking to its control. Focused after a refused send. */
export function ErrorSummary({
	items,
	ref,
}: {
	items: readonly SummaryItem[];
	ref?: Ref<HTMLElement>;
}) {
	return (
		<section
			ref={ref}
			id="intake-summary"
			className="intake-alert"
			tabIndex={-1}
			aria-labelledby="intake-summary-title"
		>
			<p id="intake-summary-title" className="intake-alert-title">
				{items.length === 1
					? copy.errors.summaryOne
					: fill(copy.errors.summaryMany, { count: items.length })}
			</p>
			<ul>
				{items.map((item) => (
					<li key={item.target}>
						<a
							href={`#${item.target}`}
							onClick={(event) => focusControl(event, item.target)}
						>
							{item.label}: {item.message}
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}

/** A summary link puts focus on its control, not just the scroll position. */
function focusControl(event: { preventDefault(): void }, id: string): void {
	const target = document.getElementById(id);
	if (!target) return;
	target.focus();
	if (document.activeElement === target) event.preventDefault();
}

/** A refusal the person can't fix in a field: what happened, and the way on. Focused when it appears. */
export function ProblemNotice({
	problem,
	studioName,
	channels,
	ref,
}: {
	problem: NoticeProblem;
	studioName: string;
	channels: InquiryChannels;
	ref?: Ref<HTMLElement>;
}) {
	const values = noticeValues(problem, studioName);
	const text = copy.notices[problem.code];
	return (
		<section
			ref={ref}
			id="intake-notice"
			className="intake-alert"
			tabIndex={-1}
			aria-labelledby="intake-notice-title"
		>
			<p id="intake-notice-title" className="intake-alert-title">
				<Fill template={text.title} values={values} />
			</p>
			<p>
				<Fill template={text.body} values={values} />
			</p>
			{problem.retry ? (
				<button type="submit" className="action action-secondary">
					{copy.sendAgain}
				</button>
			) : null}
			{problem.reload ? (
				<button
					type="button"
					className="action action-secondary"
					onClick={() => window.location.reload()}
				>
					{copy.reload}
				</button>
			) : null}
			{problem.contact && hasChannels(channels) ? (
				<ChatLinks channels={channels} />
			) : null}
		</section>
	);
}

/** The status line's words (spec ruling 7): no percentages, fetch can't report them. */
export function statusText(
	phase: FormPhase,
	slow: boolean,
	photoCount: number,
	bytes: number,
): string {
	switch (phase) {
		case "preparing":
			return copy.status.preparing;
		case "checking":
			return copy.status.checking;
		case "interactive":
			return copy.status.interactive;
		case "sending": {
			if (slow) return copy.status.stillSending;
			if (photoCount === 0) return copy.status.sending;
			const photos =
				photoCount === 1
					? copy.status.photoOne
					: fill(copy.status.photoMany, { count: photoCount });
			return fill(copy.status.sendingPhotos, {
				photos,
				size: formatBytes(bytes),
			});
		}
		case "idle":
			return "";
	}
}

export function SubmitStatus({
	phase,
	slow,
	photoCount,
	bytes,
}: {
	phase: FormPhase;
	slow: boolean;
	photoCount: number;
	bytes: number;
}) {
	return (
		<>
			{phase === "sending" ? (
				<div className="intake-progress" aria-hidden="true" />
			) : null}
			<p className="intake-status" aria-live="polite">
				{statusText(phase, slow, photoCount, bytes)}
			</p>
		</>
	);
}

/** What replaces the form once the inquiry is in (spec ruling 12). Its heading takes focus. */
export function IntakeSent({
	studioName,
	phone,
	channels,
	ref,
}: {
	studioName: string;
	phone: string;
	channels: InquiryChannels;
	ref?: Ref<HTMLHeadingElement>;
}) {
	return (
		<div className="intake-sent">
			<h3 ref={ref} className="intake-sent-title" tabIndex={-1}>
				{copy.sent.title}
			</h3>
			<p>
				<Fill
					template={copy.sent.body}
					values={{ studio: studioName, phone }}
				/>
			</p>
			{hasChannels(channels) ? (
				<p>
					{copy.sent.more} <ChatLinks channels={channels} />
				</p>
			) : null}
			<a className="text-link" href="/">
				{copy.sent.back}
			</a>
		</div>
	);
}
