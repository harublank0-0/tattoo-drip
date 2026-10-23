import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	byContact,
	contactLine,
	inOrder,
	isClosedFilter,
	type ListKey,
	listLine,
	ordered,
	pageOf,
	toListView,
	type WorkIds,
	waitingIds,
} from "#modules/projects/project_list";
import type { NeedsYouReason, Waiting } from "#modules/projects/waiting";

const KTM = "Asia/Kathmandu";
const now = DateTime.fromISO("2026-10-22T10:00:00", { zone: KTM });

const studioItem = (id: string, reason: NeedsYouReason) => ({
	project: { id },
	waiting: { side: "studio", reason } satisfies Waiting,
	text: `${reason} text`,
	hash: "payments",
});
const clientItem = (id: string) => ({
	project: { id },
	waiting: { side: "client", reason: "price_sent" } satisfies Waiting,
	text: "Price sent",
	hash: "quote",
});
const key = (
	id: string,
	createdDaysAgo: number,
	contactedDaysAgo: number | null = null,
): ListKey => ({
	id,
	createdAt: now.minus({ days: createdDaysAgo }),
	lastContactedAt:
		contactedDaysAgo === null ? null : now.minus({ days: contactedDaysAgo }),
});

const work = {
	needsYou: [
		studioItem("a", "proof_to_check"),
		studioItem("b", "quote_ending"),
		studioItem("c", "proof_to_check"),
		studioItem("d", "no_session"),
	],
	onClient: [clientItem("e"), clientItem("f")],
} satisfies WorkIds;

test.group("toListView", () => {
	test("the default is Active, what needs you first, page 1", ({ assert }) => {
		assert.deepEqual(toListView({}), {
			filter: "active",
			waiting: null,
			sort: "needs",
			page: 1,
		});
	});

	test("status passes when it is on a fixed list, else Active", ({
		assert,
	}) => {
		assert.equal(toListView({ status: "closed" }).filter, "closed");
		assert.equal(toListView({ status: "quoted" }).filter, "quoted");
		assert.equal(toListView({ status: "needs_you" }).filter, "needs_you");
		assert.equal(toListView({ status: "bogus" }).filter, "active");
		assert.equal(toListView({ status: ["closed"] }).filter, "active");
	});

	test("a waiting view wins over status and sits under its parent chip", ({
		assert,
	}) => {
		assert.deepEqual(toListView({ waiting: "proofs", status: "closed" }), {
			filter: "needs_you",
			waiting: "proofs",
			sort: "needs",
			page: 1,
		});
		const onClient = toListView({ waiting: "on_client", status: "closed" });
		assert.equal(onClient.filter, "active");
		assert.equal(onClient.waiting, "on_client");
	});

	test("waiting takes only the Today groups on projects and on_client", ({
		assert,
	}) => {
		for (const waiting of [
			"proofs",
			"prices",
			"ending",
			"deposits",
			"sessions",
		]) {
			assert.equal(toListView({ waiting }).waiting, waiting);
		}
		for (const waiting of ["requests", "bogus", ["proofs"], 3, ""]) {
			const view = toListView({ waiting });
			assert.isNull(view.waiting);
			assert.equal(view.filter, "active");
		}
	});

	test("sort is needs or contact, else needs", ({ assert }) => {
		assert.equal(toListView({ sort: "contact" }).sort, "contact");
		assert.equal(toListView({ sort: "needs" }).sort, "needs");
		assert.equal(toListView({ sort: "bogus" }).sort, "needs");
		assert.equal(toListView({ sort: ["contact"] }).sort, "needs");
	});

	test("page is a whole number of at least 1", ({ assert }) => {
		assert.equal(toListView({ page: "abc" }).page, 1);
		assert.equal(toListView({ page: "0" }).page, 1);
		assert.equal(toListView({ page: "-3" }).page, 1);
		assert.equal(toListView({ page: "2" }).page, 2);
	});
});

test("isClosedFilter is true only for the closed statuses", ({ assert }) => {
	for (const filter of [
		"closed",
		"completed",
		"declined",
		"cancelled",
	] as const) {
		assert.isTrue(isClosedFilter(filter), filter);
	}
	for (const filter of [
		"active",
		"needs_you",
		"quoted",
		"healing_check",
	] as const) {
		assert.isFalse(isClosedFilter(filter), filter);
	}
});

test.group("waitingIds", () => {
	test("Needs you gives every id in work's order", ({ assert }) => {
		assert.deepEqual(waitingIds({ waiting: null }, work), ["a", "b", "c", "d"]);
	});

	test("a Today group gives only its reasons, in order", ({ assert }) => {
		assert.deepEqual(waitingIds({ waiting: "ending" }, work), ["b"]);
		assert.deepEqual(waitingIds({ waiting: "proofs" }, work), ["a", "c"]);
		assert.deepEqual(waitingIds({ waiting: "sessions" }, work), ["d"]);
		assert.deepEqual(waitingIds({ waiting: "prices" }, work), []);
	});

	test("on_client gives the clients' side", ({ assert }) => {
		assert.deepEqual(waitingIds({ waiting: "on_client" }, work), ["e", "f"]);
	});
});

