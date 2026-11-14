import { inject } from "@adonisjs/core";
import { DateTime } from "luxon";
import RunDesignGenerationJob from "#modules/design_lab/jobs/run_design_generation_job";
import DesignAsset from "#modules/design_lab/models/design_asset";
import DesignGeneration from "#modules/design_lab/models/design_generation";
import DesignProject from "#modules/design_lab/models/design_project";
import {
	type GenerationInputs,
	LIMITS,
	oneLine,
	PROMPT_VERSION,
	personalDataProblem,
} from "#modules/design_lab/prompt";
import { canRetry } from "#modules/design_lab/rules";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import DesignProviders from "#modules/design_lab/services/design_providers";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import DesignUsageService from "#modules/design_lab/services/design_usage_service";
import { designLabSettings } from "#modules/design_lab/settings";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import ImageService from "#modules/media/services/image_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";
import { dispatchInTransaction } from "#services/queue";

type TenantRef = Pick<Tenant, "id">;

/** A refusal meant for the form, on one field. */
export class DesignLabRuleError extends Error {
	constructor(
		readonly field: string,
		message: string,
	) {
		super(message);
	}
}

export const PROJECTS_PER_PAGE = 24;
/** The generations a project page lists, newest first. */
export const GENERATIONS_LISTED = 60;
/** The images one design project may hold; keeps a page and its signed URLs bounded. */
export const MAX_GENERATIONS_PER_PROJECT = 200;

export type GenerationRequest = {
	requestId: string;
	variations: number;
	acknowledged: boolean;
	concept: string;
	style: GenerationInputs["style"];
	customStyle?: string;
	subject?: string;
	lettering?: string;
	palette: GenerationInputs["palette"];
	orientation: GenerationInputs["orientation"];
	detail: GenerationInputs["detail"];
	bodyArea: GenerationInputs["bodyArea"];
};

/**
 * AI Design Lab's product flow (docs/design-lab.md). Every read and write
 * is scoped to the tenant from the URL, and to the member: owners reach the
 * studio's every design project, an artist only the ones they started (the
 * `scope` rule; anything else is the same 404 as another studio's). A linked
 * tattoo project must be one the member may open (ProjectService.findFor).
 * Client data never enters a generation: the inputs are the artist's own
 * structured choices and short texts.
 */
@inject()
export default class DesignLabService {
	constructor(
		private projects: ProjectService,
		private usage: DesignUsageService,
		private images: ImageService,
		private providers: DesignProviders,
	) {}

	async listProjects(
		tenant: TenantRef,
		member: Member,
		{ archived, page }: { archived: boolean; page: number },
	) {
		const query = this.scoped(tenant, member);
		if (archived) query.where("review_state", "archived");
		else query.whereNot("review_state", "archived");
		return query
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.paginate(page, PROJECTS_PER_PAGE);
	}

	/** The member's design project with this id, else E_ROW_NOT_FOUND (a 404). */
	async findProject(
		tenant: TenantRef,
		member: Member,
		id: string,
	): Promise<DesignProject> {
		return this.scoped(tenant, member).where("id", id).firstOrFail();
	}

	async createProject(
		tenant: TenantRef,
		member: Member,
		input: { title?: string; tattooProjectId?: string },
	): Promise<DesignProject> {
		const tattooProjectId = input.tattooProjectId
			? await this.linkable(tenant, member, input.tattooProjectId)
			: null;
		return DesignProject.create({
			tenantId: tenant.id,
			createdBy: member.userId,
			tattooProjectId,
			title: oneLine(input.title ?? "") || "Untitled design",
			reviewState: "exploring",
		});
	}

	async updateProject(
		tenant: TenantRef,
		member: Member,
		id: string,
		input: {
			title: string;
			notes?: string;
			tattooProjectId?: string;
			archived?: boolean;
		},
	): Promise<DesignProject> {
		return withTransaction(async () => {
			const project = await this.scoped(tenant, member)
				.where("id", id)
				.forUpdate()
				.firstOrFail();
			project.title = oneLine(input.title) || project.title;
			project.notes = input.notes?.trim() ? input.notes.trim() : null;
			if (input.tattooProjectId === undefined) {
				project.tattooProjectId = null;
			} else if (input.tattooProjectId !== project.tattooProjectId) {
				project.tattooProjectId = await this.linkable(
					tenant,
					member,
					input.tattooProjectId,
				);
			}
			if (input.archived) project.reviewState = "archived";
			else if (project.reviewState === "archived") {
				project.reviewState = (await this.selectedAsset(tenant, project.id))
					? "decided"
					: "exploring";
			}
			await project.save();
			return project;
		});
	}

