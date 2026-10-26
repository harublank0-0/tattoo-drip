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
