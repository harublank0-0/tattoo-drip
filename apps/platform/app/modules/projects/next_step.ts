import type { DateTime } from "luxon";
import { firstName } from "#modules/notifications/messages";
import { expiryCancels } from "#modules/projects/expiry";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { isExpired } from "#modules/projects/quotes";
import type { Waiting, WaitingFacts } from "#modules/projects/waiting";

/**
 * The project page's Next step card (TAT-108): one step per project. When something waits, it is
 * that reason's step, chosen by waitingOf through WaitingService.forProjects, the rules Today and
 * the Projects list use, so the three never disagree; the card carries the reason's WAITING_HASH.
 * When nothing waits, the status decides. Pure: ProjectsController.show gathers the facts.
 */

/** What the card can hold; the page draws each with the component that already does it. */
export const NEXT_STEP_ACTIONS = [
	"verify_proof",
	"issue_quote",
	"send_quote",
	"client_accepted",
	"revise_quote",
	"resume",
	"deposit_link",
	"record_payment",
	"schedule",
	"open_sessions",
	"finish",
	"record_outcome",
] as const;
export type NextStepAction = (typeof NEXT_STEP_ACTIONS)[number];

export type NextStepKind =
	| "check_proof"
	| "send_price"
	| "price_ending"
	| "deposit_ending"
	| "make_link"
	| "chase_deposit"
	| "book_session"
	| "await_answer"
	| "on_hold"
	| "link_sent"
	| "await_deposit"
	| "price_ended"
	| "record_session"
	| "next_session"
	| "finish"
	| "more_sessions"
	| "healing_check"
	| "collect_balance"
	| "record_outcome"
	| "closed"
	| "nothing";

export type NextStep = {
	kind: NextStepKind;
	title: string;
	text: string | null;
	/** The one main action, or null when there is nothing to do here. */
	primary: NextStepAction | null;
	secondary: NextStepAction[];
	/** The id the card carries, so Today's and the list's links land on it; null for none. */
	anchor: string | null;
	/** It waits on the studio (waiting.side "studio"): the marigold dot. */
	needsYou: boolean;
};

/** A session as the card names it: "Sat 24 Oct, 11:00" and its artist. */
export type SessionLine = { startText: string; artistName: string | null };

export type NextStepFacts = {
	status: ProjectStatus;
	/** WaitingService.forProjects' answer for this project. */
	waiting: Waiting | null;
	/** Its words (waitingText), null when nothing waits. */
	waitingText: string | null;
	/** Its card (WAITING_HASH), null when nothing waits or the reason has none. */
	waitingHash: string | null;
	clientName: string | null;
	/** The expired quote's sweep will cancel the project (sweepWillCancel). */
	sweepWillCancel: boolean;
	/** The earliest scheduled session that has not started. */
	nextSession: SessionLine | null;
	/** A scheduled session that has started and this member may record. */
	startedSession: SessionLine | null;
	/** Owners: a finished project's fixed price still owed ("NPR 15,000"), else null. */
	balanceOwedText: string | null;
	/** What the page can offer this member now: the same flags its cards use. */
	can: Record<NextStepAction, boolean>;
};

const WITH_SESSION: readonly ProjectStatus[] = [
	"booked",
	"in_progress",
	"deposit_pending",
];

/**
 * Whether the expiry sweep will cancel the project for its expired quote: the one case in which
 * waitingOf returns null on purpose (its rule, from the same facts).
 */
export function sweepWillCancel(facts: WaitingFacts, now: DateTime): boolean {
	const { quote } = facts;
	if (!quote || !isExpired(quote, now) || facts.expirySpared) return false;
	return expiryCancels({
		status: facts.status,
		depositAmount: quote.depositAmount,
		depositSettled: facts.depositSettled,
	});
}

const withArtist = ({ startText, artistName }: SessionLine) =>
	artistName ? `${startText} with ${artistName}` : startText;

