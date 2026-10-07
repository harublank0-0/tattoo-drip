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
 * or a faked queue in tests, the job is dispatched normally.
 */
export function dispatchInTransaction(
	dispatcher: Dispatcher,
	trx: TransactionClientContract,
) {
	if (queue.use() instanceof KnexAdapter) {
		dispatcher.with(knex(trx.knexClient));
	}
	return dispatcher.run();
}
