import { randomUUID } from "node:crypto";
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import ClientService from "#modules/clients/services/client_service";
import type DesignAsset from "#modules/design_lab/models/design_asset";
import type DesignGeneration from "#modules/design_lab/models/design_generation";
import type DesignProject from "#modules/design_lab/models/design_project";
import { providerNotice } from "#modules/design_lab/notice";
import {
	buildPrompt,
	inputsLabel,
	PROMPT_VERSION,
	promptChoices,
} from "#modules/design_lab/prompt";
import {
	canRetry,
	FAILURE_MESSAGES,
	isFinal,
	STATUS_LABELS,
} from "#modules/design_lab/rules";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import DesignLabService, {
	DesignLabRuleError,
} from "#modules/design_lab/services/design_lab_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import DesignUsageService, {
	AllowanceError,
} from "#modules/design_lab/services/design_usage_service";
import {
	designLabEnabled,
	designLabSettings,
} from "#modules/design_lab/settings";
import {
	createDesignProjectValidator,
	generationValidator,
	retryGenerationValidator,
	selectDesignAssetValidator,
	updateDesignAssetValidator,
	updateDesignProjectValidator,
} from "#modules/design_lab/validators/design_lab";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import ImageService, {
	THUMBNAIL_WIDTH,
} from "#modules/media/services/image_service";
import { formatDay } from "#modules/projects/quotes";
import type { Member } from "#modules/projects/services/project_service";
import type Tenant from "#modules/tenancy/models/tenant";

const pageNumber = (value: unknown) =>
	typeof value === "string" && /^[1-9]\d{0,7}$/.test(value) ? Number(value) : 1;

/** A service refusal as the form's field error (the request still fails and rolls back). */
async function asFieldErrors<T>(work: () => Promise<T>) {
	try {
		return await work();
	} catch (error) {
		if (error instanceof DesignLabRuleError) {
			throw new errors.E_VALIDATION_ERROR([
				{ field: error.field, message: error.message, rule: "design_lab" },
			]);
		}
		if (error instanceof AllowanceError) {
			throw new errors.E_VALIDATION_ERROR([
				{ field: "variations", message: error.message, rule: "allowance" },
			]);
		}
		throw error;
	}
}

/**
 * AI Design Lab (docs/design-lab.md): every member's private concept
 * workspace. TENANT_ROUTE_ROLES opens these routes to every member;
 * DesignLabService scopes each record (owners every design project, an
 * artist their own). While DESIGN_LAB_PROVIDER is off every route is a 404.
 * Pages never receive a provider URL, a polling URL, the prompt's provider
 * settings or any key: only TattooDrip's ids, statuses and signed URLs of
 * the studio's own stored images.
 */
@inject()
export default class DesignLabController {
	constructor(
		private lab: DesignLabService,
		private usage: DesignUsageService,
		private images: ImageService,
		private clients: ClientService,
	) {}

	async index(ctx: HttpContext) {
		if (!designLabEnabled()) return ctx.response.notFound();
		const { tenant, membership } = tenantContext(ctx);
		const archived = ctx.request.qs().view === "archived";
		const page = await this.lab.listProjects(tenant, membership, {
			archived,
			page: pageNumber(ctx.request.qs().page),
		});
		const projects = page.all();
		const covers = await this.lab.covers(
			tenant,
			projects.map((project) => project.id),
		);
		const linked = await this.linkedLabels(tenant, membership, projects);
		return ctx.inertia.render("design_lab/index", {
			projects: await Promise.all(
				projects.map(async (project) => {
					const cover = covers.get(project.id);
					return {
						id: project.id,
						title: project.title,
						reviewState: project.reviewState,
						linked: linked.get(project.id) ?? null,
						createdOn: formatDay(
							project.createdAt.setZone(tenant.timezone).toISODate() ?? "",
						),
						cover: cover
							? await this.images.urlFor(
									"design_concept",
									cover.imageKey,
									tenant,
									THUMBNAIL_WIDTH,
								)
							: null,
					};
				}),
			),
			view: archived ? "archived" : "active",
			page: page.currentPage,
			lastPage: page.lastPage,
			allowance: await this.usage.allowance(tenant),
			linkable: await this.linkableOptions(tenant, membership),
		});
	}

	async store(ctx: HttpContext) {
		if (!designLabEnabled()) return ctx.response.notFound();
		const { tenant, membership } = tenantContext(ctx);
		const input = await ctx.request.validateUsing(createDesignProjectValidator);
		const project = await asFieldErrors(() =>
			this.lab.createProject(tenant, membership, input),
		);
		ctx.session.flash("success", "Design project started.");
		return ctx.response.redirect().toRoute("tenant.design_lab.show", {
			tenant: tenant.slug,
			id: project.id,
		});
	}

