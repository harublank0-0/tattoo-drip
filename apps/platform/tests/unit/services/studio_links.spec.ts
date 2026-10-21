import { test } from "@japa/runner";
import {
	artistPageUrl,
	studioAddressParts,
	studioPageUrl,
} from "#services/storefront_url";
import { studioLinks } from "#services/studio_links";

const PROD = "https://{tenant}.example.com";
const DEV = "http://{tenant}.localhost:3000";

test.group("Studio page addresses (TAT-101)", () => {
	test("the studio page is the origin of STOREFRONT_URL with the slug in the host", ({
		assert,
	}) => {
		assert.equal(
			studioPageUrl(PROD, "black-needle"),
			"https://black-needle.example.com",
		);
		assert.equal(
			studioPageUrl(DEV, "black-needle"),
			"http://black-needle.localhost:3000",
		);
	});

	test("only the origin counts: a path, query or hash on the template is dropped, a port is kept", ({
		assert,
	}) => {
		assert.equal(
			studioPageUrl("https://{tenant}.studios.example.com:8443/x?y=1#z", "ink"),
			"https://ink.studios.example.com:8443",
		);
	});

	test("an artist's page is /artists/<slug> on the studio's origin", ({
		assert,
	}) => {
		assert.equal(
			artistPageUrl(PROD, "black-needle", "sita"),
			"https://black-needle.example.com/artists/sita",
		);
	});

	test("the address is shown as what comes before and after the slug", ({
		assert,
	}) => {
		assert.deepEqual(studioAddressParts(PROD), {
			prefix: "",
			suffix: ".example.com",
		});
		assert.deepEqual(studioAddressParts(DEV), {
			prefix: "",
			suffix: ".localhost:3000",
		});
		assert.deepEqual(
			studioAddressParts("https://studio-{tenant}.example.com"),
			{
				prefix: "studio-",
				suffix: ".example.com",
			},
		);
	});
});

test.group("The studio link card's props (TAT-101)", () => {
	test("Open, Copy and Share all use the one URL; Share is wa.me with it encoded", ({
		assert,
	}) => {
		const links = studioLinks("black-needle", PROD);

		assert.equal(links.url, "https://black-needle.example.com");
		assert.equal(
			links.shareUrl,
			`https://wa.me/?text=${encodeURIComponent(links.url)}`,
		);
		assert.equal(
			links.shareUrl,
			"https://wa.me/?text=https%3A%2F%2Fblack-needle.example.com",
		);
		assert.isFalse(links.devHost);
	});

	test("a link to this machine warns: no client can open it", ({ assert }) => {
		assert.isTrue(studioLinks("black-needle", DEV).devHost);
		assert.isTrue(
			studioLinks("black-needle", "http://{tenant}.localhost:3404").devHost,
		);
	});
});
