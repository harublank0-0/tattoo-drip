import { test } from "@japa/runner";
import { liveWindow } from "#controllers/admin_studios_controller";

const limits = { normal: 3, more: 5 };
const items = (n: number) => Array.from({ length: n }, (_, i) => i);

test.group("liveWindow", () => {
	test("under the default limit: all items, no link, no note", ({ assert }) => {
		assert.deepInclude(liveWindow(items(2), false, limits), {
			live: [0, 1],
			hasMore: false,
			truncated: false,
		});
	});

	test("exactly at the default limit: no link", ({ assert }) => {
		const window = liveWindow(items(3), false, limits);
		assert.lengthOf(window.live, 3);
		assert.isFalse(window.hasMore);
	});

	test("past the default limit: trimmed, with the link", ({ assert }) => {
		const window = liveWindow(items(4), false, limits);
		assert.deepEqual(window.live, [0, 1, 2]);
		assert.isTrue(window.hasMore);
		assert.isFalse(window.truncated);
	});

	test("more view at its limit: no link, no note", ({ assert }) => {
		assert.deepInclude(liveWindow(items(5), true, limits), {
			hasMore: false,
			truncated: false,
		});
	});

	test("more view past its limit: trimmed, a note and never the link", ({
		assert,
	}) => {
		const window = liveWindow(items(6), true, limits);
		assert.lengthOf(window.live, 5);
		assert.isFalse(window.hasMore);
		assert.isTrue(window.truncated);
	});
});
