/**
 * Runs at most `max` tasks at once; the others wait their turn, first come
 * first served. A task that fails frees its slot like one that succeeds.
 * In-process only: each server process has its own slots.
 */
export function limitConcurrency(max: number) {
	if (!Number.isInteger(max) || max < 1) {
		throw new Error(`limitConcurrency needs a positive integer, got ${max}`);
	}
	let running = 0;
	const waiting: (() => void)[] = [];

	function release() {
		const next = waiting.shift();
		// Hand the slot straight to the next task, or give it back.
		if (next) next();
		else running -= 1;
	}

	return async function run<T>(task: () => Promise<T>): Promise<T> {
		if (running < max) running += 1;
		else await new Promise<void>((resolve) => waiting.push(resolve));
		try {
			return await task();
		} finally {
			release();
		}
	};
}
