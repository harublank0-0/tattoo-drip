import { createHmac } from "node:crypto";
import { inject } from "@adonisjs/core";
import encryption from "@adonisjs/core/services/encryption";
import logger from "@adonisjs/core/services/logger";
import { DateTime } from "luxon";
import RunDesignGenerationJob from "#modules/design_lab/jobs/run_design_generation_job";
import DesignAsset from "#modules/design_lab/models/design_asset";
import DesignGeneration from "#modules/design_lab/models/design_generation";
import { buildPrompt, sizeOf } from "#modules/design_lab/prompt";
import {
	type DesignProvider,
	DesignProviderError,
	type PollResult,
} from "#modules/design_lab/providers/types";
import {
	type FailureCode,
	isFinal,
	MODERATION_CODES,
	type ProviderMeta,
} from "#modules/design_lab/rules";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import DesignProviders from "#modules/design_lab/services/design_providers";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import DesignUsageService from "#modules/design_lab/services/design_usage_service";
import { InvalidImageError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withDbContext } from "#services/db_context";
import { dispatchInTransaction } from "#services/queue";
import env from "#start/env";

type TenantRef = Pick<Tenant, "id">;

/**
 * How long a run may hold a generation before its watchdog job takes over.
 * Longer than any one provider call (submit 30 s, download 30 s, store).
 */
export const LEASE_MS = 90_000;
/** A queued generation (provider busy) gives up this long after it was accepted. */
export const QUEUE_DEADLINE_MS = 15 * 60_000;
/** A submitted generation gives up this long after its submit. */
export const RESULT_DEADLINE_MS = 10 * 60_000;
/** Submits refused by a busy or failing provider before giving up. */
export const MAX_SUBMIT_TRIES = 6;
/** Downloads or stores of a ready image before giving up (its URL expires). */
export const MAX_STORE_TRIES = 3;

/** The wait before the n-th poll: 2 s, then a second more every other poll, at most 10 s. */
export const pollDelay = (polls: number) =>
	Math.min(10_000, 2_000 + Math.floor(polls / 2) * 1_000);

/** The wait before the n-th submit after a busy or failing provider: 5 s doubling, at most 2 min. */
export const submitDelay = (tries: number) =>
	Math.min(120_000, 5_000 * 2 ** Math.max(0, tries - 1));

const sealPurpose = (generationId: string) => `design_polling:${generationId}`;

/**
 * The opaque id a provider may take for the member asking (BFL's `user`):
 * an HMAC of the studio and member ids under APP_KEY, stable for a member
 * and meaningless outside TattooDrip. Never a name or an email.
 */
export function endUserId(tenant: TenantRef, userId: string | null): string {
	return createHmac("sha256", env.get("APP_KEY").release())
		.update(`design_lab:${tenant.id}:${userId ?? "former-member"}`)
		.digest("hex")
		.slice(0, 32);
}

/** The polling URL as stored: encrypted with APP_KEY, bound to its generation. */
export function sealPollingUrl(generationId: string, url: string): string {
	return encryption.encrypt(url, undefined, sealPurpose(generationId));
}

export function openPollingUrl(
	generationId: string,
	sealed: string,
): string | null {
	const value = encryption.decrypt<string>(sealed, sealPurpose(generationId));
	return typeof value === "string" ? value : null;
}

/** Private run counters kept in `provider_meta` (never shown to the browser). */
type RunMeta = ProviderMeta & {
	polls?: number;
	submitTries?: number;
	storeTries?: number;
};

type Claim =
	| { action: "submit"; generation: DesignGeneration }
	| { action: "poll"; generation: DesignGeneration; pollingUrl: string };

type Outcome =
	| { kind: "submitted"; requestId: string; pollingUrl: string; cost?: number }
	| { kind: "requeue"; reason: "rate_limited" | "provider_error" }
	| { kind: "pending"; providerStatus?: string }
	| {
			kind: "completed";
			image: { key: string; width: number; height: number };
			seed?: number;
	  }
	| { kind: "store_retry" }
	| { kind: "failed"; code: FailureCode; reasons?: string[] };

