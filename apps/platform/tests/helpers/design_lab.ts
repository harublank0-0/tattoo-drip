import { randomUUID } from "node:crypto";
import app from "@adonisjs/core/services/app";
import { DateTime } from "luxon";
import DesignAsset from "#modules/design_lab/models/design_asset";
import DesignGeneration from "#modules/design_lab/models/design_generation";
import DesignProject from "#modules/design_lab/models/design_project";
import DesignUsageRecord from "#modules/design_lab/models/design_usage_record";
import type { GenerationInputs } from "#modules/design_lab/prompt";
import { PROMPT_VERSION } from "#modules/design_lab/prompt";
import {
	type DesignProvider,
	DesignProviderError,
	type PollResult,
	type SubmitRequest,
	type Submitted,
} from "#modules/design_lab/providers/types";
import DesignProviders from "#modules/design_lab/services/design_providers";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { testImages } from "#tests/helpers/images";
import { inTenant } from "#tests/helpers/tenants";

/**
 * An in-memory image provider for the tests (docs/design-lab.md): every
 * suite gets it through `installFakeDesignProvider()` in tests/bootstrap.ts,
 * so no test reaches BFL or spends a credit. It records each call (never
 * the key: it has none), answers like the hosted API by default (submit,
 * one pending poll, then ready) and can be told what to answer next.
 */
export class FakeDesignProvider implements DesignProvider {
	readonly name = "fake";
	readonly model = "fake-model-1";
	submits: SubmitRequest[] = [];
	polls: string[] = [];
	downloads: string[] = [];
	/** Answers for the next submits, first first; a throw when it is an error. */
	nextSubmits: (Submitted | DesignProviderError)[] = [];
	/** Answers for the next polls; default: one pending, then ready. */
	nextPolls: (PollResult | DesignProviderError)[] = [];
	/** Answers for the next downloads. */
	nextDownloads: (Buffer | DesignProviderError)[] = [];

	async submit(request: SubmitRequest): Promise<Submitted> {
		this.submits.push(request);
		const next = this.nextSubmits.shift();
		if (next instanceof DesignProviderError) throw next;
		if (next) return next;
		const id = `fake-${randomUUID()}`;
		return {
			requestId: id,
			pollingUrl: `https://api.fake-provider.test/v1/get_result?id=${id}`,
			cost: 4,
		};
	}

	async poll(pollingUrl: string): Promise<PollResult> {
		this.polls.push(pollingUrl);
		const next = this.nextPolls.shift();
		if (next instanceof DesignProviderError) throw next;
		if (next) return next;
		return {
			state: "ready",
			sampleUrl: "https://delivery.fake-provider.test/sample.png",
			seed: 42,
		};
	}

	async download(sampleUrl: string): Promise<Buffer> {
		this.downloads.push(sampleUrl);
		const next = this.nextDownloads.shift();
		if (next instanceof DesignProviderError) throw next;
		if (next) return next;
		return await testImages.png(832, 1216);
	}

	reset() {
		this.submits = [];
		this.polls = [];
		this.downloads = [];
		this.nextSubmits = [];
		this.nextPolls = [];
		this.nextDownloads = [];
	}
}

export const designProvider = new FakeDesignProvider();

class FakeDesignProviders extends DesignProviders {
	/** Null while a test turns the provider off. */
	off = false;

	current(): DesignProvider | null {
		return this.off ? null : designProvider;
	}
}

export const designProviders = new FakeDesignProviders();

export function installFakeDesignProvider() {
	app.container.swap(DesignProviders, () => designProviders);
}

export const sampleInputs = (
	overrides: Partial<GenerationInputs> = {},
): GenerationInputs => ({
	concept: "A koi fish swimming upward through peonies",
	style: "japanese",
	customStyle: null,
	subject: "Koi fish",
	lettering: null,
	palette: "black_grey",
	orientation: "portrait",
	detail: "balanced",
	bodyArea: "forearm",
	...overrides,
});

/** A valid generate form for the HTTP routes. */
export const generateForm = (overrides: Record<string, unknown> = {}) => ({
	requestId: randomUUID(),
	variations: "1",
	acknowledged: "true",
	concept: "A koi fish swimming upward through peonies",
	style: "japanese",
	subject: "Koi fish",
	palette: "black_grey",
	orientation: "portrait",
	detail: "balanced",
	bodyArea: "forearm",
	...overrides,
});

/**
 * One studio's Design Lab records, made by its artist: a design project
 * (`designProject`), a failed generation that may be retried
 * (`designGeneration`, attempt 1, its usage released) and a completed one
 * with its stored image (`designAsset`, a real file on the test disk, so
 * the download route has bytes to send).
 */
export async function seedDesignLab(tenant: Tenant, artist: { id: string }) {
	return inTenant(tenant, async () => {
		const designProject = await DesignProject.create({
			tenantId: tenant.id,
			createdBy: artist.id,
			title: "Koi sleeve ideas",
			reviewState: "exploring",
		});
		const now = DateTime.now();
		const base = {
			tenantId: tenant.id,
			designProjectId: designProject.id,
			createdBy: artist.id,
			provider: designProvider.name,
			model: designProvider.model,
			promptVersion: PROMPT_VERSION,
			inputs: sampleInputs(),
			acceptedAt: now,
		};
		const designGeneration = await DesignGeneration.create({
			...base,
			requestId: randomUUID(),
			variantIndex: 0,
			status: "failed",
			failureCode: "provider_error",
			attempt: 1,
			step: 3,
			finishedAt: now,
		});
		const completed = await DesignGeneration.create({
			...base,
			requestId: randomUUID(),
			variantIndex: 0,
			status: "completed",
			attempt: 1,
			step: 6,
			providerRequestId: "fake-seeded",
			pollingUrlSealed: "sealed",
			submittedAt: now,
			finishedAt: now,
		});
		for (const [generation, status] of [
			[designGeneration, "released"],
			[completed, "settled"],
		] as const) {
			await DesignUsageRecord.create({
				tenantId: tenant.id,
				generationId: generation.id,
				attempt: 1,
				userId: artist.id,
				provider: generation.provider,
				model: generation.model,
				units: 1,
				status,
				reservedAt: now,
				...(status === "settled"
					? { settledAt: now }
					: { releasedAt: now, releaseReason: "provider_error" }),
			});
		}
		const image = await new ImageService().storeBytes(
			await testImages.png(400, 600),
			{
				tenant,
				purpose: "design_concept",
			},
		);
		const designAsset = await DesignAsset.create({
			tenantId: tenant.id,
			designProjectId: designProject.id,
			generationId: completed.id,
			imageKey: image.key,
			width: image.width,
			height: image.height,
		});
		return { designProject, designGeneration, designAsset };
	});
}

/** Every Design Lab row of `tenant`, for snapshots. */
export function designLabRows(tenant: { id: string }) {
	return inTenant(tenant, async () => ({
		projects: (await DesignProject.withTrashed().orderBy("id")).map((row) =>
			row.serialize(),
		),
		generations: (await DesignGeneration.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
		assets: (await DesignAsset.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
		usage: (await DesignUsageRecord.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
	}));
}
