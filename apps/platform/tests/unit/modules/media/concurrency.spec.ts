import { test } from "@japa/runner";
import { limitConcurrency } from "#modules/media/concurrency";

/** A task body that runs until `finish()` is called. */
function gate() {
	let finish = () => {};
	const done = new Promise<void>((resolve) => {
		finish = resolve;
	});
	return { done, finish: () => finish() };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test.group("limitConcurrency", () => {
	test("runs at most `max` tasks at once, the rest in arrival order", async ({
		assert,
	}) => {
		const run = limitConcurrency(2);
		const gates = [gate(), gate(), gate(), gate()];
		const started: number[] = [];
		let active = 0;
		let peak = 0;

		const results = gates.map((g, index) =>
			run(async () => {
				started.push(index);
				active += 1;
				peak = Math.max(peak, active);
				await g.done;
				active -= 1;
				return index;
			}),
		);
		await settle();
		assert.deepEqual(started, [0, 1]);

		gates[1].finish();
		await settle();
		assert.deepEqual(started, [0, 1, 2]);

		for (const g of gates) g.finish();
		assert.deepEqual(await Promise.all(results), [0, 1, 2, 3]);
		assert.deepEqual(started, [0, 1, 2, 3]);
		assert.equal(peak, 2);
	});

	test("a failing task frees its slot, and its caller gets the error", async ({
		assert,
	}) => {
		const run = limitConcurrency(1);

		const first = run(async () => {
			throw new Error("broken image");
		});
		const second = run(async () => "next");

		await assert.rejects(() => first, "broken image");
		assert.equal(await second, "next");
	});

	test("refuses a limit below 1", ({ assert }) => {
		assert.throws(() => limitConcurrency(0), /positive integer/);
	});
});
