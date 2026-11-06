import { Link, useForm } from "@inertiajs/react";
import { type RefObject, useRef } from "react";
import { urlFor } from "~/client";
import { HIDDEN_LINK } from "~/components/good_to_know";
import InlineConfirm from "~/components/inline_confirm";
import { focusAfterMove, type MoveDirection } from "~/components/page_look";
import Section from "~/components/section";
import {
	type ListRow,
	moveListRow,
	type Pair,
	rowsFrom,
	syncRows,
} from "~/components/studio_content";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

/*
 * Settings, FAQ & policies: the studio's own questions and answers, and its
 * policies as titled sections. Each list is edited in place and saved whole
 * (PUT …/faq, PUT …/policies); the limits are the server's (limits.ts),
 * repeated here as the boxes' maxLength and the add buttons' cap. Plain text.
 */

const MAX_FAQ = 20;
const MAX_SECTIONS = 12;

/** What one list's card needs: its words, its limits and where it saves. */
type ListKind = {
	title: string;
	description: string;
	field: "entries" | "sections";
	/** The page prop that holds the stored list. */
	prop: "faq" | "policies";
	a: { key: string; label: string; max: number };
	b: { key: string; label: string; max: number };
	add: string;
	max: number;
	saveRoute:
		| "tenant.settings.faq_policies.faq.update"
		| "tenant.settings.faq_policies.policies.update";
	empty: string;
	noun: string;
};

const FAQ: ListKind = {
	title: "Questions and answers",
	description:
		"Your own answers, shown on your FAQ page after the ones about how requesting works.",
	field: "entries",
	prop: "faq",
	a: { key: "question", label: "Question", max: 200 },
	b: { key: "answer", label: "Answer", max: 2000 },
	add: "Add a question",
	max: MAX_FAQ,
	saveRoute: "tenant.settings.faq_policies.faq.update",
	empty: "No questions yet.",
	noun: "question",
};

const POLICIES: ListKind = {
	title: "Policies",
	description:
		"Your own sections, shown on your Policies page after your deposit policy, age rule, walk-ins and closed days.",
	field: "sections",
	prop: "policies",
	a: { key: "title", label: "Title", max: 80 },
	b: { key: "text", label: "Text", max: 4000 },
	add: "Add a section",
	max: MAX_SECTIONS,
	saveRoute: "tenant.settings.faq_policies.policies.update",
	empty: "No sections yet.",
	noun: "section",
};

export default function FaqPolicies({
	faq,
	policies,
	policiesUpdatedOn,
	shownOnPage,
}: {
	faq: { question: string; answer: string }[];
	policies: { title: string; text: string }[];
	policiesUpdatedOn: string | null;
	shownOnPage: boolean;
}) {
	const tenant = useTenant();
	const heading = useRef<HTMLParagraphElement>(null);
	return (
		<>
			{/* Where focus goes when a removed row took its button with it. */}
			<p ref={heading} tabIndex={-1} className="sr-only">
				FAQ & policies
			</p>
			{!shownOnPage && (
				<p className="mb-6 rounded-md border p-3 text-sm">
					Good to know is hidden on your page, and these show only with it.{" "}
					<Link
						href={urlFor("tenant.settings.look", { tenant: tenant.slug })}
						className="underline underline-offset-4"
					>
						{HIDDEN_LINK}
					</Link>
				</p>
			)}
			<ListCard
				kind={FAQ}
				initial={faq.map((row) => ({ a: row.question, b: row.answer }))}
				heading={heading}
			/>
			<ListCard
				kind={POLICIES}
				initial={policies.map((row) => ({ a: row.title, b: row.text }))}
				updatedOn={policiesUpdatedOn}
				heading={heading}
			/>
		</>
	);
}