/**
 * Drives one generation through the provider (docs/design-lab.md, Worker).
 * Each run of RunDesignGenerationJob is one step, fenced by the row's `step`:
 *
 * 1. Claim, in a short transaction under the row's lock: only a run whose
 *    `step` matches the row's goes on. It bumps `step`, and in the same
 *    transaction queues a watchdog run for the new step LEASE_MS later, so a
 *    worker that dies mid-call is picked up and nothing is lost.
 * 2. Act, with no transaction open: submit, poll or download and store.
 * 3. Write the outcome, in a short transaction under the lock, only if the
 *    row is still at the claimed step (else a watchdog took over: files this
 *    run stored are deleted), and queue the next run (step + 2) for the next
 *    poll. The watchdog for step + 1 then finds nothing to do.
 *
 * Every write is scoped to the payload's tenant (`withDbContext`), under RLS.
 * A repeated delivery of any run finds the step moved on and does nothing.
 * A submit is attempted at most once per attempt: `submitted_at` is set at
 * the claim, and a run that finds it set without a provider id never
 * submits again (the outcome is unknown, so it fails `submit_unconfirmed`,
 * offered for retry by the artist). The studio's allowance is settled once
 * the image is stored and released on every failure, both from `reserved`
 * only (DesignUsageService), so no outcome counts twice.
 */
@inject()
export default class GenerationRunner {
	constructor(
		private providers: DesignProviders,
		private usage: DesignUsageService,
		private images: ImageService,
	) {}

	async run(
		tenant: TenantRef,
		generationId: string,
		attempt: number,
		step: number,
		signal?: AbortSignal,
	): Promise<void> {
		const provider = this.providers.current();
		const claim = await withDbContext({ tenantId: tenant.id }, (trx) =>
			this.claim(trx, tenant, generationId, attempt, step, provider),
		);
		if (!claim || !provider) return;
		const outcome = await this.act(tenant, provider, claim, signal);
		let kept = false;
		try {
			kept = await withDbContext({ tenantId: tenant.id }, (trx) =>
				this.write(trx, tenant, generationId, attempt, step + 1, outcome),
			);
		} finally {
			if (!kept && outcome.kind === "completed") {
				await this.images.delete("design_concept", outcome.image.key);
			}
		}
	}

	/**
	 * The worker gave up on a run (its retries are used up): a generation the
	 * run still owned (`step` unchanged: it never got past its claim) fails
	 * `worker_failed` and its reservation is released.
	 */
	async giveUp(
		tenant: TenantRef,
		generationId: string,
		attempt: number,
		step: number,
	): Promise<void> {
		await withDbContext({ tenantId: tenant.id }, async () => {
			const row = await this.lockRow(tenant, generationId);
			if (!row || row.attempt !== attempt || row.step !== step) return;
			if (isFinal(row.status)) return;
			await this.finish(tenant, row, "worker_failed");
		});
	}

	/**
	 * The stuck sweep (FailStuckDesignGenerationJob): a generation no run has
	 * touched for 30 minutes fails `timed_out`, under its lock; one that moved
	 * meanwhile is left alone. True when it did.
	 */
	async failStuck(tenant: TenantRef, generationId: string): Promise<boolean> {
		return withDbContext({ tenantId: tenant.id }, async () => {
			const row = await this.lockRow(tenant, generationId);
			if (!row || isFinal(row.status)) return false;
			const idleFor = DateTime.now()
				.diff(row.updatedAt ?? row.createdAt)
				.toMillis();
			if (idleFor < 30 * 60_000) return false;
			await this.finish(tenant, row, "timed_out");
			return true;
		});
	}

	private async claim(
		trx: Parameters<typeof dispatchInTransaction>[1],
		tenant: TenantRef,
		generationId: string,
		attempt: number,
		step: number,
		provider: DesignProvider | null,
	): Promise<Claim | null> {
		const row = await this.lockRow(tenant, generationId);
		if (!row || row.attempt !== attempt || row.step !== step) return null;
		if (isFinal(row.status)) return null;
		if (!provider || provider.name !== row.provider) {
			// Switched off, or switched to another provider since it was
			// accepted: this row's request cannot be made or followed.
			await this.finish(tenant, row, "provider_unavailable");
			return null;
		}
		if (row.status === "queued" && row.submittedAt) {
			// A submit started and never wrote its outcome: it may have been
			// accepted and charged, so it is never sent again.
			await this.finish(tenant, row, "submit_unconfirmed");
			return null;
		}
		let claim: Claim;
		if (row.status === "queued") {
			row.submittedAt = DateTime.now();
			claim = { action: "submit", generation: row };
		} else {
			const pollingUrl = row.pollingUrlSealed
				? openPollingUrl(row.id, row.pollingUrlSealed)
				: null;
			if (!pollingUrl) {
				await this.finish(tenant, row, "provider_error");
				return null;
			}
			claim = { action: "poll", generation: row, pollingUrl };
		}
		row.step = step + 1;
		await row.save();
		await dispatchInTransaction(
			RunDesignGenerationJob.dispatch({
				tenantId: tenant.id,
				generationId: row.id,
				attempt,
				step: step + 1,
			}).in(LEASE_MS),
			trx,
		);
		return claim;
	}