test.group("ordered", () => {
	// Fed in a shuffled order on purpose.
	const keys = [
		key("g", 1),
		key("f", 9),
		key("x", 20),
		key("c", 5),
		key("e", 8),
		key("y", 30),
		key("a", 3),
		key("b", 4),
		key("d", 6),
	];

	test("needs: what needs you, then the clients' side, then the rest oldest first", ({
		assert,
	}) => {
		assert.deepEqual(
			ordered(keys, "needs", work).map(({ id }) => id),
			["a", "b", "c", "d", "e", "f", "y", "x", "g"],
		);
	});

	test("needs: an item that is not among the keys is skipped, not invented", ({
		assert,
	}) => {
		assert.deepEqual(
			ordered([key("z", 1), key("b", 2)], "needs", work).map(({ id }) => id),
			["b", "z"],
		);
	});

	test("contact: never contacted first, then the oldest contact, ties oldest first", ({
		assert,
	}) => {
		const list = [
			key("recent", 10, 2),
			key("never-new", 1),
			key("old", 10, 9),
			key("never-old", 5),
			key("tie-new", 3, 9),
		];
		assert.deepEqual(
			ordered(list, "contact", work).map(({ id }) => id),
			["never-old", "never-new", "old", "tie-new", "recent"],
		);
		assert.isBelow(byContact(key("a", 5), key("b", 4, 1)), 0);
	});

	test("does not change the list it is given", ({ assert }) => {
		const before = keys.map(({ id }) => id);
		ordered(keys, "needs", work);
		ordered(keys, "contact", work);
		assert.deepEqual(
			keys.map(({ id }) => id),
			before,
		);
	});
});

test("pageOf cuts pages of the size asked and says how many there are", ({
	assert,
}) => {
	const ids = Array.from({ length: 27 }, (_, index) => index);
	const first = pageOf(ids, 1, 25);
	const second = pageOf(ids, 2, 25);
	const third = pageOf(ids, 3, 25);
	assert.deepEqual(
		[first.rows.length, second.rows.length, third.rows.length],
		[25, 2, 0],
	);
	assert.equal(first.lastPage, 2);
	assert.equal(first.total, 27);
	assert.equal(pageOf([], 1, 25).lastPage, 1);
});

test("inOrder follows the ids and drops an id without a row", ({ assert }) => {
	const rows = [{ id: "b" }, { id: "a" }, { id: "c" }];
	assert.deepEqual(inOrder(["c", "x", "a"], rows), [{ id: "c" }, { id: "a" }]);
});

test.group("listLine", () => {
	const noFlags = { depositToSettle: false, balanceDue: null };

	test("a studio item is a needs-you line with its text and card", ({
		assert,
	}) => {
		const { waiting, text, hash } = studioItem("a", "proof_to_check");
		assert.deepEqual(listLine({ waiting, text, hash }, null), {
			text,
			needsYou: true,
			hash,
		});
	});

	test("a client item is a plain line", ({ assert }) => {
		const { waiting, text, hash } = clientItem("e");
		assert.deepEqual(listLine({ waiting, text, hash }, noFlags), {
			text,
			needsYou: false,
			hash,
		});
	});

	test("without an item the owner's two money facts come in order and never mark the row", ({
		assert,
	}) => {
		assert.deepEqual(
			listLine(null, {
				depositToSettle: true,
				balanceDue: 100n,
			}),
			{
				text: "Record whether the deposit was kept or refunded",
				needsYou: false,
				hash: "payments",
			},
		);
		assert.deepEqual(listLine(null, { ...noFlags, balanceDue: 1_500_000n }), {
			text: "NPR 15,000 still due",
			needsYou: false,
			hash: "payments",
		});
	});

	test("nothing to say gives null", ({ assert }) => {
		assert.isNull(listLine(null, noFlags));
		assert.isNull(listLine(null, null));
	});
});

test.group("contactLine", () => {
	test("no contact is null", ({ assert }) => {
		assert.isNull(contactLine(null, KTM, { channel: null, kind: null }, now));
	});

	test("a contact says when and how, starting with a capital", ({ assert }) => {
		assert.equal(
			contactLine(
				now.minus({ days: 2 }),
				KTM,
				{ channel: "whatsapp", kind: null },
				now,
			),
			"Contacted 2 days ago on WhatsApp",
		);
		assert.equal(
			contactLine(now, KTM, { channel: null, kind: null }, now),
			"Contacted today",
		);
	});
});
