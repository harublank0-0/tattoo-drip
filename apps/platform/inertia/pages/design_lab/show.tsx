import { Form } from "@adonisjs/inertia/react";
import { Link, router } from "@inertiajs/react";
import {
	Download,
	GitCompareArrows,
	RotateCcw,
	Sparkles,
	Star,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { urlFor } from "~/client";
import {
	type Allowance,
	allowanceText,
	type GenerationStatus,
	isPending,
	POLL_INTERVAL_MS,
	REVIEW_STATE_LABELS,
	resetsText,
	statusesChanged,
	statusVariant,
	usageText,
	variationChoices,
} from "~/components/design_lab";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

type Choice = { value: string; label: string };
type Choices = {
	styles: Choice[];
	palettes: Choice[];
	orientations: Choice[];
	details: Choice[];
	bodyAreas: Choice[];
	limits: {
		concept: { min: number; max: number };
		subject: { max: number };
		customStyle: { max: number };
		lettering: { max: number };
	};
};

type Generation = {
	id: string;
	status: GenerationStatus;
	statusLabel: string;
	attempt: number;
	failure: string | null;
	canRetry: boolean;
	label: string;
	requestedAt: string;
	inputs: Record<string, string | null>;
	promptVersion: string;
	prompt: string;
	model: string;
	asset: {
		id: string;
		title: string | null;
		notes: string | null;
		width: number;
		height: number;
		selected: boolean;
		url: string;
		thumbnailUrl: string;
	} | null;
};

type Notice = {
	title: string;
	points: string[];
	acknowledgement: string;
	policyUrl: string | null;
};

/** The provider's usage policy, linked under the notice's points. */
function PolicyLink({ url }: { url: string | null }) {
	if (!url) return null;
	return (
		<a
			href={url}
			target="_blank"
			rel="noreferrer"
			className="-my-3 flex min-h-11 w-fit items-center underline underline-offset-4"
		>
			Read BFL's usage policy
		</a>
	);
}

const selectClass =
	"min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm lg:min-h-9";

/** The most concepts shown side by side. */
const MAX_COMPARED = 3;

export default function DesignLabShow({
	project,
	generations,
	allowance,
	maxVariations,
	choices,
	needsAcknowledgement,
	notice,
	linkable,
	requestId,
}: {
	project: {
		id: string;
		title: string;
		notes: string | null;
		reviewState: string;
		tattooProjectId: string | null;
		linked: { id: string; label: string } | null;
	};
	generations: Generation[];
	allowance: Allowance;
	maxVariations: number;
	choices: Choices;
	promptVersion: string;
	needsAcknowledgement: boolean;
	notice: Notice;
	linkable: { id: string; label: string }[];
	requestId: string;
}) {
	const { slug } = useTenant();
	const params = { tenant: slug, id: project.id };
	const archived = project.reviewState === "archived";
	const [compared, setCompared] = useState<string[]>([]);
	usePollStatuses(params, generations);
	useFreshImageUrls(generations);

	const ready = generations.filter((generation) => generation.asset);
	const comparedConcepts = compared
		.map((id) => ready.find((generation) => generation.id === id))
		.filter((generation): generation is Generation => Boolean(generation));
	const toggleCompare = (id: string) =>
		setCompared((current) =>
			current.includes(id)
				? current.filter((other) => other !== id)
				: [...current, id].slice(-MAX_COMPARED),
		);

	return (
		<Page
			title={project.title}
			description={
				<>
					AI concepts for you to review and redraw, not finished stencils.{" "}
					<Link
						href={urlFor("tenant.design_lab.index", { tenant: slug })}
						className="underline underline-offset-4"
					>
						All design projects
					</Link>
				</>
			}
			details={
				<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
					<Badge variant="outline">
						{REVIEW_STATE_LABELS[project.reviewState] ?? project.reviewState}
					</Badge>
					{project.linked && (
						<Link
							href={urlFor("tenant.projects.show", {
								tenant: slug,
								id: project.linked.id,
							})}
							className="underline underline-offset-4 wrap-anywhere"
						>
							For {project.linked.label}
						</Link>
					)}
				</div>
			}
		>
			{archived ? (
				<p className="rounded-md border p-4 text-sm">
					This design project is archived. Restore it under Project details to
					generate more concepts.
				</p>
			) : (
				<Section
					title="Generate a concept"
					description={`${allowanceText(allowance)}. ${resetsText(allowance.resetsAt)}.`}
				>
					<GenerateForm
						params={params}
						requestId={requestId}
						allowance={allowance}
						maxVariations={maxVariations}
						choices={choices}
						needsAcknowledgement={needsAcknowledgement}
						notice={notice}
					/>
				</Section>
			)}

			<Section
				title="Concepts"
				description={
					ready.length > 1
						? "Pick up to three with Compare to see them side by side."
						: undefined
				}
			>
				{comparedConcepts.length > 1 && (
					<section
						aria-label="Compared concepts"
						className="mb-6 grid gap-3 rounded-lg border p-3"
						style={{
							gridTemplateColumns: `repeat(${comparedConcepts.length}, minmax(0, 1fr))`,
						}}
					>
						{comparedConcepts.map((generation) => (
							<figure
								key={generation.id}
								className="flex min-w-0 flex-col gap-2"
							>
								<img
									src={generation.asset?.url}
									alt={conceptName(generation)}
									className="aspect-square w-full rounded-md bg-white object-contain"
								/>
								<figcaption className="text-xs wrap-anywhere">
									{conceptName(generation)}
								</figcaption>
							</figure>
						))}
					</section>
				)}
				{generations.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No concepts yet. Describe an idea above to generate the first one.
					</p>
				) : (
					<ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{generations.map((generation) => (
							<ConceptCard
								key={generation.id}
								generation={generation}
								tenant={slug}
								compared={compared.includes(generation.id)}
								onCompare={() => toggleCompare(generation.id)}
								archived={archived}
							/>
						))}
					</ul>
				)}
			</Section>

			<Section title="Project details">
				<Form
					route="tenant.design_lab.update"
					routeParams={params}
					options={{ preserveScroll: true, preserveState: true }}
				>
					{({ errors, processing }) => (
						<FieldGroup className="max-w-xl">
							<Field data-invalid={errors.title ? true : undefined}>
								<FieldLabel htmlFor="project-title">Title</FieldLabel>
								<Input
									id="project-title"
									name="title"
									defaultValue={project.title}
									maxLength={120}
									required
									aria-invalid={errors.title ? true : undefined}
								/>
								{errors.title && <FieldError>{errors.title}</FieldError>}
							</Field>
							<Field data-invalid={errors.tattooProjectId ? true : undefined}>
								<FieldLabel htmlFor="project-link">For a project</FieldLabel>
								<select
									id="project-link"
									name="tattooProjectId"
									className={selectClass}
									defaultValue={project.tattooProjectId ?? ""}
								>
									<option value="">Not linked</option>
									{project.linked &&
										!linkable.some(
											(option) => option.id === project.linked?.id,
										) && (
											<option value={project.linked.id}>
												{project.linked.label}
											</option>
										)}
									{linkable.map((option) => (
										<option key={option.id} value={option.id}>
											{option.label}
										</option>
									))}
								</select>
								<FieldDescription>
									Only files the concepts with the project. Client details are
									never sent to the image service.
								</FieldDescription>
								{errors.tattooProjectId && (
									<FieldError>{errors.tattooProjectId}</FieldError>
								)}
							</Field>
							<Field data-invalid={errors.notes ? true : undefined}>
								<FieldLabel htmlFor="project-notes">Artist notes</FieldLabel>
								<Textarea
									id="project-notes"
									name="notes"
									defaultValue={project.notes ?? ""}
									maxLength={2000}
									rows={3}
								/>
								{errors.notes && <FieldError>{errors.notes}</FieldError>}
							</Field>
							<input
								type="hidden"
								name="archived"
								value={archived ? "true" : "false"}
							/>
							<div className="flex flex-wrap gap-2">
								<Button type="submit" disabled={processing}>
									{processing ? "Saving…" : "Save details"}
								</Button>
							</div>
						</FieldGroup>
					)}
				</Form>
				<Form
					route="tenant.design_lab.update"
					routeParams={params}
					className="mt-4"
					options={{ preserveScroll: true, preserveState: true }}
				>
					{({ processing }) => (
						<>
							<input type="hidden" name="title" value={project.title} />
							<input type="hidden" name="notes" value={project.notes ?? ""} />
							<input
								type="hidden"
								name="tattooProjectId"
								value={project.tattooProjectId ?? ""}
							/>
							<input
								type="hidden"
								name="archived"
								value={archived ? "false" : "true"}
							/>
							<Button type="submit" variant="outline" disabled={processing}>
								{archived ? "Restore project" : "Archive project"}
							</Button>
						</>
					)}
				</Form>
			</Section>
		</Page>
	);
}

