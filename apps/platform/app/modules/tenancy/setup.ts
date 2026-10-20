/**
 * The new-studio checklist (TAT-101): four things an owner does before the
 * studio page works for clients. Pure; SetupService gathers the facts.
 */
export const SETUP_STEPS = [
	"artists",
	"payments",
	"policy",
	"inquiry",
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number];

/** What is true of the studio now, from the modules that own it. */
export type SetupFacts = {
	/** Artists added (live, hidden ones included). */
	artists: number;
	/** Payment methods shown on the deposit page. */
	depositMethods: number;
	/** The written deposit policy, if any. */
	depositPolicy: string | null;
	/** Inquiries received, in any status. */
	inquiries: number;
};

export type SetupStep = {
	key: SetupStepKey;
	done: boolean;
	/** The first step still open: the one the card highlights. */
	next: boolean;
};

export type SetupChecklist = {
	steps: SetupStep[];
	doneCount: number;
	total: number;
	complete: boolean;
};

export function setupChecklist(facts: SetupFacts): SetupChecklist {
	const done: Record<SetupStepKey, boolean> = {
		artists: facts.artists > 0,
		payments: facts.depositMethods > 0,
		policy: (facts.depositPolicy ?? "").trim() !== "",
		inquiry: facts.inquiries > 0,
	};
	const first = SETUP_STEPS.find((key) => !done[key]);
	const doneCount = SETUP_STEPS.filter((key) => done[key]).length;
	return {
		steps: SETUP_STEPS.map((key) => ({
			key,
			done: done[key],
			next: key === first,
		})),
		doneCount,
		total: SETUP_STEPS.length,
		complete: doneCount === SETUP_STEPS.length,
	};
}
