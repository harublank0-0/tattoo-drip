import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import queue from "@adonisjs/queue/services/main";
import type { AdapterFactory, DispatchResult } from "@adonisjs/queue/types";
import { KnexAdapter, knex } from "@boringnode/queue/drivers/knex_adapter";

type Dispatcher = {
	with(adapter: AdapterFactory): unknown;
	run(): Promise<DispatchResult>;
};

/**
 * Queues a job inside `trx`, so the job exists only if the transaction
 * commits. Pass the dispatcher, not the job, to keep the queue's chaining:
 *
 *   await dispatchInTransaction(AlertStaffJob.dispatch(payload).toQueue("alerts"), trx)
 *
 * Only the database adapter can join a transaction. With the sync driver,
 * or a faked queue in tests, the job is dispatched normally. The helper
 * picks the adapter, so don't call `.with()` on the dispatcher yourself.
 */
export function dispatchInTransaction(
	dispatcher: Dispatcher,
	trx: TransactionClientContract,
) {
	const adapter = queue.use();

	if (adapter instanceof KnexAdapter) {
		dispatcher.with(knex(trx.knexClient));
	} else if (adapter.constructor.name === "KnexAdapter") {
		// A KnexAdapter from a second copy of @boringnode/queue fails the
		// instanceof check; dispatching outside trx would silently lose the
		// rollback guarantee, so refuse instead.
		throw new Error(
			"Two copies of @boringnode/queue are installed. Pin it to the version @adonisjs/queue depends on (see apps/platform/AGENTS.md, Jobs).",
		);
	}

	return dispatcher.run();
}
