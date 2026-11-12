import { test } from "@japa/runner";
import {
	groupSummary,
	oneByTattoo,
	TATTOO_CHANGED_SINCE,
} from "#modules/artists/portfolio";

/**
 * Angles' pure rules of the portfolio module: one bulk change per tattoo
 * (a lead and its own angle given together are one change) and the words
 * the dashboard shows for grouping and for a tattoo that changed.
 */
test.group("Portfolio: angles", () => {
	test("a bulk change acts once per tattoo, preferring the lead, in the order given", ({
		assert,
	}) => {
		const lead = { id: "l", leadPhotoId: null };
		const angle = { id: "a", leadPhotoId: "l" };
		const other = { id: "o", leadPhotoId: null };
		const lone = { id: "x", leadPhotoId: "m" };
		assert.deepEqual(oneByTattoo([angle, other, lead]), [other, lead]);
		assert.deepEqual(oneByTattoo([lead, angle]), [lead]);
		// An angle whose lead was not given stands for its tattoo.
		assert.deepEqual(oneByTattoo([lone, other]), [lone, other]);
		assert.deepEqual(oneByTattoo([lone, { id: "y", leadPhotoId: "m" }]), [
			lone,
		]);
	});

	test("grouping says what the tattoo takes, and why it refuses mixed publishing", ({
		assert,
	}) => {
		assert.equal(
			groupSummary({ photos: 3 }).message,
			"Grouped as one tattoo of 3 photos. The newest is its main photo, and the tattoo takes its styles and healed mark.",
		);
		assert.deepEqual(groupSummary("mixed"), {
			ok: false,
			message:
				"Not grouped. Some of these photos are unpublished. Publish or unpublish them all first, then group them.",
		});
		assert.equal(
			TATTOO_CHANGED_SINCE,
			"This tattoo changed since you opened it. Check it and try again.",
		);
	});
});
