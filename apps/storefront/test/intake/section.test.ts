import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InquirySection } from "../../src/studio/components/inquiry.tsx";
import type { InquiryState } from "../../src/studio/inquiry.ts";

const SITE_KEY = "1x00000000000000000000AA";
const CHANNELS = {
	whatsapp: "https://wa.me/9779812345678?text=Hi",
	email: "mailto:hello@black-needle.example?subject=Tattoo%20inquiry",
	instagram: null,
};
const OPEN: InquiryState = {
	kind: "open",
	studioName: "Black Needle",
	preferredArtist: null,
	artists: [{ id: "0199f000-0000-7000-8000-000000000048", name: "Sita Rai" }],
};

const section = (state: InquiryState) =>
	renderToStaticMarkup(
		createElement(InquirySection, {
			state,
			channels: CHANNELS,
			challengeSiteKey: SITE_KEY,
		}),
	);

describe("the #inquiry section on the server", () => {
	test("renders TAT-48's chat links, never the form (it mounts after hydration)", () => {
		const html = section(OPEN);

		assert.equal((html.match(/<form[\s>]/g) ?? []).length, 0);
		assert.match(html, /Message on WhatsApp/);
		assert.match(html, /<h2 id="inquiry-title"/);
		assert.doesNotMatch(
			html,
			/challenges\.cloudflare\.com|1x00000000000000000000AA/,
		);
	});

	test("keeps the closed states as TAT-48 left them", () => {
		const closed = section({
			kind: "studio-closed",
			studioName: "Black Needle",
		});
		assert.match(
			closed,
			/<bdi>Black Needle<\/bdi> isn&#x27;t taking new inquiries right now\./,
		);
		assert.doesNotMatch(closed, /<form|Message on WhatsApp/);

		const artist = section({
			kind: "artist-closed",
			studioName: "Black Needle",
			artistName: "Sita Rai",
			studioOpen: true,
		});
		assert.match(
			artist,
			/<bdi>Sita Rai<\/bdi> isn&#x27;t taking new inquiries right/,
		);
		assert.match(artist, /href="\/#inquiry"/);
		assert.doesNotMatch(artist, /<form/);
	});
});

describe("the intake code", () => {
	const DIR = new URL("../../src/intake/", import.meta.url);
	const files = readdirSync(DIR, { recursive: true })
		.map(String)
		.filter((file) => /\.(ts|tsx)$/.test(file));
	const read = (file: string) => readFileSync(new URL(file, DIR), "utf8");

	test("keeps nothing in the browser, tracks nothing, renders no raw HTML", () => {
		for (const file of files) {
			const text = read(file);
			for (const banned of [
				"localStorage",
				"sessionStorage",
				"indexedDB",
				"document.cookie",
				"sendBeacon",
				"dangerouslySetInnerHTML",
				"style={",
				"target=",
				"posthog",
				"gtag",
			]) {
				assert.ok(!text.includes(banned), `${file}: ${banned}`);
			}
		}
	});

	test("its pure modules touch no DOM and no React", () => {
		for (const file of [
			"copy.ts",
			"rules.ts",
			"images.ts",
			"references.ts",
			"submission.ts",
			"problems.ts",
			"challenge.ts",
			"submit-flow.ts",
		]) {
			assert.doesNotMatch(
				read(file),
				/from "react"|@tanstack\/react|\bdocument\.|\bwindow\./,
				file,
			);
		}
	});

	test("never names a setting the browser must not see", () => {
		for (const file of files) {
			assert.doesNotMatch(
				read(file),
				/TURNSTILE_(SITE|SECRET)_KEY|process\.env/,
				file,
			);
		}
	});
});