export function nextStepOf(facts: NextStepFacts): NextStep {
	const { status, waiting, can } = facts;
	const name = firstName(facts.clientName ?? "") || "the client";
	const said = `${facts.waitingText ?? ""}.`;
	const step = (
		kind: NextStepKind,
		title: string,
		text: string | null,
		primary: NextStepAction[],
		secondary: NextStepAction[] = [],
		anchor: string | null = null,
	): NextStep => {
		const first = primary.find((action) => can[action]) ?? null;
		return {
			kind,
			title,
			text,
			primary: first,
			secondary: secondary.filter((action) => action !== first && can[action]),
			anchor,
			needsYou: waiting?.side === "studio",
		};
	};

	if (waiting) {
		const anchor = facts.waitingHash;
		switch (waiting.reason) {
			case "proof_to_check":
				return step(
					"check_proof",
					"Check the deposit screenshot",
					status === "cancelled"
						? "The client withdrew while this screenshot waited. Verify or reject it so the money is recorded right."
						: "Verify it only if the money reached your account.",
					["verify_proof"],
					[],
					anchor,
				);
			case "price_to_send":
				return step(
					"send_price",
					`Send ${name} a price`,
					said,
					["issue_quote"],
					[],
					anchor,
				);
			case "quote_ending":
				if (status === "on_hold") {
					return step(
						"price_ending",
						"Resume, or give more time",
						`On hold. ${facts.waitingText ?? "The price ends soon"}, and then the project is cancelled.`,
						["resume"],
						["revise_quote"],
						anchor,
					);
				}
				if (status === "deposit_pending") {
					return step(
						"deposit_ending",
						can.deposit_link
							? `Remind ${name} about the deposit`
							: "Waiting for the deposit",
						`${said} If it isn't paid by then, the project is cancelled.`,
						["deposit_link"],
						["record_payment", "revise_quote"],
						anchor,
					);
				}
				return step(
					"price_ending",
					`Remind ${name} before the price ends`,
					`${said} If ${name} hasn't said yes by then, the project is cancelled.`,
					["send_quote", "client_accepted"],
					["client_accepted", "revise_quote"],
					anchor,
				);
			case "deposit_link_missing":
				return step(
					"make_link",
					"Send the deposit link",
					said,
					["deposit_link"],
					["record_payment"],
					anchor,
				);
			case "deposit_unpaid":
				return step(
					"chase_deposit",
					`Remind ${name} about the deposit`,
					said,
					["deposit_link"],
					["record_payment"],
					anchor,
				);
			case "no_session":
				return step(
					"book_session",
					"Book the tattoo session",
					said,
					["schedule"],
					[],
					anchor,
				);
			case "price_sent":
				return step(
					"await_answer",
					`Waiting for ${name} to answer`,
					said,
					["client_accepted"],
					["send_quote", "revise_quote"],
					anchor,
				);
			case "on_hold":
				return step(
					"on_hold",
					"On hold",
					`Resume the project when ${name} is ready.`,
					["resume"],
					["revise_quote"],
					anchor,
				);
			case "deposit_link_sent":
				return step(
					"link_sent",
					"Waiting for the deposit",
					said,
					["deposit_link"],
					["record_payment"],
					anchor,
				);
			case "deposit_due":
				return step(
					"await_deposit",
					"Waiting for the deposit",
					"An owner records it when it is paid.",
					[],
					[],
					anchor,
				);
		}
	}

	if (facts.sweepWillCancel) {
		return step(
			"price_ended",
			"The price has ended",
			"Send a new price, or the project is cancelled within minutes.",
			["revise_quote"],
		);
	}
	if (facts.startedSession) {
		return step(
			"record_session",
			"How did the session go?",
			`${withArtist(facts.startedSession)} has started. Record it under Sessions: done, no-show or cancelled.`,
			["open_sessions"],
		);
	}
	if (facts.nextSession && WITH_SESSION.includes(status)) {
		const { startText, artistName } = facts.nextSession;
		return step(
			"next_session",
			`Next session: ${startText}`,
			artistName ? `With ${artistName}.` : null,
			[],
		);
	}
	switch (status) {
		case "in_progress":
			return can.finish
				? step("finish", "Finish the tattoo", null, ["finish"], ["schedule"])
				: step(
						"more_sessions",
						"Schedule the next session",
						"When the tattoo is done, an owner marks it finished.",
						["schedule"],
					);
		case "healing_check":
			return step(
				"healing_check",
				"Healing check",
				null,
				["finish"],
				facts.balanceOwedText ? ["record_payment", "schedule"] : ["schedule"],
			);
		case "completed":
			return facts.balanceOwedText
				? step(
						"collect_balance",
						`${facts.balanceOwedText} still due`,
						`The tattoo is finished. Record the payment when ${name} pays.`,
						["record_payment"],
						[],
						"payments",
					)
				: step(
						"closed",
						"Completed",
						"Nothing left to do. The project stays here for your records.",
						[],
					);
		case "declined":
		case "cancelled":
			return can.record_outcome
				? step(
						"record_outcome",
						"Record whether the deposit was kept or refunded",
						null,
						["record_outcome"],
						[],
						"payments",
					)
				: step(
						"closed",
						status === "declined" ? "Declined" : "Cancelled",
						"This project is closed.",
						[],
					);
		default:
			return step("nothing", "Nothing to do right now", null, []);
	}
}