	/** The project's generations, newest first, with their assets. */
	async generations(tenant: TenantRef, project: DesignProject) {
		const generations = await DesignGeneration.query()
			.where("tenant_id", tenant.id)
			.where("design_project_id", project.id)
			.orderBy("created_at", "desc")
			.orderBy("variant_index", "asc")
			.limit(GENERATIONS_LISTED);
		const assets = await DesignAsset.query()
			.where("tenant_id", tenant.id)
			.whereIn(
				"generation_id",
				generations.map((generation) => generation.id),
			);
		const byGeneration = new Map(
			assets.map((asset) => [asset.generationId, asset]),
		);
		return generations.map((generation) => ({
			generation,
			asset: byGeneration.get(generation.id) ?? null,
		}));
	}

	/** Each design project's newest stored image (the list's thumbnails). */
	async covers(tenant: TenantRef, projectIds: string[]) {
		if (projectIds.length === 0) return new Map<string, DesignAsset>();
		const assets = await DesignAsset.query()
			.where("tenant_id", tenant.id)
			.whereIn("design_project_id", projectIds)
			.orderByRaw("selected_at desc nulls last")
			.orderBy("created_at", "desc");
		const covers = new Map<string, DesignAsset>();
		for (const asset of assets) {
			if (!covers.has(asset.designProjectId)) {
				covers.set(asset.designProjectId, asset);
			}
		}
		return covers;
	}

	/** Whether this member has asked for a generation in this studio before (the notice). */
	async hasGenerated(tenant: TenantRef, member: Member): Promise<boolean> {
		const row = await DesignGeneration.query()
			.where("tenant_id", tenant.id)
			.where("created_by", member.userId)
			.select("id")
			.first();
		return row !== null;
	}

	/**
	 * Accepts a submit: one generation row per variation, each reserved in
	 * the allowance and queued, all in one transaction. A repeated submit of
	 * the same form (`requestId`: a double click, a retried request) changes
	 * nothing and returns `replayed`.
	 */
	async submit(
		tenant: TenantRef,
		member: Member,
		project: DesignProject,
		request: GenerationRequest,
	): Promise<{ replayed: boolean; generations: DesignGeneration[] }> {
		const provider = this.providers.current();
		if (!provider) {
			throw new DesignLabRuleError(
				"concept",
				"Generation is turned off for now.",
			);
		}
		const settings = designLabSettings();
		const inputs = this.inputsOf(request);
		if (request.variations > settings.maxVariations) {
			throw new DesignLabRuleError(
				"variations",
				`Ask for at most ${settings.maxVariations} variations at once.`,
			);
		}
		return withTransaction(async (trx) => {
			// Serialises this studio's submits, so a repeated form is seen and
			// the allowance check holds (DesignUsageService takes it again).
			await trx.rawQuery(
				"select pg_advisory_xact_lock(hashtextextended(?, 0))",
				[`design_usage:${tenant.id}`],
			);
			const existing = await DesignGeneration.query()
				.where("tenant_id", tenant.id)
				.where("request_id", request.requestId)
				.orderBy("variant_index");
			if (existing.length > 0) {
				if (existing[0].designProjectId !== project.id) {
					throw new DesignLabRuleError(
						"concept",
						"This form was already used. Reload the page to generate again.",
					);
				}
				return { replayed: true, generations: existing };
			}
			const live = await DesignProject.query()
				.where("tenant_id", tenant.id)
				.where("id", project.id)
				.forUpdate()
				.firstOrFail();
			if (live.reviewState === "archived") {
				throw new DesignLabRuleError(
					"concept",
					"This design project is archived. Restore it to generate.",
				);
			}
			if (!request.acknowledged && !(await this.hasGenerated(tenant, member))) {
				throw new DesignLabRuleError(
					"acknowledged",
					"Confirm you have read how generation requests are handled.",
				);
			}
			const count = await DesignGeneration.query()
				.where("tenant_id", tenant.id)
				.where("design_project_id", project.id)
				.count("* as total")
				.first();
			if (
				Number(count?.$extras.total ?? 0) + request.variations >
				MAX_GENERATIONS_PER_PROJECT
			) {
				throw new DesignLabRuleError(
					"concept",
					`A design project holds up to ${MAX_GENERATIONS_PER_PROJECT} concepts. Start a new project to keep going.`,
				);
			}
			const now = DateTime.now();
			const generations: DesignGeneration[] = [];
			for (let index = 0; index < request.variations; index++) {
				generations.push(
					await DesignGeneration.create({
						tenantId: tenant.id,
						designProjectId: project.id,
						createdBy: member.userId,
						requestId: request.requestId,
						variantIndex: index,
						provider: provider.name,
						model: provider.model,
						promptVersion: PROMPT_VERSION,
						inputs,
						status: "queued",
						attempt: 1,
						step: 0,
						acceptedAt: now,
					}),
				);
			}
			await this.usage.reserve(
				tenant,
				member.userId,
				generations.map((generation) => ({
					generationId: generation.id,
					attempt: 1,
					provider: generation.provider,
					model: generation.model,
				})),
			);
			for (const generation of generations) {
				await dispatchInTransaction(
					RunDesignGenerationJob.dispatch({
						tenantId: tenant.id,
						generationId: generation.id,
						attempt: 1,
						step: 0,
					}),
					trx,
				);
			}
			return { replayed: false, generations };
		});
	}

