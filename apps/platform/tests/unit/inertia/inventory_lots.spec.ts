import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `LotsModule` below restates its shape and the inertia project type-checks the real one.
import * as lotsModule from "../../../inertia/components/inventory/lots.js";

type Lot = {
	id: string;
	number: string;
	quantity: number;
	expiresOn: string | null;
	expiresLabel: string | null;
	expiry: "expired" | "soon" | null;
};
type Kind = "receive" | "use" | "count";
type LotsModule = {
	NEW_LOT: string;
	defaultLot(kind: Kind, lots: Lot[], suggested: string | null): string;
	effectiveLot(
		choice: string | null,
		kind: Kind,
		lots: Lot[],
		suggested: string | null,
	): string;
	expiryText(lot: Pick<Lot, "expiresLabel" | "expiry">): string;
	lotOption(lot: Lot, unit: string, suggested: boolean): string;
	lotAfter(
		kind: Kind,
		lot: Pick<Lot, "quantity">,
		quantity: string,
	): number | null;
	afterText(after: number | null, unit: string): string | null;
};
const {
	NEW_LOT,
	defaultLot,
	effectiveLot,
	expiryText,
	lotOption,
	lotAfter,
	afterText,
} = lotsModule as LotsModule;

const expired: Lot = {
	id: "a",
	number: "OLD-1",
	quantity: 1000,
	expiresOn: "2026-11-01",
	expiresLabel: "1 Nov 2026",
	expiry: "expired",
};
const soon: Lot = {
	id: "b",
	number: "B-7",
	quantity: 12500,
	expiresOn: "2026-11-20",
	expiresLabel: "20 Nov 2026",
	expiry: "soon",
};

test.group("Inventory lot picker", () => {
	test("receipts start on a new lot; usage on the suggested lot", ({
		assert,
	}) => {
		const lots = [expired, soon];
		assert.equal(defaultLot("receive", lots, "b"), NEW_LOT);
		assert.equal(defaultLot("use", lots, "b"), "b");
		assert.equal(defaultLot("count", lots, null), "a");
		assert.equal(defaultLot("use", [], null), "");
	});

	test("a choice that no longer exists falls back to the default", ({
		assert,
	}) => {
		const lots = [expired, soon];
		assert.equal(effectiveLot("a", "use", lots, "b"), "a");
		assert.equal(effectiveLot("gone", "use", lots, "b"), "b");
		assert.equal(effectiveLot(NEW_LOT, "use", lots, "b"), "b");
		assert.equal(effectiveLot(NEW_LOT, "receive", lots, "b"), NEW_LOT);
	});

	test("lots read with their balance, expiry and the suggestion", ({
		assert,
	}) => {
		assert.equal(
			lotOption(soon, "ml", true),
			"B-7 · 12.5 ml · Expires 20 Nov 2026 · Suggested",
		);
		assert.equal(expiryText(expired), "Expired 1 Nov 2026");
		assert.equal(
			expiryText({ expiresLabel: null, expiry: null }),
			"No expiry date",
		);
	});

	test("the summary shows what the lot holds after the movement", ({
		assert,
	}) => {
		assert.equal(lotAfter("use", soon, "2.5"), 10000);
		assert.equal(lotAfter("receive", soon, "1"), 13500);
		assert.equal(lotAfter("count", soon, "4"), 4000);
		assert.equal(lotAfter("use", soon, ".5"), 12000);
		assert.isNull(lotAfter("use", soon, ""));
		assert.isNull(lotAfter("use", soon, "1.2345"));
		assert.equal(afterText(10000, "ml"), "After this: 10 ml left in this lot.");
		assert.equal(afterText(-1, "ml"), "More than this lot holds.");
		assert.isNull(afterText(null, "ml"));
	});
});
