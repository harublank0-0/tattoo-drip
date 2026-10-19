import { test } from "@japa/runner";
import { studioTakesInquiries } from "#modules/artists/accepting";

const open = { acceptingInquiries: true };
const closed = { acceptingInquiries: false };

test.group("studioTakesInquiries", () => {
	test("a studio with no visible artist takes general inquiries", ({
		assert,
	}) => {
		assert.isTrue(studioTakesInquiries([]));
	});

	test("one open artist is enough", ({ assert }) => {
		assert.isTrue(studioTakesInquiries([open]));
		assert.isTrue(studioTakesInquiries([closed, open, closed]));
	});

	test("a studio whose visible artists are all closed takes none", ({
		assert,
	}) => {
		assert.isFalse(studioTakesInquiries([closed]));
		assert.isFalse(studioTakesInquiries([closed, closed]));
	});
});
