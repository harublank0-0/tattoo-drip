import { Form } from "@adonisjs/inertia/react";
import { Link } from "@inertiajs/react";
import { Sparkles } from "lucide-react";
import { urlFor } from "~/client";
import {
	type Allowance,
	allowanceText,
	REVIEW_STATE_LABELS,
	resetsText,
} from "~/components/design_lab";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

type ProjectCard = {
	id: string;
	title: string;
	reviewState: string;
	linked: { id: string; label: string } | null;
	createdOn: string;
	cover: string | null;
};

const selectClass =
	"min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm lg:min-h-9";

export default function DesignLabIndex({
	projects,
	view,
	page,
	lastPage,
	allowance,
	linkable,
}: {
	projects: ProjectCard[];
	view: "active" | "archived";
	page: number;
	lastPage: number;
	allowance: Allowance;
	linkable: { id: string; label: string }[];
}) {
	const { slug } = useTenant();
	const params = { tenant: slug };
	const index = urlFor("tenant.design_lab.index", params);
	const viewHref = (next: "active" | "archived", nextPage = 1) => {
		const query = new URLSearchParams();
		if (next === "archived") query.set("view", "archived");
		if (nextPage > 1) query.set("page", String(nextPage));
		const text = query.toString();
		return text ? `${index}?${text}` : index;
	};

	return (
		<Page
			title="AI Design Lab"
			description="Explore tattoo concepts with AI, then review and redraw them yourself. Concepts stay private to your studio."
		>
			<Section
				title="Start a design project"
				description={`${allowanceText(allowance)}. ${resetsText(allowance.resetsAt)}.`}
			>
				<Form route="tenant.design_lab.store" routeParams={params}>
					{({ errors, processing }) => (
						<FieldGroup className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto] sm:items-end">
							<Field data-invalid={errors.title ? true : undefined}>
								<FieldLabel htmlFor="design-title">Working title</FieldLabel>
								<Input
									id="design-title"
									name="title"
									maxLength={120}
									placeholder="e.g. Koi sleeve ideas"
									aria-invalid={errors.title ? true : undefined}
								/>
								{errors.title && <FieldError>{errors.title}</FieldError>}
							</Field>
							<Field data-invalid={errors.tattooProjectId ? true : undefined}>
								<FieldLabel htmlFor="design-link">
									For a project (optional)
								</FieldLabel>
								<select
									id="design-link"
									name="tattooProjectId"
									className={selectClass}
									defaultValue=""
									aria-invalid={errors.tattooProjectId ? true : undefined}
								>
									<option value="">Not linked</option>
									{linkable.map((option) => (
										<option key={option.id} value={option.id}>
											{option.label}
										</option>
									))}
								</select>
								{errors.tattooProjectId && (
									<FieldError>{errors.tattooProjectId}</FieldError>
								)}
							</Field>
							<Button type="submit" disabled={processing}>
								<Sparkles aria-hidden="true" />
								{processing ? "Starting…" : "Start project"}
							</Button>
						</FieldGroup>
					)}
				</Form>
				<p className="mt-3 text-xs text-muted-foreground">
					Linking a project only files the concepts with it: the client's name
					and details are never sent to the image service.
				</p>
			</Section>

			<Section
				title={
					view === "archived" ? "Archived projects" : "Your design projects"
				}
			>
				<nav aria-label="Design project views" className="mb-4 flex gap-2">
					<Link
						href={viewHref("active")}
						aria-current={view === "active" ? "page" : undefined}
						className="-my-3 flex min-h-11 items-center px-1 text-sm aria-[current=page]:font-semibold aria-[current=page]:underline"
					>
						Active
					</Link>
					<Link
						href={viewHref("archived")}
						aria-current={view === "archived" ? "page" : undefined}
						className="-my-3 flex min-h-11 items-center px-1 text-sm aria-[current=page]:font-semibold aria-[current=page]:underline"
					>
						Archived
					</Link>
				</nav>
				{projects.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{view === "archived"
							? "No archived design projects."
							: "No design projects yet. Start one above to generate your first concept."}
					</p>
				) : (
					<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
						{projects.map((project) => (
							<li key={project.id}>
								<Link
									href={urlFor("tenant.design_lab.show", {
										tenant: slug,
										id: project.id,
									})}
									className="group flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent/40"
								>
									<div className="flex aspect-square items-center justify-center bg-muted">
										{project.cover ? (
											<img
												src={project.cover}
												alt=""
												loading="lazy"
												className="size-full object-contain"
											/>
										) : (
											<Sparkles
												aria-hidden="true"
												className="size-8 text-muted-foreground"
											/>
										)}
									</div>
									<div className="flex min-w-0 flex-col gap-1 p-3">
										<span className="text-sm font-medium wrap-anywhere">
											{project.title}
										</span>
										{project.linked && (
											<span className="text-xs text-muted-foreground wrap-anywhere">
												{project.linked.label}
											</span>
										)}
										<span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
											<Badge variant="outline">
												{REVIEW_STATE_LABELS[project.reviewState] ??
													project.reviewState}
											</Badge>
											{project.createdOn}
										</span>
									</div>
								</Link>
							</li>
						))}
					</ul>
				)}
				{lastPage > 1 && (
					<nav
						aria-label="Pages"
						className="mt-4 flex items-center justify-between text-sm"
					>
						{page > 1 ? (
							<Link
								href={viewHref(view, page - 1)}
								className="-my-3 flex min-h-11 items-center"
							>
								Previous
							</Link>
						) : (
							<span />
						)}
						<span className="text-muted-foreground">
							Page {page} of {lastPage}
						</span>
						{page < lastPage ? (
							<Link
								href={viewHref(view, page + 1)}
								className="-my-3 flex min-h-11 items-center"
							>
								Next
							</Link>
						) : (
							<span />
						)}
					</nav>
				)}
			</Section>
		</Page>
	);
}

DesignLabIndex.layout = [AppLayout];
