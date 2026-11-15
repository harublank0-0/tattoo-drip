import { Form } from "@adonisjs/inertia/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

export type ItemKind = "review" | "reply" | "post";

/** A takedown reason as the server labels it. */
export type ReasonOption = { value: string; label: string };

/** The takedown and restore route of each kind; the id is the review's or the post's. */
const ROUTES = {
	review: {
		takedown: "admin.reviews.takedown",
		restore: "admin.reviews.restore",
	},
	reply: {
		takedown: "admin.reviews.reply.takedown",
		restore: "admin.reviews.reply.restore",
	},
	post: { takedown: "admin.posts.takedown", restore: "admin.posts.restore" },
} as const;

const selectClass =
	"min-h-11 min-w-0 rounded-md border bg-background px-3 text-sm lg:min-h-9";

/**
 * Takes a review, a reply or a post off every public surface. The reason is
 * one of the fixed reasons (the client's page shows its sentence); the note
 * is for operators only. `idPrefix` is unique per form: it names the form's
 * error bag and its field ids, so a refusal shows only under it.
 */
export function ReviewTakedownForm({
	kind,
	id,
	idPrefix,
	reasons,
	defaultReason,
}: {
	kind: ItemKind;
	id: string;
	idPrefix: string;
	reasons: ReasonOption[];
	defaultReason?: string;
}) {
	return (
		<Form
			errorBag={idPrefix}
			route={ROUTES[kind].takedown}
			routeParams={{ id }}
			className="flex flex-col gap-2"
		>
			{({
				errors,
				processing,
			}: {
				errors: Record<string, string>;
				processing: boolean;
			}) => (
				<>
					<label htmlFor={`${idPrefix}-reason`} className="sr-only">
						Reason for the takedown
					</label>
					<select
						id={`${idPrefix}-reason`}
						name="reason"
						defaultValue={
							defaultReason &&
							reasons.some((reason) => reason.value === defaultReason)
								? defaultReason
								: reasons[0]?.value
						}
						className={selectClass}
						aria-invalid={!!errors.reason}
					>
						{reasons.map((reason) => (
							<option key={reason.value} value={reason.value}>
								{reason.label}
							</option>
						))}
					</select>
					{errors.reason && (
						<p className="text-sm text-destructive">{errors.reason}</p>
					)}
					<label htmlFor={`${idPrefix}-note`} className="sr-only">
						Note (kept for operators)
					</label>
					<Input
						id={`${idPrefix}-note`}
						name="note"
						placeholder="Note (optional, kept for operators)"
						className="h-11"
						aria-invalid={!!errors.note}
					/>
					{errors.note && (
						<p className="text-sm text-destructive">{errors.note}</p>
					)}
					<Button
						type="submit"
						variant="outline"
						className="h-11"
						disabled={processing}
					>
						{processing ? "Saving…" : "Take down"}
					</Button>
				</>
			)}
		</Form>
	);
}

/** Lifts a review's, a reply's or a post's takedown. */
export function LiftItemTakedown({ kind, id }: { kind: ItemKind; id: string }) {
	return (
		<Form route={ROUTES[kind].restore} routeParams={{ id }}>
			{({ processing }) => (
				<Button type="submit" className="h-11" disabled={processing}>
					{processing ? "Saving…" : "Lift takedown"}
				</Button>
			)}
		</Form>
	);
}

/** Closes a report and keeps the review up. */
export function KeepItUp({ reviewId }: { reviewId: string }) {
	return (
		<Form route="admin.reviews.dismiss" routeParams={{ id: reviewId }}>
			{({ processing }) => (
				<Button
					type="submit"
					variant="outline"
					className="h-11"
					disabled={processing}
				>
					{processing ? "Saving…" : "Keep it up"}
				</Button>
			)}
		</Form>
	);
}