	/**
	 * Runs an eligible failed generation again in place (`canRetry`), as its
	 * next attempt with a new reservation. `attempt` is the attempt the page
	 * showed: a second click, or a retry of an attempt already retried,
	 * changes nothing and returns false.
	 */
	async retry(
		tenant: TenantRef,
		member: Member,
		generationId: string,
		attempt: number,
	): Promise<boolean> {
		return withTransaction(async (trx) => {
			// The access check first (a 404 for another member's), then the lock.
			const seen = await DesignGeneration.query()
				.where("tenant_id", tenant.id)
				.where("id", generationId)
				.select("design_project_id")
				.firstOrFail();
			const project = await this.findProject(
				tenant,
				member,
				seen.designProjectId,
			);
			const generation = await DesignGeneration.query()
				.where("tenant_id", tenant.id)
				.where("id", generationId)
				.forUpdate()
				.firstOrFail();
			if (generation.attempt !== attempt) return false;
			if (
				!canRetry(generation.status, generation.failureCode, generation.attempt)
			) {
				throw new DesignLabRuleError(
					"attempt",
					"This generation can't be retried. Start a new one instead.",
				);
			}
			if (project.reviewState === "archived") {
				throw new DesignLabRuleError(
					"attempt",
					"This design project is archived. Restore it to generate.",
				);
			}
			const provider = this.providers.current();
			if (!provider) {
				throw new DesignLabRuleError(
					"attempt",
					"Generation is turned off for now.",
				);
			}
			generation.attempt += 1;
			generation.step += 1;
			generation.status = "queued";
			generation.failureCode = null;
			generation.finishedAt = null;
			generation.submittedAt = null;
			generation.providerRequestId = null;
			generation.pollingUrlSealed = null;
			generation.providerMeta = null;
			generation.provider = provider.name;
			generation.model = provider.model;
			generation.acceptedAt = DateTime.now();
			await generation.save();
			await this.usage.reserve(tenant, member.userId, [
				{
					generationId: generation.id,
					attempt: generation.attempt,
					provider: generation.provider,
					model: generation.model,
				},
			]);
			await dispatchInTransaction(
				RunDesignGenerationJob.dispatch({
					tenantId: tenant.id,
					generationId: generation.id,
					attempt: generation.attempt,
					step: generation.step,
				}),
				trx,
			);
			return true;
		});
	}

	/** The member's asset with this id and its project, else a 404. */
	async findAsset(tenant: TenantRef, member: Member, id: string) {
		const asset = await DesignAsset.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
		const project = await this.findProject(
			tenant,
			member,
			asset.designProjectId,
		);
		return { asset, project };
	}

	async updateAsset(
		tenant: TenantRef,
		member: Member,
		id: string,
		input: { title?: string; notes?: string },
	): Promise<DesignAsset> {
		const { asset } = await this.findAsset(tenant, member, id);
		asset.title = input.title ? oneLine(input.title) || null : null;
		asset.notes = input.notes?.trim() ? input.notes.trim() : null;
		await asset.save();
		return asset;
	}