DesignLabShow.layout = [AppLayout];

const conceptName = (generation: Generation) =>
	generation.asset?.title || generation.label;

/**
 * Asks TattooDrip (never the provider) for statuses every few seconds while
 * a concept is queued or generating, and reloads the page's concepts when
 * one changes. Paused while the tab is hidden.
 */
function usePollStatuses(
	params: { tenant: string; id: string },
	generations: Generation[],
) {
	const pending = generations.some((generation) =>
		isPending(generation.status),
	);
	const shown = useMemo(
		() =>
			generations.map(({ id, status, attempt }) => ({ id, status, attempt })),
		[generations],
	);
	const url = urlFor("tenant.design_lab.status", {
		tenant: params.tenant,
		id: params.id,
	});
	useEffect(() => {
		if (!pending) return;
		let stopped = false;
		const tick = async () => {
			if (stopped || document.hidden) return;
			try {
				const response = await fetch(url, {
					headers: { accept: "application/json" },
					credentials: "same-origin",
				});
				if (!response.ok) return;
				const body = (await response.json()) as {
					generations: {
						id: string;
						status: GenerationStatus;
						attempt: number;
					}[];
				};
				if (!stopped && statusesChanged(shown, body.generations)) {
					router.reload({ only: ["generations", "allowance"] });
				}
			} catch {
				// Offline for a moment: the next tick tries again.
			}
		};
		const timer = window.setInterval(tick, POLL_INTERVAL_MS);
		return () => {
			stopped = true;
			window.clearInterval(timer);
		};
	}, [pending, shown, url]);
}

