import { cn } from "cn";
import { progressOf, type StepState } from "~/components/project_page";

/** A step's dot: done is filled, the current one a ring, the ones to come an empty outline. */
const DOT: Record<StepState, string> = {
	done: "bg-primary",
	current: "border-2 border-primary bg-card",
	todo: "border border-input bg-card",
};

/**
 * Where the project is on its way (TAT-108): Review, Quote, Deposit, Sessions, Done, as a row of
 * five dots joined by dashes under the client's name. `progressOf` decides which are done (a
 * unit-tested pure rule); a declined or cancelled project draws nothing, because we don't store
 * how far a withdrawn project got. The state is words too, for a screen reader: "done" after a
 * finished step, `aria-current="step"` on the one it is at.
 */
export default function ProgressLine({ status }: { status: string }) {
	const steps = progressOf(status);
	if (!steps) return null;

	return (
		<ol aria-label="Progress" className="grid grid-cols-5 pt-1">
			{steps.map(({ label, state }, index) => (
				<li
					key={label}
					aria-current={state === "current" ? "step" : undefined}
					className="flex min-w-0 flex-col gap-1.5"
				>
					<div className="flex items-center">
						<span
							aria-hidden="true"
							className={cn("size-3 shrink-0 rounded-full", DOT[state])}
						/>
						{index < steps.length - 1 && (
							<span
								aria-hidden="true"
								className="mx-1 flex-1 border-t border-dashed border-input"
							/>
						)}
					</div>
					<span
						className={cn(
							"text-sm",
							state === "current"
								? "font-medium text-foreground"
								: "text-muted-foreground",
						)}
					>
						{label}
						{state === "done" && <span className="sr-only">, done</span>}
						{state === "current" && <span className="sr-only">, now</span>}
					</span>
				</li>
			))}
		</ol>
	);
}