	/**
	 * Marks the asset as the project's preferred concept (one per project),
	 * or clears it; the project's review state follows.
	 */
	async selectAsset(
		tenant: TenantRef,
		member: Member,
		id: string,
		selected: boolean,
	): Promise<void> {
		await withTransaction(async () => {
			const { asset, project } = await this.findAsset(tenant, member, id);
			const live = await DesignProject.query()
				.where("tenant_id", tenant.id)
				.where("id", project.id)
				.forUpdate()
				.firstOrFail();
			await DesignAsset.query()
				.where("tenant_id", tenant.id)
				.where("design_project_id", live.id)
				.whereNotNull("selected_at")
				.update({ selected_at: null, updated_at: new Date() });
			if (selected) {
				await DesignAsset.query()
					.where("tenant_id", tenant.id)
					.where("id", asset.id)
					.update({ selected_at: new Date(), updated_at: new Date() });
			}
			if (live.reviewState !== "archived") {
				live.reviewState = selected ? "decided" : "exploring";
				await live.save();
			}
		});
	}

	/** An asset's file for download, after the scoped load. */
	async assetFile(tenant: TenantRef, member: Member, id: string) {
		const { asset, project } = await this.findAsset(tenant, member, id);
		const file = await this.images.read(
			"design_concept",
			asset.imageKey,
			tenant,
		);
		const name = slug(asset.title || project.title) || "design-concept";
		const extension = file.contentType === "image/png" ? "png" : "jpg";
		return { ...file, filename: `${name}-ai-concept.${extension}` };
	}

	/** Validated, trimmed inputs, or a DesignLabRuleError naming the field. */
	inputsOf(request: GenerationRequest): GenerationInputs {
		const text = (field: string, value: string | undefined, max: number) => {
			const trimmed = value === undefined ? "" : oneLine(value);
			if (!trimmed) return null;
			if (trimmed.length > max) {
				throw new DesignLabRuleError(field, `Use ${max} characters or fewer.`);
			}
			const problem = personalDataProblem(trimmed);
			if (problem) throw new DesignLabRuleError(field, problem);
			return trimmed;
		};
		const concept = text("concept", request.concept, LIMITS.concept.max);
		if (!concept || concept.length < LIMITS.concept.min) {
			throw new DesignLabRuleError(
				"concept",
				"Describe the concept in a few words.",
			);
		}
		const customStyle =
			request.style === "custom"
				? text("customStyle", request.customStyle, LIMITS.customStyle.max)
				: null;
		if (request.style === "custom" && !customStyle) {
			throw new DesignLabRuleError("customStyle", "Describe the style.");
		}
		const lettering =
			request.style === "lettering"
				? text("lettering", request.lettering, LIMITS.lettering.max)
				: null;
		return {
			concept,
			style: request.style,
			customStyle,
			subject: text("subject", request.subject, LIMITS.subject.max),
			lettering,
			palette: request.palette,
			orientation: request.orientation,
			detail: request.detail,
			bodyArea: request.bodyArea,
		};
	}

	/** Statuses for the page's poll: ids, statuses and attempts only. */
	async statuses(tenant: TenantRef, project: DesignProject) {
		return DesignGeneration.query()
			.where("tenant_id", tenant.id)
			.where("design_project_id", project.id)
			.orderBy("created_at", "desc")
			.orderBy("variant_index", "asc")
			.limit(GENERATIONS_LISTED)
			.select("id", "status", "attempt");
	}

	/** The live tattoo projects among `ids` the member may open. */
	async tattooProjects(tenant: TenantRef, member: Member, ids: string[]) {
		return this.projects.findManyFor(tenant, member, ids);
	}

	/** The tattoo projects a member may link: their open ones. */
	async linkableProjects(tenant: TenantRef, member: Member) {
		return this.projects.listActive(tenant, member);
	}

	/** The member's live design projects: every one for owners, their own for artists. */
	private scoped(tenant: TenantRef, member: Member) {
		const query = DesignProject.query().where("tenant_id", tenant.id);
		if (member.role !== "owner") query.where("created_by", member.userId);
		return query;
	}

	private async linkable(
		tenant: TenantRef,
		member: Member,
		tattooProjectId: string,
	): Promise<string> {
		try {
			const project = await this.projects.findFor(
				tenant,
				member,
				tattooProjectId,
			);
			return project.id;
		} catch (error) {
			// Only "not one of yours": a database error must surface as itself.
			if ((error as { code?: string }).code !== "E_ROW_NOT_FOUND") throw error;
			throw new DesignLabRuleError(
				"tattooProjectId",
				"Choose one of your studio's projects.",
			);
		}
	}

	private selectedAsset(tenant: TenantRef, projectId: string) {
		return DesignAsset.query()
			.where("tenant_id", tenant.id)
			.where("design_project_id", projectId)
			.whereNotNull("selected_at")
			.first();
	}
}

/** A filename-safe slug: ASCII letters and digits, hyphens between words. */
export function slug(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/[^\x20-\x7e]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}