/** Signed image URLs live 5 minutes; refresh them a little before. */
const URL_REFRESH_MS = 4 * 60_000;

/**
 * Keeps the concepts' signed image URLs usable on a page left open: reloads
 * them every few minutes while the tab is visible, and at once when the tab
 * comes back after that long.
 */
function useFreshImageUrls(generations: Generation[]) {
	const loadedAt = useRef(Date.now());
	// biome-ignore lint/correctness/useExhaustiveDependencies: a reload brings new generations and with them new signed URLs: that is the moment to note.
	useEffect(() => {
		loadedAt.current = Date.now();
	}, [generations]);
	useEffect(() => {
		const refresh = () => {
			if (document.hidden) return;
			if (Date.now() - loadedAt.current < URL_REFRESH_MS) return;
			router.reload({ only: ["generations"] });
		};
		const timer = window.setInterval(refresh, 30_000);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, []);
}

function GenerateForm({
	params,
	requestId,
	allowance,
	maxVariations,
	choices,
	needsAcknowledgement,
	notice,
}: {
	params: { tenant: string; id: string };
	requestId: string;
	allowance: Allowance;
	maxVariations: number;
	choices: Choices;
	needsAcknowledgement: boolean;
	notice: Notice;
}) {
	const [style, setStyle] = useState("fine_line");
	const [variations, setVariations] = useState(1);
	const [acknowledged, setAcknowledged] = useState(false);
	// The submit's idempotency key, held here so a refused submit (its field
	// errors) or another form on the page never resets what was typed; the
	// server's fresh key replaces it once a submit succeeds.
	const [formRequestId, setFormRequestId] = useState(requestId);
	const counts = variationChoices(maxVariations, allowance.remaining);
	const outOfAllowance = allowance.remaining === 0;

	return (
		<Form
			route="tenant.design_lab.generate"
			routeParams={params}
			options={{ preserveScroll: true, preserveState: true }}
			resetOnSuccess
			onSuccess={(page) => {
				const next = (page.props as { requestId?: string }).requestId;
				if (next) setFormRequestId(next);
				setStyle("fine_line");
				setVariations(1);
			}}
		>
			{({ errors, processing }) => (
				<FieldGroup className="gap-5">
					<input type="hidden" name="requestId" value={formRequestId} />
					<Field data-invalid={errors.concept ? true : undefined}>
						<FieldLabel htmlFor="concept">Concept</FieldLabel>
						<Textarea
							id="concept"
							name="concept"
							required
							rows={3}
							minLength={choices.limits.concept.min}
							maxLength={choices.limits.concept.max}
							placeholder="e.g. A koi fish swimming upward through peonies, water swirling around it"
							aria-invalid={errors.concept ? true : undefined}
						/>
						<FieldDescription>
							Describe the artwork only. No client names, contact details or
							photos: they are never needed and never sent.
						</FieldDescription>
						{errors.concept && <FieldError>{errors.concept}</FieldError>}
					</Field>

					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						<Field data-invalid={errors.style ? true : undefined}>
							<FieldLabel htmlFor="style">Style</FieldLabel>
							<select
								id="style"
								name="style"
								className={selectClass}
								value={style}
								onChange={(event) => setStyle(event.target.value)}
							>
								{choices.styles.map((choice) => (
									<option key={choice.value} value={choice.value}>
										{choice.label}
									</option>
								))}
							</select>
							{errors.style && <FieldError>{errors.style}</FieldError>}
						</Field>
						{style === "custom" && (
							<Field data-invalid={errors.customStyle ? true : undefined}>
								<FieldLabel htmlFor="customStyle">
									Describe the style
								</FieldLabel>
								<Input
									id="customStyle"
									name="customStyle"
									required
									maxLength={choices.limits.customStyle.max}
									placeholder="e.g. Neo-traditional with stippled shading"
									aria-invalid={errors.customStyle ? true : undefined}
								/>
								{errors.customStyle && (
									<FieldError>{errors.customStyle}</FieldError>
								)}
							</Field>
						)}
						{style === "lettering" && (
							<Field data-invalid={errors.lettering ? true : undefined}>
								<FieldLabel htmlFor="lettering">Lettering text</FieldLabel>
								<Input
									id="lettering"
									name="lettering"
									maxLength={choices.limits.lettering.max}
									aria-invalid={errors.lettering ? true : undefined}
								/>
								<FieldDescription>
									A word or short phrase. Avoid personal names where you can.
								</FieldDescription>
								{errors.lettering && (
									<FieldError>{errors.lettering}</FieldError>
								)}
							</Field>
						)}
						<Field data-invalid={errors.subject ? true : undefined}>
							<FieldLabel htmlFor="subject">Subject (optional)</FieldLabel>
							<Input
								id="subject"
								name="subject"
								maxLength={choices.limits.subject.max}
								placeholder="e.g. Koi fish"
								aria-invalid={errors.subject ? true : undefined}
							/>
							{errors.subject && <FieldError>{errors.subject}</FieldError>}
						</Field>
						<ChoiceSelect
							id="palette"
							label="Palette"
							options={choices.palettes}
							error={errors.palette}
						/>
						<ChoiceSelect
							id="orientation"
							label="Composition"
							options={choices.orientations}
							error={errors.orientation}
						/>
						<ChoiceSelect
							id="detail"
							label="Detail level"
							options={choices.details}
							defaultValue="balanced"
							error={errors.detail}
						/>
						<ChoiceSelect
							id="bodyArea"
							label="Intended placement"
							options={choices.bodyAreas}
							error={errors.bodyArea}
						/>
						<Field data-invalid={errors.variations ? true : undefined}>
							<FieldLabel htmlFor="variations">Variations</FieldLabel>
							<select
								id="variations"
								name="variations"
								className={selectClass}
								value={variations}
								onChange={(event) => setVariations(Number(event.target.value))}
								aria-describedby="variations-usage"
							>
								{counts.map((count) => (
									<option key={count} value={count}>
										{count === 1 ? "1 image" : `${count} images`}
									</option>
								))}
							</select>
							{errors.variations && (
								<FieldError>{errors.variations}</FieldError>
							)}
						</Field>
					</div>

					<p id="variations-usage" className="text-sm font-medium">
						{usageText(variations, allowance)}
					</p>

					{needsAcknowledgement && (
						<div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-4 text-sm">
							<p className="font-medium">{notice.title}</p>
							<ul className="list-disc space-y-1 pl-5 text-muted-foreground">
								{notice.points.map((point) => (
									<li key={point}>{point}</li>
								))}
							</ul>
							<PolicyLink url={notice.policyUrl} />
							<Field
								orientation="horizontal"
								data-invalid={errors.acknowledged ? true : undefined}
								className="min-h-11 items-center"
							>
								<Checkbox
									id="acknowledged"
									name="acknowledged"
									value="true"
									checked={acknowledged}
									onCheckedChange={(checked) =>
										setAcknowledged(checked === true)
									}
									aria-invalid={errors.acknowledged ? true : undefined}
								/>
								<FieldLabel htmlFor="acknowledged" className="font-normal">
									{notice.acknowledgement}
								</FieldLabel>
							</Field>
							{errors.acknowledged && (
								<FieldError>{errors.acknowledged}</FieldError>
							)}
						</div>
					)}
					{!needsAcknowledgement && (
						<details className="text-sm text-muted-foreground">
							<summary className="flex min-h-11 cursor-pointer items-center">
								{notice.title}
							</summary>
							<ul className="list-disc space-y-1 pl-5">
								{notice.points.map((point) => (
									<li key={point}>{point}</li>
								))}
							</ul>
							<PolicyLink url={notice.policyUrl} />
						</details>
					)}

					<div>
						<Button
							type="submit"
							disabled={
								processing ||
								outOfAllowance ||
								(needsAcknowledgement && !acknowledged)
							}
						>
							<Sparkles aria-hidden="true" />
							{processing
								? "Sending…"
								: variations === 1
									? "Generate concept"
									: `Generate ${variations} concepts`}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

function ChoiceSelect({
	id,
	label,
	options,
	defaultValue,
	error,
}: {
	id: string;
	label: string;
	options: Choice[];
	defaultValue?: string;
	error?: string;
}) {
	return (
		<Field data-invalid={error ? true : undefined}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<select
				id={id}
				name={id}
				className={selectClass}
				defaultValue={defaultValue ?? options[0]?.value}
				aria-invalid={error ? true : undefined}
			>
				{options.map((choice) => (
					<option key={choice.value} value={choice.value}>
						{choice.label}
					</option>
				))}
			</select>
			{error && <FieldError>{error}</FieldError>}
		</Field>
	);
}

function ConceptCard({
	generation,
	tenant,
	compared,
	onCompare,
	archived,
}: {
	generation: Generation;
	tenant: string;
	compared: boolean;
	onCompare: () => void;
	archived: boolean;
}) {
	const { asset } = generation;
	const name = conceptName(generation);
	return (
		<li className="flex flex-col overflow-hidden rounded-lg border bg-card">
			<div className="relative flex aspect-square items-center justify-center bg-muted">
				{asset ? (
					<a
						href={asset.url}
						target="_blank"
						rel="noreferrer"
						className="size-full"
					>
						<img
							src={asset.thumbnailUrl}
							alt={name}
							loading="lazy"
							className="size-full bg-white object-contain"
						/>
					</a>
				) : (
					<div
						className="flex flex-col items-center gap-2 p-4 text-center text-sm text-muted-foreground"
						aria-live="polite"
					>
						{isPending(generation.status) && (
							<Sparkles aria-hidden="true" className="size-6 animate-pulse" />
						)}
						<span>{generation.statusLabel}</span>
					</div>
				)}
				{asset?.selected && (
					<Badge className="absolute top-2 left-2">
						<Star aria-hidden="true" /> Preferred
					</Badge>
				)}
			</div>
			<div className="flex flex-1 flex-col gap-3 p-3">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="flex min-w-0 flex-col">
						<span className="text-sm font-medium wrap-anywhere">{name}</span>
						<span className="text-xs text-muted-foreground">
							{generation.requestedAt}
						</span>
					</div>
					<Badge variant={statusVariant(generation.status)}>
						{generation.statusLabel}
					</Badge>
				</div>
				{generation.failure && (
					<p className="text-sm text-destructive" aria-live="polite">
						{generation.failure}
					</p>
				)}
				{generation.canRetry && !archived && (
					<Form
						route="tenant.design_lab.retry"
						routeParams={{ tenant, id: generation.id }}
						options={{ preserveScroll: true, preserveState: true }}
					>
						{({ processing, errors }) => (
							<>
								<input
									type="hidden"
									name="attempt"
									value={generation.attempt}
								/>
								<Button
									type="submit"
									size="sm"
									variant="outline"
									disabled={processing}
								>
									<RotateCcw aria-hidden="true" />
									{processing ? "Retrying…" : "Try again (uses 1 generation)"}
								</Button>
								{errors.attempt && <FieldError>{errors.attempt}</FieldError>}
							</>
						)}
					</Form>
				)}
				{asset && (
					<div className="flex flex-wrap gap-2">
						<Form
							route="tenant.design_lab.assets.select"
							routeParams={{ tenant, id: asset.id }}
							options={{ preserveScroll: true, preserveState: true }}
						>
							{({ processing }) => (
								<>
									<input
										type="hidden"
										name="selected"
										value={asset.selected ? "false" : "true"}
									/>
									<Button
										type="submit"
										size="sm"
										variant={asset.selected ? "default" : "outline"}
										disabled={processing}
										aria-pressed={asset.selected}
									>
										<Star aria-hidden="true" />
										{asset.selected ? "Preferred" : "Prefer"}
									</Button>
								</>
							)}
						</Form>
						<Button
							type="button"
							size="sm"
							variant={compared ? "secondary" : "outline"}
							aria-pressed={compared}
							onClick={onCompare}
						>
							<GitCompareArrows aria-hidden="true" />
							Compare
						</Button>
						<a
							href={urlFor("tenant.design_lab.assets.download", {
								tenant,
								id: asset.id,
							})}
							className={buttonVariants({ size: "sm", variant: "outline" })}
							download
						>
							<Download aria-hidden="true" />
							Download
						</a>
					</div>
				)}
				<details className="text-sm">
					<summary className="flex min-h-11 cursor-pointer items-center text-muted-foreground lg:min-h-8">
						{asset ? "Name, notes and how it was made" : "How it was requested"}
					</summary>
					<div className="flex flex-col gap-4 pt-2">
						{asset && (
							<Form
								route="tenant.design_lab.assets.update"
								routeParams={{ tenant, id: asset.id }}
								options={{ preserveScroll: true, preserveState: true }}
							>
								{({ processing, errors }) => (
									<FieldGroup className="gap-3">
										<Field data-invalid={errors.title ? true : undefined}>
											<FieldLabel htmlFor={`title-${asset.id}`}>
												Name
											</FieldLabel>
											<Input
												id={`title-${asset.id}`}
												name="title"
												defaultValue={asset.title ?? ""}
												maxLength={120}
												placeholder={generation.label}
											/>
											{errors.title && <FieldError>{errors.title}</FieldError>}
										</Field>
										<Field data-invalid={errors.notes ? true : undefined}>
											<FieldLabel htmlFor={`notes-${asset.id}`}>
												Artist notes
											</FieldLabel>
											<Textarea
												id={`notes-${asset.id}`}
												name="notes"
												rows={3}
												maxLength={2000}
												defaultValue={asset.notes ?? ""}
											/>
											{errors.notes && <FieldError>{errors.notes}</FieldError>}
										</Field>
										<div>
											<Button type="submit" size="sm" disabled={processing}>
												{processing ? "Saving…" : "Save"}
											</Button>
										</div>
									</FieldGroup>
								)}
							</Form>
						)}
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
							{Object.entries(generation.inputs)
								.filter(([, value]) => value)
								.map(([key, value]) => (
									<div key={key} className="contents">
										<dt className="text-muted-foreground">
											{INPUT_LABELS[key] ?? key}
										</dt>
										<dd className="wrap-anywhere">{value}</dd>
									</div>
								))}
							<dt className="text-muted-foreground">Template</dt>
							<dd>{generation.promptVersion}</dd>
							<dt className="text-muted-foreground">Model</dt>
							<dd className="wrap-anywhere">{generation.model}</dd>
							{asset && (
								<>
									<dt className="text-muted-foreground">Size</dt>
									<dd>
										{asset.width} × {asset.height} px
									</dd>
								</>
							)}
						</dl>
						<p className="text-xs text-muted-foreground wrap-anywhere">
							<span className="font-medium text-foreground">Prompt sent: </span>
							{generation.prompt}
						</p>
					</div>
				</details>
			</div>
		</li>
	);
}

const INPUT_LABELS: Record<string, string> = {
	concept: "Concept",
	style: "Style",
	customStyle: "Custom style",
	subject: "Subject",
	lettering: "Lettering",
	palette: "Palette",
	orientation: "Composition",
	detail: "Detail",
	bodyArea: "Placement",
};
