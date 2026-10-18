/**
 * Public API writes in flight in this process (TAT-38 ruling 13). Every
 * API request that isn't GET or HEAD takes a slot in the gate, before its
 * body, and holds it until its response closes: at most 4 at once, 2 per
 * client address, so slow uploads can hold at most 4 of the web server's
 * 10 pooled connections (#services/db_pool), however slowly they arrive.
 * In memory: each web process counts its own.
 */
export const WRITE_CONCURRENCY = { perProcess: 4, perAddress: 2 } as const;

export type Slot = { release(): void };

export class WriteSlots {
	#total = 0;
	readonly #byAddress = new Map<string, number>();

	constructor(
		private readonly limits: {
			perProcess: number;
			perAddress: number;
		} = WRITE_CONCURRENCY,
	) {}

	get inFlight(): number {
		return this.#total;
	}

	/** A slot for `address`, or which limit refused it. */
	take(address: string): Slot | "address" | "process" {
		const mine = this.#byAddress.get(address) ?? 0;
		if (mine >= this.limits.perAddress) return "address";
		if (this.#total >= this.limits.perProcess) return "process";
		this.#total++;
		this.#byAddress.set(address, mine + 1);
		let released = false;
		return {
			release: () => {
				if (released) return;
				released = true;
				this.#total--;
				const left = (this.#byAddress.get(address) ?? 1) - 1;
				if (left === 0) this.#byAddress.delete(address);
				else this.#byAddress.set(address, left);
			},
		};
	}
}

/** The web process's slots. */
export const writeSlots = new WriteSlots();
