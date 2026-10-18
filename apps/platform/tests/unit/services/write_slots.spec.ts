import { test } from "@japa/runner";
import { WRITE_CONCURRENCY, WriteSlots } from "#services/write_slots";

test.group("WriteSlots", () => {
	test("two per address and four per process; a release frees its slot once", ({
		assert,
	}) => {
		const slots = new WriteSlots({ perProcess: 4, perAddress: 2 });
		const a1 = slots.take("a");
		const a2 = slots.take("a");
		assert.equal(slots.take("a"), "address");
		const b1 = slots.take("b");
		const b2 = slots.take("b");
		assert.equal(slots.inFlight, 4);
		assert.equal(slots.take("c"), "process");

		assert.notTypeOf(a1, "string");
		if (typeof a1 === "string") return;
		a1.release();
		a1.release();
		assert.equal(slots.inFlight, 3);
		assert.notTypeOf(slots.take("c"), "string");
		assert.equal(slots.take("a"), "process");

		for (const slot of [a2, b1, b2]) {
			if (typeof slot !== "string") slot.release();
		}
		assert.equal(slots.inFlight, 1);
		assert.notTypeOf(slots.take("a"), "string");
	});

	test("the numbers", ({ assert }) => {
		assert.deepEqual(WRITE_CONCURRENCY, { perProcess: 4, perAddress: 2 });
	});
});
