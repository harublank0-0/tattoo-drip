/**
 * The project page's own rules that need no React (TAT-108): the progress line, which element
 * carries which anchor id, and how the Next step card lays out its actions. A plain module so a
 * unit test loads it (docs/testing.md, Dashboard unit tests).
 */

export const PROGRESS_STEPS = [
	"Review",
	"Quote",
	"Deposit",
	"Sessions",
	"Done",
] as const;
export type StepState = "done" | "current" | "todo";

/** The step each status stands on; a completed project is past the last one. */
const AT: Record<string, number> = {
	reviewing: 0,
	quoted: 1,
	on_hold: 1,
	deposit_pending: 2,
	booked: 3,
	in_progress: 3,
	healing_check: 4,
	completed: 5,
};

/**
 * The progress line for a status: the five steps, the earlier ones done and the one it stands on
 * current. Null for declined and cancelled (we don't store how far a withdrawn project got, so a
 * line would guess) and for anything unknown.
 */
export function progressOf(
	status: string,
): { label: string; state: StepState }[] | null {
	const at = Object.hasOwn(AT, status) ? AT[status] : undefined;
	if (at === undefined) return null;
	return PROGRESS_STEPS.map((label, index) => ({
		label,
		state: index < at ? "done" : index === at ? "current" : "todo",
	}));
}

/**
 * The ids Today's rows, the Projects list's lines and the deposit-screenshot alert link to
 * (`WAITING_HASH` on the server, plus `payments`). Each appears once on the page.
 */
export const CARD_IDS = [
	"payments",
	"quote",
	"quote-form",
	"deposit",
	"sessions",
] as const;
export type CardId = (typeof CARD_IDS)[number];

/**
 * An element's own anchor id, unless the Next step card carries it: the card with the anchor
 * `nextStep.anchor` takes the id, so a link lands on the card that holds the action.
 */
export function cardId(id: CardId, anchor: string | null): CardId | undefined {
	return anchor === id ? undefined : id;
}

type Step = { primary: string | null; secondary: string[] };

/** The Next step card offers `action`, as its main action or a secondary one. */
export function offers(step: Step, action: string): boolean {
	return step.primary === action || step.secondary.includes(action);
}

/** The actions that draw a form or a panel of their own; the rest are buttons. */
const BLOCKS = [
	"verify_proof",
	"issue_quote",
	"send_quote",
	"deposit_link",
	"finish",
	"record_outcome",
];

/** The card's secondary actions: blocks first-class on their own, buttons in one row. */
export function layoutOf(step: Step) {
	return {
		primary: step.primary,
		blocks: step.secondary.filter((action) => BLOCKS.includes(action)),
		buttons: step.secondary.filter((action) => !BLOCKS.includes(action)),
	};
}

/**
 * Everything a person can do on the project page, by name: the Next step's actions and the cards'
 * own controls. `placementsOf` says where each is drawn, so nothing the page offers can vanish
 * because the Next step card did not name it.
 */
export const AFFORDANCES = [
	"issue_quote",
	"send_quote",
	"client_accepted",
	"revise_quote",
	"set_price",
	"deposit_link",
	"verify_proof",
	"record_outcome",
	"record_payment",
	"record_refund",
	"schedule",
	"finish",
	"resume",
	"hold",
	"withdraw",
	"decline",
	"assign_artist",
	"mark_contacted",
] as const;
export type Affordance = (typeof AFFORDANCES)[number];
/** In the Next step card, in the card that owns the control, or nowhere. */
export type Placement = "step" | "card" | null;

/** What the project page knows (its props): the same flags the cards read. */
export type PageFacts = {
	nextStep: Step & { anchor: string | null };
	closed: boolean;
	canQuote: boolean;
	canAccept: boolean;
	canSetPrice: boolean;
	quote: unknown;
	message: unknown;
	deposit: unknown;
	scheduling: unknown;
	finish: unknown;
	moves: readonly string[];
	assignment: unknown;
	/** Null for an artist: they are sent no money. */
	payments: {
		pending: readonly unknown[];
		actions: {
			recordKinds: readonly unknown[];
			refundMax: number | null;
		} | null;
		outcome: { needed: unknown };
	} | null;
};

/**
 * Where each thing the page offers is drawn. An action the Next step names is drawn there (and
 * hidden from its own card, so two identical buttons never sit side by side); an action the step
 * does not name, but the page offers (the quote's message while a project is on hold, Accept and the
 * deposit panel while a screenshot waits), is drawn by the card that owns it. Only the finish panel
 * has no card: while a session is scheduled the step is that session, and finishing is refused then
 * anyway (`session_scheduled`), so the panel is dropped on purpose.
 */
export function placementsOf(page: PageFacts): Record<Affordance, Placement> {
	const { nextStep, payments } = page;
	const has = (value: unknown) => value !== null && value !== undefined;
	const actions = payments?.actions ?? null;
	const where = (
		available: boolean,
		action: string,
		home: Placement = "card",
	): Placement =>
		!available ? null : offers(nextStep, action) ? "step" : home;
	const quoted = has(page.quote);
	return {
		issue_quote: where(page.canQuote && !quoted, "issue_quote"),
		send_quote: where(has(page.message), "send_quote"),
		client_accepted: where(page.canAccept && quoted, "client_accepted"),
		revise_quote: where(page.canQuote && quoted, "revise_quote"),
		set_price: page.canSetPrice ? "card" : null,
		deposit_link: where(has(page.deposit), "deposit_link"),
		verify_proof: where((payments?.pending.length ?? 0) > 0, "verify_proof"),
		record_outcome: where(has(payments?.outcome.needed), "record_outcome"),
		record_payment: where(
			(actions?.recordKinds.length ?? 0) > 0,
			"record_payment",
		),
		record_refund: has(actions?.refundMax) ? "card" : null,
		schedule: where(has(page.scheduling), "schedule"),
		finish: where(has(page.finish), "finish", null),
		resume: where(page.moves.includes("resume"), "resume"),
		hold: page.moves.includes("hold") ? "card" : null,
		withdraw: page.moves.includes("withdraw") ? "card" : null,
		decline: page.moves.includes("decline") ? "card" : null,
		assign_artist: has(page.assignment) ? "card" : null,
		mark_contacted: page.closed ? null : "card",
	};
}

/**
 * The element ids the page carries, each once (`cardId` and the Next step's `anchor`): the targets
 * Today's rows, the Projects list's lines and the alert's link can name. The Payments card is the
 * owner's; an artist has none, so `#payments` is not on their page.
 */
export function idsOnPage(page: PageFacts): string[] {
	const place = placementsOf(page);
	const { anchor } = page.nextStep;
	const ids: (string | null | undefined)[] = [
		anchor,
		page.payments ? cardId("payments", anchor) : null,
		cardId("quote", anchor),
		place.revise_quote || place.issue_quote
			? cardId("quote-form", anchor)
			: null,
		place.deposit_link ? cardId("deposit", anchor) : null,
		cardId("sessions", anchor),
	];
	return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}
