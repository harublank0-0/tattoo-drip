import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import { Job } from "@adonisjs/queue";
import type { JobOptions } from "@adonisjs/queue/types";

type Payload = {
	tenantId: string;
	generationId: string;
	attempt: number;
	step: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AI Design Lab: one step of a generation (GenerationRunner.run): submit to
 * the provider, poll it, or download and store the finished image. Queued
 * with the generation's accept (or retry) and by each step for the next one,
 * always in the transaction that writes the row, so it exists exactly when
 * the state that needs it does.
 *
 * A plain Job, not a TenantJob, on purpose (allowlisted in
 * job_classes.spec.ts): a TenantJob holds one transaction for the whole run,
 * and a run waits on the provider for up to 30 s a call. This job opens
 * none itself; the runner reads and writes the row only in short
 * withDbContext transactions scoped to the payload's tenantId. It is safe to
 * repeat: the row's `step` fences every run, so a repeated or stale delivery
 * does nothing.
 */
export default class RunDesignGenerationJob extends Job<Payload> {
	static options: JobOptions = { timeout: "2m" };

	async execute(): Promise<void> {
		const { tenantId, generationId, attempt, step } = checked(this.payload);
		const runner = await this.runner();
		await runner.run(
			{ id: tenantId },
			generationId,
			attempt,
			step,
			this.signal,
		);
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const tenantId = this.payload?.tenantId;
		const generationId = this.payload?.generationId;
		logger.error(
			{ err: error, jobId, tenantId, generationId },
			"Running a Design Lab generation failed.",
		);
		let payload: Payload;
		try {
			payload = checked(this.payload);
		} catch {
			return;
		}
		try {
			const runner = await this.runner();
			await runner.giveUp(
				{ id: payload.tenantId },
				payload.generationId,
				payload.attempt,
				payload.step,
			);
		} catch (err) {
			logger.error(
				{ err, jobId, tenantId, generationId },
				"Marking a Design Lab generation as failed failed.",
			);
		}
	}

	/** Imported here, not at the top: GenerationRunner imports this job to queue it. */
	private async runner() {
		const { default: GenerationRunner } = await import(
			"#modules/design_lab/services/generation_runner"
		);
		return app.container.make(GenerationRunner);
	}
}

function checked(payload: Payload | undefined): Payload {
	const { tenantId, generationId, attempt, step } = payload ?? ({} as Payload);
	if (typeof tenantId !== "string" || !UUID.test(tenantId)) {
		throw new Error("RunDesignGenerationJob needs a valid tenantId");
	}
	if (typeof generationId !== "string" || !UUID.test(generationId)) {
		throw new Error("RunDesignGenerationJob needs a valid generationId");
	}
	if (!Number.isInteger(attempt) || attempt < 1) {
		throw new Error("RunDesignGenerationJob needs a valid attempt");
	}
	if (!Number.isInteger(step) || step < 0) {
		throw new Error("RunDesignGenerationJob needs a valid step");
	}
	return { tenantId, generationId, attempt, step };
}