	/** The provider call for a claim, with no transaction open. Never throws for a provider failure. */
	private async act(
		tenant: TenantRef,
		provider: DesignProvider,
		claim: Claim,
		signal?: AbortSignal,
	): Promise<Outcome> {
		const { generation } = claim;
		if (claim.action === "submit") {
			const size = sizeOf(generation.inputs.orientation);
			try {
				const submitted = await provider.submit(
					{
						prompt: buildPrompt(generation.inputs),
						endUser: endUserId(tenant, generation.createdBy),
						orientation: generation.inputs.orientation,
						...size,
					},
					signal,
				);
				return { kind: "submitted", ...submitted };
			} catch (error) {
				return submitFailure(error, generation);
			}
		}
		let result: PollResult;
		try {
			result = await provider.poll(claim.pollingUrl, signal);
		} catch (error) {
			return pollFailure(error, generation);
		}
		switch (result.state) {
			case "pending":
				return { kind: "pending", providerStatus: result.providerStatus };
			case "moderated":
				return {
					kind: "failed",
					code: result.code,
					...(result.reasons ? { reasons: result.reasons } : {}),
				};
			case "error":
			case "not_found":
				return { kind: "failed", code: "provider_error" };
			case "ready":
				break;
		}
		try {
			const bytes = await provider.download(result.sampleUrl, signal);
			// As delivered: the provider's provenance data stays in the file.
			const image = await this.images.storeOriginal(bytes, {
				tenant,
				purpose: "design_concept",
			});
			return {
				kind: "completed",
				image,
				...(result.seed === undefined ? {} : { seed: result.seed }),
			};
		} catch (error) {
			if (error instanceof InvalidImageError) {
				return { kind: "failed", code: "provider_error" };
			}
			logger.warn(
				{ err: safeError(error), generationId: generation.id },
				"A Design Lab image could not be downloaded or stored.",
			);
			return { kind: "store_retry" };
		}
	}

	/** Writes `outcome` if the row is still at `claimedStep`: true when it did. */
	private async write(
		trx: Parameters<typeof dispatchInTransaction>[1],
		tenant: TenantRef,
		generationId: string,
		attempt: number,
		claimedStep: number,
		outcome: Outcome,
	): Promise<boolean> {
		const row = await this.lockRow(tenant, generationId);
		if (!row || row.attempt !== attempt || row.step !== claimedStep)
			return false;
		if (isFinal(row.status)) return false;
		const meta: RunMeta = { ...(row.providerMeta ?? {}) };
		const now = DateTime.now();
		let next: number | null = null;

		switch (outcome.kind) {
			case "submitted":
				row.status = "processing";
				row.providerRequestId = outcome.requestId;
				row.pollingUrlSealed = sealPollingUrl(row.id, outcome.pollingUrl);
				if (outcome.cost !== undefined) meta.cost = outcome.cost;
				meta.polls = 0;
				next = pollDelay(0);
				break;
			case "requeue": {
				meta.submitTries = (meta.submitTries ?? 0) + 1;
				const pastDeadline =
					now.diff(row.acceptedAt).toMillis() > QUEUE_DEADLINE_MS;
				if (pastDeadline || meta.submitTries >= MAX_SUBMIT_TRIES) {
					row.providerMeta = meta;
					await this.finish(tenant, row, outcome.reason);
					return true;
				}
				row.submittedAt = null;
				next = submitDelay(meta.submitTries);
				break;
			}
			case "pending":
			case "store_retry": {
				if (outcome.kind === "store_retry") {
					meta.storeTries = (meta.storeTries ?? 0) + 1;
				}
				if (outcome.kind === "pending" && outcome.providerStatus) {
					meta.providerStatus = outcome.providerStatus;
				}
				const submittedAt = row.submittedAt ?? row.acceptedAt;
				const pastDeadline =
					now.diff(submittedAt).toMillis() > RESULT_DEADLINE_MS;
				if ((meta.storeTries ?? 0) >= MAX_STORE_TRIES) {
					row.providerMeta = meta;
					await this.finish(tenant, row, "storage_failed");
					return true;
				}
				if (pastDeadline) {
					row.providerMeta = meta;
					await this.finish(tenant, row, "timed_out");
					return true;
				}
				meta.polls = (meta.polls ?? 0) + 1;
				next = pollDelay(meta.polls);
				break;
			}
			case "completed": {
				if (outcome.seed !== undefined) meta.seed = outcome.seed;
				meta.providerStatus = "Ready";
				await DesignAsset.create({
					tenantId: tenant.id,
					designProjectId: row.designProjectId,
					generationId: row.id,
					imageKey: outcome.image.key,
					width: outcome.image.width,
					height: outcome.image.height,
				});
				row.status = "completed";
				row.finishedAt = now;
				row.providerMeta = meta;
				row.step = claimedStep + 1;
				await row.save();
				await this.usage.settle(
					tenant,
					row.id,
					row.attempt,
					typeof meta.cost === "number" ? meta.cost : null,
				);
				logger.info(
					{ tenantId: tenant.id, generationId: row.id, attempt: row.attempt },
					"Design Lab generation completed.",
				);
				return true;
			}
			case "failed":
				if (outcome.reasons) meta.moderationReasons = outcome.reasons;
				row.providerMeta = meta;
				await this.finish(tenant, row, outcome.code);
				return true;
		}

		row.providerMeta = meta;
		row.step = claimedStep + 1;
		await row.save();
		await dispatchInTransaction(
			RunDesignGenerationJob.dispatch({
				tenantId: tenant.id,
				generationId: row.id,
				attempt,
				step: claimedStep + 1,
			}).in(next ?? pollDelay(0)),
			trx,
		);
		return true;
	}

