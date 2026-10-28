import { router, usePage } from "@inertiajs/react";
import { useEffect, useId, useRef, useState } from "react";
import { urlFor } from "~/client";
import {
	balanceLine,
	FINISH_BUTTONS,
	FINISH_CONFIRMS,
	FINISH_TITLES,
	finishIntro,
	finishQuestion,
	SESSION_FIRST,
} from "~/components/finish";
import type { FinishProps } from "~/components/projects";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { FieldError } from "~/components/ui/field";
import { useTenant } from "~/hooks/use-tenant";

/**
 * Finishing a project (TAT-111): "Mark the tattoo finished" on an
 * in-progress project, then the healing check with its day and "Healing
 * check done". Each step is confirmed in an inline panel: focus starts on
 * "Not yet", Escape closes it and returns focus to the button. A refused
 * amount (`confirmedDue`, only a hand-edited request can send one) shows
 * under the buttons and the panel stays open. When a step is done the panel
 * is replaced or gone, so `onDone` lets the page move focus somewhere
 * sensible. The assigned artist gets the healing check without a button.
 * Since TAT-108 it is the body of the Next step card, whose title (the same
 * words, FINISH_TITLES) is drawn by the card.
 */
export default function FinishPanel({
	projectId,
	finish,
	onDone,
}: {
	projectId: string;
	finish: FinishProps;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const error = usePage().props.errors.confirmedDue;
	const errorId = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const keep = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		if (open) keep.current?.focus();
	}, [open]);
	const { step, action } = finish;
	const close = () => {
		setOpen(false);
		trigger.current?.focus();
	};
	const confirm = () => {
		if (!action) return;
		const params = { tenant: tenant.slug, id: projectId };
		router.post(
			step === "finish"
				? urlFor("tenant.projects.finish.store", params)
				: urlFor("tenant.projects.complete.store", params),
			{ confirmedDue: action.confirmedDue },
			{
				preserveScroll: true,
				onStart: () => setSaving(true),
				onFinish: () => setSaving(false),
				onSuccess: () => {
					setOpen(false);
					onDone();
				},
			},
		);
	};

	return (
		<div className="flex flex-col gap-3 text-sm">
			<p>{finishIntro(step, finish.dueText, finish.overdue)}</p>
			{action?.balanceDueText && (
				<p>{balanceLine(action.balanceDueText, action.estimated)}</p>
			)}
			{action &&
				(action.sessionScheduled ? (
					<p className="text-muted-foreground">{SESSION_FIRST}</p>
				) : (
					<div>
						<Button
							ref={trigger}
							type="button"
							className="h-11"
							aria-expanded={open}
							onClick={() => setOpen(true)}
						>
							{FINISH_BUTTONS[step]}
						</Button>
					</div>
				))}
			{open && action && (
				<fieldset
					className="min-w-0 rounded-md bg-muted/50 p-3"
					onKeyDown={(event) => {
						if (event.key === "Escape") close();
					}}
				>
					<legend className="float-left mb-3 w-full">
						{finishQuestion(
							step,
							finish.dueText,
							action.balanceDueText,
							action.estimated,
						)}
					</legend>
					<div className="clear-left flex flex-wrap gap-2">
						<Button
							type="button"
							className="h-11"
							disabled={saving}
							aria-describedby={error ? errorId : undefined}
							onClick={confirm}
						>
							{saving ? "Saving…" : FINISH_CONFIRMS[step]}
						</Button>
						<Button
							ref={keep}
							type="button"
							variant="ghost"
							className="h-11"
							disabled={saving}
							onClick={close}
						>
							Not yet
						</Button>
					</div>
					{error && (
						<FieldError id={errorId} className="clear-left mt-3">
							{error}
						</FieldError>
					)}
				</fieldset>
			)}
		</div>
	);
}

/**
 * The Finish panel in a card of its own, for a project whose Next step is something else while
 * finishing is available (a deposit screenshot nobody decided after the money was recorded at the
 * desk). The old page always drew it; the Next step card holds it when it names the step.
 */
export function FinishCard({
	projectId,
	finish,
	onDone,
}: {
	projectId: string;
	finish: FinishProps;
	onDone: () => void;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="leading-snug">
					<h2>{FINISH_TITLES[finish.step]}</h2>
				</CardTitle>
			</CardHeader>
			<CardContent>
				<FinishPanel projectId={projectId} finish={finish} onDone={onDone} />
			</CardContent>
		</Card>
	);
}