	async show(ctx: HttpContext) {
		if (!designLabEnabled()) return ctx.response.notFound();
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.lab.findProject(
			tenant,
			membership,
			ctx.params.id,
		);
		const rows = await this.lab.generations(tenant, project);
		const linked = await this.linkedLabels(tenant, membership, [project]);
		const settings = designLabSettings();
		return ctx.inertia.render("design_lab/show", {
			project: {
				id: project.id,
				title: project.title,
				notes: project.notes,
				reviewState: project.reviewState,
				tattooProjectId: project.tattooProjectId,
				linked: linked.get(project.id) ?? null,
			},
			generations: await Promise.all(
				rows.map(({ generation, asset }) =>
					this.generationView(tenant, generation, asset),
				),
			),
			allowance: await this.usage.allowance(tenant),
			maxVariations: settings.maxVariations,
			choices: promptChoices(),
			promptVersion: PROMPT_VERSION,
			needsAcknowledgement: !(await this.lab.hasGenerated(tenant, membership)),
			notice: providerNotice(settings.provider),
			linkable: await this.linkableOptions(tenant, membership),
			requestId: randomUUID(),
		});
	}

	async update(ctx: HttpContext) {
		if (!designLabEnabled()) return ctx.response.notFound();
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.lab.findProject(
			tenant,
			membership,
			ctx.params.id,
		);
		const input = await ctx.request.validateUsing(updateDesignProjectValidator);
		const saved = await asFieldErrors(() =>
			this.lab.updateProject(tenant, membership, project.id, input),
		);
		ctx.session.flash(
			"success",
			saved.reviewState === "archived"
				? "Design project archived."
				: "Design project saved.",
		);
		return ctx.response.redirect().toRoute("tenant.design_lab.show", {
			tenant: tenant.slug,
			id: project.id,
		});
	}

	async generate(ctx: HttpContext) {
		if (!designLabEnabled()) return ctx.response.notFound();
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.lab.findProject(
			tenant,
			membership,
			ctx.params.id,
		);
		const input = await ctx.request.validateUsing(generationValidator);
		const result = await asFieldErrors(() =>
			this.lab.submit(tenant, membership, project, {
				...input,
				acknowledged: input.acknowledged === true,
			}),
		);
		const count = result.generations.length;
		ctx.session.flash(
			"success",
			result.replayed
				? "Those concepts were already requested. Nothing new was added."
				: count === 1
					? "Concept queued. It usually takes under a minute."
					: `${count} concepts queued. They usually take under a minute.`,
		);
		return ctx.response.redirect().toRoute("tenant.design_lab.show", {
			tenant: tenant.slug,
			id: project.id,
		});
	}

	/** The page's poll: TattooDrip's own ids and statuses, nothing of the provider's. */
	async status(ctx: HttpContext) {
		if (!designLabEnabled()) return ctx.response.notFound();
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.lab.findProject(
			tenant,
			membership,
			ctx.params.id,
		);
		const rows = await this.lab.statuses(tenant, project);
		ctx.response.header("Cache-Control", "private, no-store");
		return {
			generations: rows.map((row) => ({
				id: row.id,
				status: row.status,
				attempt: row.attempt,
			})),
			pending: rows.some((row) => !isFinal(row.status)),
		};
	}

	async retry(ctx: HttpContext) {
		if (!designLabEnabled()) return ctx.response.notFound();
		const { tenant, membership } = tenantContext(ctx);
		const { attempt } = await ctx.request.validateUsing(
			retryGenerationValidator,
		);
		const retried = await asFieldErrors(() =>
			this.lab.retry(tenant, membership, ctx.params.id, attempt),
		);
		ctx.session.flash(
			"success",
			retried
				? "Trying that concept again."
				: "That concept was already retried. Nothing new was added.",
		);
		return ctx.response.redirect().back();
	}

	async updateAsset(ctx: HttpContext) {
		if (!designLabEnabled()) return ctx.response.notFound();
		const { tenant, membership } = tenantContext(ctx);
		const { asset } = await this.lab.findAsset(
			tenant,
			membership,
			ctx.params.id,
		);
		const input = await ctx.request.validateUsing(updateDesignAssetValidator);
		await this.lab.updateAsset(tenant, membership, asset.id, input);
		ctx.session.flash("success", "Concept saved.");
		return ctx.response.redirect().toRoute("tenant.design_lab.show", {
			tenant: tenant.slug,
			id: asset.designProjectId,
		});
	}