	/** Ends a locked, unfinished row as failed or moderated and releases its reservation. */
	private async finish(
		tenant: TenantRef,
		row: DesignGeneration,
		code: FailureCode,
	): Promise<void> {
		row.status = MODERATION_CODES.includes(code) ? "moderated" : "failed";
		row.failureCode = code;
		row.finishedAt = DateTime.now();
		row.step += 1;
		await row.save();
		const cost = row.providerMeta?.cost;
		await this.usage.release(
			tenant,
			row.id,
			row.attempt,
			code,
			// A moderated or failed request may still have been charged.
			typeof cost === "number" ? cost : null,
		);
		const fields = {
			tenantId: tenant.id,
			generationId: row.id,
			attempt: row.attempt,
			code,
		};
		// TattooDrip's provider account can't generate: an operator must act.
		if (code === "provider_unavailable") {
			logger.error(fields, "Design Lab generation did not complete.");
		} else {
			logger.info(fields, "Design Lab generation did not complete.");
		}
	}

	private lockRow(tenant: TenantRef, generationId: string) {
		return DesignGeneration.query()
			.where("tenant_id", tenant.id)
			.where("id", generationId)
			.forUpdate()
			.first();
	}
}

function submitFailure(error: unknown, generation: DesignGeneration): Outcome {
	if (!(error instanceof DesignProviderError)) {
		logger.error(
			{ err: safeError(error), generationId: generation.id },
			"A Design Lab submit failed unexpectedly.",
		);
		return { kind: "failed", code: "submit_unconfirmed" };
	}
	switch (error.kind) {
		case "rate_limited":
			return { kind: "requeue", reason: "rate_limited" };
		case "unavailable":
			// An HTTP refusal means it was not accepted; no answer means unknown.
			return error.status
				? { kind: "requeue", reason: "provider_error" }
				: { kind: "failed", code: "submit_unconfirmed" };
		case "credits":
		case "auth":
		case "config":
			return { kind: "failed", code: "provider_unavailable" };
		case "rejected":
			return { kind: "failed", code: "provider_rejected" };
		case "uncertain":
		case "invalid_response":
			return { kind: "failed", code: "submit_unconfirmed" };
	}
}

function pollFailure(error: unknown, generation: DesignGeneration): Outcome {
	if (error instanceof DesignProviderError) {
		if (
			error.kind === "auth" ||
			error.kind === "credits" ||
			error.kind === "config"
		) {
			return { kind: "failed", code: "provider_unavailable" };
		}
		if (error.kind === "invalid_response") {
			return { kind: "failed", code: "provider_error" };
		}
		// Busy or unreachable: poll again until the deadline.
		return { kind: "pending" };
	}
	logger.error(
		{ err: safeError(error), generationId: generation.id },
		"A Design Lab poll failed unexpectedly.",
	);
	return { kind: "pending" };
}

/** An error for the log without anything a provider could have echoed back. */
function safeError(error: unknown) {
	if (error instanceof DesignProviderError) {
		return { name: error.name, kind: error.kind, status: error.status };
	}
	return error instanceof Error
		? { name: error.name, message: error.message }
		: {};
}
