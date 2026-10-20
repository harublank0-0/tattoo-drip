/**
 * The finish card's words (TAT-111): pure, so a unit test pins them
 * (tests/unit/inertia/finish_copy.spec.ts).
 */
export type FinishStepName = "finish" | "complete";

export const FINISH_TITLES: Record<FinishStepName, string> = {
	finish: "Finish the tattoo",
	complete: "Healing check",
};

/** The card's button, which opens the confirmation. */
export const FINISH_BUTTONS: Record<FinishStepName, string> = {
	finish: "Mark the tattoo finished",
	complete: "Healing check done",
};

/** The confirmation's button. */
export const FINISH_CONFIRMS: Record<FinishStepName, string> = {
	finish: "Mark finished",
	complete: "Close the project",
};

/** Shown instead of the button while a session is scheduled. */
export const SESSION_FIRST =
	"Record or cancel the scheduled session under Sessions first.";

const ASK =
	"Ask the client for a photo of the healed tattoo. If it needs a touch-up, schedule a touch-up session under Sessions.";

/** The card's text under its title. */
export function finishIntro(
	step: FinishStepName,
	dueText: string | null,
	overdue: boolean,
): string {
	if (step === "finish") {
		return dueText
			? `Once the work is done, mark the tattoo finished. Its healing check will be due ${dueText}, four weeks after the last tattoo session.`
			: "Once the work is done, mark the tattoo finished. Its healing check comes next.";
	}
	if (!dueText) return ASK;
	return `${overdue ? "Was due" : "Due"} ${dueText}. ${ASK}`;
}

/** The money still owed, shown above the button. */
export function balanceLine(amountText: string, estimated: boolean): string {
	return `Balance due: ${amountText}${estimated ? " (estimated)" : ""}.`;
}

/** The confirmation's question. */
export function finishQuestion(
	step: FinishStepName,
	dueText: string | null,
	balanceDueText: string | null,
	estimated: boolean,
): string {
	const question =
		step === "finish"
			? `Mark the tattoo finished? The project moves to Healing check${dueText ? `, due ${dueText},` : ""} and takes only touch-up sessions from now on.`
			: "Close the project? It moves to Completed and takes no more sessions.";
	return balanceDueText
		? `${question} ${balanceDueText} of the ${estimated ? "estimated " : ""}balance is still due: it stays on the Payments card.`
		: question;
}