function ListCard({
	kind,
	initial,
	updatedOn = null,
	heading,
}: {
	kind: ListKind;
	initial: Pair[];
	updatedOn?: string | null;
	heading: RefObject<HTMLElement | null>;
}) {
	const tenant = useTenant();
	const counter = useRef(0);
	const nextKey = () => counter.current++;
	const form = useForm<{ rows: ListRow[] }>({
		rows: rowsFrom(initial, nextKey),
	});
	const rows = form.data.rows;
	const errors = form.errors as Record<string, string | undefined>;
	const set = (next: ListRow[]) => form.setData("rows", next);
	const buttonId = (row: ListRow, direction: MoveDirection) =>
		`${kind.field}-${row.key}-${direction}`;
	// A move keeps focus on the moved row's button (or its other one at an
	// edge); the errors were about places, so they go.
	const move = (index: number, direction: MoveDirection) => {
		const row = rows[index];
		const moved = moveListRow(rows, index, direction);
		if (moved === rows || !row) return;
		form.clearErrors();
		set(moved);
		const at = moved.indexOf(row);
		const focus = focusAfterMove(at, moved.length, direction);
		setTimeout(() => document.getElementById(buttonId(row, focus))?.focus(), 0);
	};
	const remove = (index: number) => {
		form.clearErrors();
		set(rows.filter((_, m) => m !== index));
	};
	const save = () => {
		if (form.processing) return;
		form.transform(({ rows: list }) => ({
			[kind.field]: list.map((row) => ({
				[kind.a.key]: row.a,
				[kind.b.key]: row.b,
			})),
		}));
		form.put(urlFor(kind.saveRoute, { tenant: tenant.slug }), {
			preserveScroll: true,
			// The card stays mounted (focus stays on Save): the rows take what
			// was stored, which the server trimmed, and that is the new clean state.
			onSuccess: (page) => {
				const props = page.props as unknown as Record<string, unknown>;
				const stored = (props[kind.prop] as Record<string, string>[]).map(
					(row) => ({ a: row[kind.a.key], b: row[kind.b.key] }),
				);
				const synced = syncRows(form.data.rows, stored, nextKey);
				form.setDefaults({ rows: synced });
				form.setData("rows", synced);
			},
		});
	};

	return (
		<Section
			title={kind.title}
			description={
				updatedOn
					? `${kind.description} Last updated ${updatedOn}.`
					: kind.description
			}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					save();
				}}
			>
				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">{kind.empty}</p>
				) : (
					<ol className="flex flex-col gap-4">
						{rows.map((row, n) => {
							const prefix = `${kind.field}.${n}`;
							const aError = errors[`${prefix}.${kind.a.key}`];
							const bError = errors[`${prefix}.${kind.b.key}`];
							// Ids follow the row, not its place, so a label stays with its box.
							const id = `${kind.field}-${row.key}`;
							return (
								<li key={row.key} className="rounded-md border p-3">
									<FieldGroup>
										<Field data-invalid={!!aError}>
											<FieldLabel htmlFor={`${id}-a`}>
												{kind.a.label}
											</FieldLabel>
											<Input
												id={`${id}-a`}
												value={row.a}
												maxLength={kind.a.max}
												dir="auto"
												required
												aria-invalid={!!aError}
												aria-describedby={aError ? `${id}-a-error` : undefined}
												onChange={(event) =>
													set(
														rows.map((each, m) =>
															m === n
																? { ...each, a: event.target.value }
																: each,
														),
													)
												}
											/>
											{aError && (
												<FieldError id={`${id}-a-error`}>{aError}</FieldError>
											)}
										</Field>
										<Field data-invalid={!!bError}>
											<FieldLabel htmlFor={`${id}-b`}>
												{kind.b.label}
											</FieldLabel>
											<Textarea
												id={`${id}-b`}
												value={row.b}
												maxLength={kind.b.max}
												rows={4}
												dir="auto"
												required
												aria-invalid={!!bError}
												aria-describedby={bError ? `${id}-b-error` : undefined}
												onChange={(event) =>
													set(
														rows.map((each, m) =>
															m === n
																? { ...each, b: event.target.value }
																: each,
														),
													)
												}
											/>
											{bError && (
												<FieldError id={`${id}-b-error`}>{bError}</FieldError>
											)}
										</Field>
										<div className="flex flex-wrap gap-2">
											<Button
												type="button"
												variant="outline"
												size="sm"
												id={buttonId(row, "up")}
												disabled={n === 0}
												aria-label={`Move ${kind.noun} ${n + 1} up`}
												onClick={() => move(n, "up")}
											>
												Move up
											</Button>
											<Button
												type="button"
												variant="outline"
												size="sm"
												id={buttonId(row, "down")}
												disabled={n === rows.length - 1}
												aria-label={`Move ${kind.noun} ${n + 1} down`}
												onClick={() => move(n, "down")}
											>
												Move down
											</Button>
											<InlineConfirm
												label="Remove"
												ariaLabel={`Remove ${kind.noun} ${n + 1}`}
												question={`Remove this ${kind.noun}? It goes when you save.`}
												confirmLabel="Remove"
												keepLabel="Keep it"
												busyLabel="Removing…"
												fallback={heading}
												onConfirm={(finished) => {
													remove(n);
													finished();
												}}
											/>
										</div>
									</FieldGroup>
								</li>
							);
						})}
					</ol>
				)}
				{errors[kind.field] && (
					<p className="text-sm text-destructive" role="alert">
						{errors[kind.field]}
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						disabled={rows.length >= kind.max}
						onClick={() => set([...rows, { key: nextKey(), a: "", b: "" }])}
					>
						{kind.add}
					</Button>
					{/* Never disabled: a disabled button drops focus, and focus stays here across a save. */}
					<Button type="submit" aria-busy={form.processing}>
						{form.processing ? "Saving…" : "Save"}
					</Button>
				</div>
			</form>
		</Section>
	);
}

FaqPolicies.layout = [AppLayout, SettingsLayout];
