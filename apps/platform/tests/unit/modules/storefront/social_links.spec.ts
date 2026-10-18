import { test } from "@japa/runner";
import { socialLinks } from "#modules/storefront/studio_page";

const none = {
	instagramUrl: null,
	facebookUrl: null,
	tiktokUrl: null,
	websiteUrl: null,
};

test.group("socialLinks", () => {
	test("lists the set links in a fixed order: instagram, facebook, tiktok, website", ({
		assert,
	}) => {
		assert.deepEqual(
			socialLinks({
				websiteUrl: "https://needle.example",
				tiktokUrl: "https://www.tiktok.com/@needle",
				facebookUrl: "https://facebook.com/needle",
				instagramUrl: "https://instagram.com/needle",
			}),
			[
				{ platform: "instagram", url: "https://instagram.com/needle" },
				{ platform: "facebook", url: "https://facebook.com/needle" },
				{ platform: "tiktok", url: "https://www.tiktok.com/@needle" },
				{ platform: "website", url: "https://needle.example" },
			],
		);
	});

	test("leaves out the links that aren't set", ({ assert }) => {
		assert.deepEqual(socialLinks(none), []);
		assert.deepEqual(
			socialLinks({ ...none, tiktokUrl: "https://www.tiktok.com/@needle" }),
			[{ platform: "tiktok", url: "https://www.tiktok.com/@needle" }],
		);
	});

	test("leaves out anything that isn't an https URL, whatever the row holds", ({
		assert,
	}) => {
		for (const url of [
			"javascript:alert(1)",
			"JAVASCRIPT:alert(1)",
			"http://needle.example",
			"data:text/html,hi",
			"//needle.example",
			"needle.example",
			"not a link",
			"https://",
			" https://needle.example",
			"",
		]) {
			assert.deepEqual(socialLinks({ ...none, websiteUrl: url }), [], url);
		}
	});

	test("keeps an https URL exactly as stored", ({ assert }) => {
		const url = "https://Instagram.com/Needle?hl=en";

		assert.deepEqual(socialLinks({ ...none, instagramUrl: url }), [
			{ platform: "instagram", url },
		]);
	});
});
