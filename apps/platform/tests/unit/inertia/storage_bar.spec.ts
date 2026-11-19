import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `BarModule` below restates its shape and the inertia project type-checks the real one.
import * as barModule from "../../../inertia/components/storage_bar_text.js";

type Storage = {
	usedText: string;
	limitText: string | null;
	percent: number | null;
	full: boolean;
	enforced: boolean;
};
type BarModule = {
	storageBarText(
		storage: Storage | null | undefined,
		role: string | undefined,
	): { text: string; billing: boolean } | null;
};
const { storageBarText } = barModule as BarModule;

const storage = (over: Partial<Storage> = {}): Storage => ({
	usedText: "4.1 GB",
	limitText: "5 GB",
	percent: 82,
	full: false,
	enforced: true,
	...over,
});

/**
 * The dashboard's storage warning (the storage meter, What people see):
 * from 80%, once enforcement is on, for every member; owners get Billing.
 */
test.group("Storage bar", () => {
	test("from 80% it says how much of the allowance is used; owners get a link to Billing", ({
		assert,
	}) => {
		assert.deepEqual(storageBarText(storage(), "owner"), {
			text: "Your studio has used 82% of its 5 GB storage.",
			billing: true,
		});
		assert.deepEqual(storageBarText(storage(), "artist"), {
			text: "Your studio has used 82% of its 5 GB storage.",
			billing: false,
		});
	});

	test("a full studio is told uploads are paused and what keeps working", ({
		assert,
	}) => {
		assert.deepEqual(
			storageBarText(storage({ percent: 100, full: true }), "artist"),
			{
				text: "Your studio's storage is full: new uploads are paused until there's room. Existing files, bookings and deposits keep working.",
				billing: false,
			},
		);
		// 99.6% rounds to 100 but isn't full: still the percentage.
		assert.equal(
			storageBarText(storage({ percent: 100, full: false }), "owner")?.text,
			"Your studio has used 100% of its 5 GB storage.",
		);
	});

	test("nothing under 80%, in observe mode, unmetered, or off a studio page", ({
		assert,
	}) => {
		assert.isNull(storageBarText(storage({ percent: 79 }), "owner"));
		assert.isNull(storageBarText(storage({ enforced: false }), "owner"));
		assert.isNull(
			storageBarText(storage({ percent: null, limitText: null }), "owner"),
		);
		assert.isNull(storageBarText(null, undefined));
	});
});
