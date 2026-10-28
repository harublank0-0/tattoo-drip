import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import type { RefObject } from "react";
import { urlFor } from "~/client";
import InlineConfirm from "~/components/inline_confirm";
import {
	type ManualMoveName,
	MOVE_LABELS,
	type ProjectPageProps,
} from "~/components/projects";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { useTenant } from "~/hooks/use-tenant";

/** Moves that close a project ask first (the questions keep their words from before TAT-108). */
const CONFIRM: Partial<
	Record<
		ManualMoveName,
		{
			question: (sessions: number, deposit: string | null) => string;
			confirm: string;
			keep: string;
		}
	>
> = {
	decline: {
		question: (sessions) =>
			sessions > 0
				? `Decline this project? It moves to Closed and cancels ${sessions} scheduled session${sessions === 1 ? "" : "s"}.`
				: "Decline this project? It moves to Closed.",
		confirm: "Decline the project",
		keep: "Keep the project",
	},
	withdraw: {
		question: (sessions, deposit) => {
			const base =
				sessions > 0
					? `Mark that the client withdrew? This cancels the project and ${sessions} scheduled session${sessions === 1 ? "" : "s"}.`
					: "Mark that the client withdrew? This cancels the project.";
			return deposit
				? `${base} The client's deposit of ${deposit} stays recorded: you then record whether the studio keeps it or refunds it.`
				: base;
		},
		confirm: "Client withdrew",
		keep: "Keep the project",
	},
};

/**
 * "Change this project" (TAT-108): the rarely used changes to the project itself, at the end of
 * the page as plain buttons: put it on hold or resume it, mark that the client withdrew, decline
 * it, and (owners) pick its artist. Withdrawing and declining ask in the page (`InlineConfirm`).
 * Nothing renders for a closed project, and Resume is left out when the Next step card offers it.
 */
export default function ChangeCard({
	projectId,
	moves,
	scheduledSessionCount,
	depositHeldText,
	assignment,
	resumeInNextStep,
	fallback,
}: {
	projectId: string;
	moves: ManualMoveName[];
	scheduledSessionCount: number;
	depositHeldText: string | null;
	assignment: ProjectPageProps["assignment"];
	resumeInNextStep: boolean;
	fallback: RefObject<HTMLElement | null>;
}) {
	const tenant = useTenant();
	const shown = moves.filter(
		(move) => !(resumeInNextStep && move === "resume"),
	);
	if (shown.length === 0 && !assignment) return null;
	const post = (move: ManualMoveName, finished?: () => void) =>
		router.post(
			urlFor("tenant.projects.moves.store", {
				tenant: tenant.slug,
				id: projectId,
			}),
			{ move },
			{ preserveScroll: true, onFinish: finished },
		);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="leading-snug">
					<h2>Change this project</h2>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{assignment && (
					<ArtistField projectId={projectId} assignment={assignment} />
				)}
				{shown.length > 0 && (
					<div className="flex flex-col items-start gap-3">
						{shown.map((move) => {
							const ask = CONFIRM[move];
							return ask ? (
								<InlineConfirm
									key={move}
									label={MOVE_LABELS[move]}
									question={ask.question(
										scheduledSessionCount,
										depositHeldText,
									)}
									confirmLabel={ask.confirm}
									keepLabel={ask.keep}
									onConfirm={(finished) => post(move, finished)}
									fallback={fallback}
								/>
							) : (
								<Button
									key={move}
									type="button"
									variant="secondary"
									onClick={() => post(move)}
								>
									{MOVE_LABELS[move]}
								</Button>
							);
						})}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function ArtistField({
	projectId,
	assignment,
}: {
	projectId: string;
	assignment: NonNullable<ProjectPageProps["assignment"]>;
}) {
	const tenant = useTenant();

	return (
		<Form
			route="tenant.projects.artist.update"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
		>
			{({ errors, processing }) => (
				<Field data-invalid={!!errors.artistId}>
					<FieldLabel htmlFor="artistId">Artist</FieldLabel>
					<div className="flex gap-2">
						<select
							id="artistId"
							name="artistId"
							defaultValue={assignment.artistId ?? ""}
							aria-invalid={!!errors.artistId}
							className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm max-lg:min-h-11"
						>
							<option value="">No artist</option>
							{assignment.choices.map(({ id, name }) => (
								<option key={id} value={id}>
									{name}
								</option>
							))}
						</select>
						<Button type="submit" size="sm" disabled={processing}>
							Save
						</Button>
					</div>
					{errors.artistId && <FieldError>{errors.artistId}</FieldError>}
				</Field>
			)}
		</Form>
	);
}