	async selectAsset(ctx: HttpContext) {
		if (!designLabEnabled()) return ctx.response.notFound();
		const { tenant, membership } = tenantContext(ctx);
		const { asset } = await this.lab.findAsset(
			tenant,
			membership,
			ctx.params.id,
		);
		const { selected } = await ctx.request.validateUsing(
			selectDesignAssetValidator,
		);
		await this.lab.selectAsset(tenant, membership, asset.id, selected);
		ctx.session.flash(
			"success",
			selected
				? "Marked as the preferred concept."
				: "Preferred concept cleared.",
		);
		return ctx.response.redirect().toRoute("tenant.design_lab.show", {
			tenant: tenant.slug,
			id: asset.designProjectId,
		});
	}

	async download(ctx: HttpContext) {
		if (!designLabEnabled()) return ctx.response.notFound();
		const { tenant, membership } = tenantContext(ctx);
		const file = await this.lab.assetFile(tenant, membership, ctx.params.id);
		ctx.response.header("Content-Type", file.contentType);
		ctx.response.header(
			"Content-Disposition",
			`attachment; filename="${file.filename}"`,
		);
		ctx.response.header("Cache-Control", "private, no-store");
		ctx.response.header("X-Content-Type-Options", "nosniff");
		return ctx.response.send(Buffer.from(file.bytes));
	}

	private async generationView(
		tenant: Pick<Tenant, "id" | "timezone">,
		generation: DesignGeneration,
		asset: DesignAsset | null,
	) {
		const failure = generation.failureCode
			? FAILURE_MESSAGES[generation.failureCode]
			: null;
		return {
			id: generation.id,
			status: generation.status,
			statusLabel: STATUS_LABELS[generation.status],
			attempt: generation.attempt,
			failure,
			canRetry: canRetry(
				generation.status,
				generation.failureCode,
				generation.attempt,
			),
			label: inputsLabel(generation.inputs),
			requestedAt: generation.createdAt
				.setZone(tenant.timezone)
				.toFormat("d LLL yyyy, HH:mm"),
			// How it was made: the artist's own inputs, the template version and
			// the prompt the server built from them. Never the provider's URLs.
			inputs: generation.inputs,
			promptVersion: generation.promptVersion,
			prompt: buildPrompt(generation.inputs),
			model: generation.model,
			asset: asset
				? {
						id: asset.id,
						title: asset.title,
						notes: asset.notes,
						width: asset.width,
						height: asset.height,
						selected: asset.selectedAt !== null,
						url: await this.images.url(
							"design_concept",
							asset.imageKey,
							tenant,
						),
						thumbnailUrl: await this.images.urlFor(
							"design_concept",
							asset.imageKey,
							tenant,
							640,
						),
					}
				: null,
		};
	}

	/** "Client name · 3 Nov 2026" for each linked tattoo project the member may open. */
	private async linkedLabels(
		tenant: Pick<Tenant, "id" | "timezone">,
		member: Member,
		projects: DesignProject[],
	) {
		const ids = projects.flatMap((project) =>
			project.tattooProjectId ? [project.tattooProjectId] : [],
		);
		const options = await this.projectOptions(tenant, member, ids);
		const labels = new Map<string, { id: string; label: string }>();
		for (const project of projects) {
			const option = project.tattooProjectId
				? options.get(project.tattooProjectId)
				: undefined;
			if (option) labels.set(project.id, option);
		}
		return labels;
	}

	private async linkableOptions(
		tenant: Pick<Tenant, "id" | "timezone">,
		member: Member,
	) {
		const active = await this.lab.linkableProjects(tenant, member);
		const options = await this.projectOptions(
			tenant,
			member,
			active.map((project) => project.id),
		);
		return [...options.values()];
	}

	private async projectOptions(
		tenant: Pick<Tenant, "id" | "timezone">,
		member: Member,
		ids: string[],
	) {
		const projects = await this.lab.tattooProjects(tenant, member, ids);
		const clients = new Map(
			(
				await this.clients.findMany(
					tenant,
					projects.map((project) => project.clientId),
				)
			).map((client) => [client.id, client]),
		);
		const options = new Map<string, { id: string; label: string }>();
		for (const project of projects.sort(
			(a, b) => b.createdAt.toMillis() - a.createdAt.toMillis(),
		)) {
			const name = clients.get(project.clientId)?.name ?? "A client";
			const day = formatDay(
				project.createdAt.setZone(tenant.timezone).toISODate() ?? "",
			);
			options.set(project.id, { id: project.id, label: `${name} · ${day}` });
		}
		return options;
	}
}
