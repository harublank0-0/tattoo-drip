import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	isAllowedHref,
	linkHostname,
	linkRel,
	mailtoLink,
	mapsLink,
	requestHref,
	safeHttpsUrl,
	safeImageUrl,
	telLink,
	viberLink,
	whatsappLink,
} from "../../src/studio/links.ts";

const PHONE = "+9779812345678";

describe("chat and call links", () => {
	test("are the platform's chatLinks() format", () => {
		assert.equal(whatsappLink(PHONE), "https://wa.me/9779812345678");
		assert.equal(viberLink(PHONE), "viber://chat?number=%2B9779812345678");
		assert.equal(telLink(PHONE), "tel:+9779812345678");
	});

	test("WhatsApp prefills an encoded message", () => {
		assert.equal(
			whatsappLink(PHONE, "Hi Black Needle, I'd like to ask about a tattoo."),
			"https://wa.me/9779812345678?text=Hi%20Black%20Needle%2C%20I'd%20like%20to%20ask%20about%20a%20tattoo.",
		);
	});

	test("need an E.164 phone", () => {
		for (const phone of [
			"9779812345678",
			"+0123456789",
			"+12345",
			"+977 981 234 5678",
			"+977-9812345678",
			"tel:+9779812345678",
			"+9779812345678\n",
			"",
			null,
			undefined,
		]) {
			assert.equal(whatsappLink(phone), null, JSON.stringify(phone));
			assert.equal(viberLink(phone), null, JSON.stringify(phone));
			assert.equal(telLink(phone), null, JSON.stringify(phone));
		}
	});
});

describe("mailtoLink", () => {
	test("links an email address, with an encoded subject and body", () => {
		assert.equal(
			mailtoLink("hello@black-needle.example"),
			"mailto:hello@black-needle.example",
		);
		assert.equal(
			mailtoLink("hello@black-needle.example", {
				subject: "Tattoo inquiry for Sita Rai",
				body: "Hi,\r\n\r\nMy idea:",
			}),
			"mailto:hello@black-needle.example?subject=Tattoo%20inquiry%20for%20Sita%20Rai&body=Hi%2C%0D%0A%0D%0AMy%20idea%3A",
		);
	});

	test("refuses anything that could smuggle headers or another scheme", () => {
		for (const email of [
			"hello",
			"a@b",
			"a b@c.example",
			"a@b.example?bcc=x@y.example",
			"a@b.example\nbcc:x@y.example",
			"javascript:alert(1)@x.example",
			"a@b.example#x",
			"<a@b.example>",
			`${"a".repeat(250)}@b.example`,
			null,
		]) {
			assert.equal(mailtoLink(email), null, JSON.stringify(email));
		}
	});
});

describe("mapsLink", () => {
	test("is a Google Maps search, no key", () => {
		assert.equal(
			mapsLink("Black Needle, Thamel Marg, Kathmandu"),
			"https://www.google.com/maps/search/?api=1&query=Black%20Needle%2C%20Thamel%20Marg%2C%20Kathmandu",
		);
	});
});

describe("safeHttpsUrl", () => {
	test("accepts an https URL, normalized", () => {
		assert.equal(
			safeHttpsUrl("https://instagram.com/blackneedle"),
			"https://instagram.com/blackneedle",
		);
		assert.equal(
			safeHttpsUrl("https://black-needle.example"),
			"https://black-needle.example/",
		);
	});

	test("refuses anything else", () => {
		for (const value of [
			"http://instagram.com/blackneedle",
			"javascript:alert(1)",
			"data:text/html,hi",
			"//evil.example",
			"/relative",
			" https://black-needle.example",
			"https://user:secret@black-needle.example",
			"https://",
			`https://black-needle.example/${"a".repeat(3000)}`,
			42,
			null,
		]) {
			assert.equal(safeHttpsUrl(value), null, JSON.stringify(value));
		}
	});
});

describe("safeImageUrl", () => {
	test("accepts http and https images only", () => {
		assert.equal(
			safeImageUrl("http://localhost:3333/uploads/p.jpg"),
			"http://localhost:3333/uploads/p.jpg",
		);
		assert.equal(
			safeImageUrl("https://api.example.com/uploads/p.jpg"),
			"https://api.example.com/uploads/p.jpg",
		);
		for (const value of [
			"javascript:alert(1)",
			"data:image/png;base64,AAAA",
			"/uploads/p.jpg",
			null,
		]) {
			assert.equal(safeImageUrl(value), null, JSON.stringify(value));
		}
	});
});

describe("linkHostname and linkRel", () => {
	test("names a link by its host, without www.", () => {
		assert.equal(linkHostname("https://www.youtube.com/@x"), "youtube.com");
		assert.equal(linkHostname("https://example.org/x"), "example.org");
	});

	test("web links don't pass the page on; the others need nothing", () => {
		assert.equal(linkRel("https://instagram.com/x"), "noopener noreferrer");
		assert.equal(linkRel("http://localhost:3333/x"), "noopener noreferrer");
		for (const href of [
			"tel:+9779812345678",
			"mailto:a@b.example",
			"viber://chat?number=%2B1",
			"/artists/sita",
			"#inquiry",
		]) {
			assert.equal(linkRel(href), undefined, href);
		}
	});
});

describe("requestHref", () => {
	test("is the request page, with the artist when given", () => {
		assert.equal(requestHref({}), "/request");
		assert.equal(requestHref({ artist: "sita" }), "/request?artist=sita");
		assert.ok(isAllowedHref(requestHref({})));
		assert.ok(isAllowedHref(requestHref({ artist: "sita" })));
	});
});

describe("isAllowedHref", () => {
	test("allows the page's own paths and fragments and the four schemes", () => {
		for (const href of [
			"/",
			"/artists/sita#inquiry",
			"/#inquiry",
			"#inquiry",
			"https://wa.me/9779812345678",
			"tel:+9779812345678",
			"mailto:a@b.example",
			"viber://chat?number=%2B9779812345678",
		]) {
			assert.ok(isAllowedHref(href), href);
		}
	});

	test("refuses every other scheme and protocol-relative paths", () => {
		for (const href of [
			"javascript:alert(1)",
			"JAVASCRIPT:alert(1)",
			"data:text/html,hi",
			"http://evil.example",
			"//evil.example",
			"/\\evil.example",
			"vbscript:x",
			"viber://pa?x",
			"tel:9779812345678",
			"",
		]) {
			assert.ok(!isAllowedHref(href), href);
		}
	});
});
