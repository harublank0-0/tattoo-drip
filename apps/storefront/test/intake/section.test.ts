import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { intakeFormKey } from "../../src/intake/components/intake-mount.tsx";
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
		assert.match(html, /<h1 id="inquiry-title"/);
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
			closedMessage: null,
		});
		assert.match(
			artist,
			/<bdi>Sita Rai<\/bdi> isn&#x27;t taking new inquiries right/,
		);
		assert.match(artist, /href="\/request"/);
		assert.doesNotMatch(artist, /href="\/#inquiry"/);
		assert.doesNotMatch(artist, /<form/);
		// No message from the artist, no note.
		assert.doesNotMatch(artist, /class="note/);

		const said = section({
			kind: "artist-closed",
			studioName: "Black Needle",
			artistName: "Sita Rai",
			studioOpen: true,
			closedMessage: "Books open in March.",
		});
		assert.match(
			said,
			/<p class="note user-text measure" dir="auto">Books open in March\.<\/p>/,
		);
		// Under the artist's line, before the way to the studio's general request.
		assert.ok(said.indexOf("isn&#x27;t taking") < said.indexOf("note"));
		assert.ok(said.indexOf("note") < said.indexOf('href="/request"'));
	});

	test("a closed artist's section with the studio closed too offers no link", () => {
		const html = section({
			kind: "artist-closed",
			studioName: "Black Needle",
			artistName: "Sita Rai",
			studioOpen: false,
			closedMessage: "Books open in March.",
		});

		assert.doesNotMatch(html, /href=/);
		assert.match(html, /Books open in March\./);
	});
});

describe("the #inquiry section's panel (TAT-105)", () => {
	test("an open section is the form's column and a panel of the four steps beside it", () => {
		const html = section(OPEN);

		assert.match(html, /^<div class="section inquiry-split">/);
		assert.match(
			html,
			/<section id="inquiry" class="inquiry" aria-labelledby="inquiry-title">/,
		);
		assert.equal((html.match(/<aside /g) ?? []).length, 1);
		// The strip's four titles and the panel's four steps.
		assert.equal((html.match(/<li class="step">/g) ?? []).length, 8);
		// The panel follows the section, so a phone, where it is hidden, reads the form first.
		assert.ok(html.indexOf("</section>") < html.indexOf("<aside "));
	});

	test("the section is the request page's: the h1, the strip under it as an h2, the panel beside it", () => {
		const html = section(OPEN);

		assert.match(
			html,
			/<h1 id="inquiry-title" class="section-title">Send your idea<\/h1>/,
		);
		assert.match(
			html,
			/<h2 id="steps-strip-title"[^>]*>How booking works<\/h2>/,
		);
		assert.match(
			html,
			/<h2 id="steps-panel-title"[^>]*>How booking works<\/h2>/,
		);
		assert.doesNotMatch(html, /<h3/);
		assert.ok(
			html.indexOf("inquiry-title") < html.indexOf("steps-strip-title"),
			"the strip is under the h1",
		);
		assert.ok(html.indexOf("</section>") < html.indexOf("<aside "));
		assert.equal((html.match(/<h1/g) ?? []).length, 1);
	});

	test("a closed section is headed by the h1 too, with no strip or panel", () => {
		const closed = section({
			kind: "studio-closed",
			studioName: "Black Needle",
		});

		assert.match(
			closed,
			/<h1 id="inquiry-title" class="section-title">Inquiries<\/h1>/,
		);
		assert.doesNotMatch(closed, /<h2|steps-strip|<aside/);
	});

	test("the steps are a list even where the sheet hides the numbers' list style (WebKit drops the semantics otherwise)", () => {
		const html = renderToStaticMarkup(
			createElement(InquirySection, {
				state: OPEN,
				channels: CHANNELS,
				challengeSiteKey: SITE_KEY,
			}),
		);

		assert.equal(
			(html.match(/<ol class="steps" role="list">/g) ?? []).length,
			2,
		);
		assert.equal((html.match(/<ol /g) ?? []).length, 2);
	});

	test("the panel checks every chat link once more: a link the page may not render is left out", () => {
		const html = renderToStaticMarkup(
			createElement(InquirySection, {
				state: OPEN,
				channels: {
					whatsapp: "javascript:alert(1)",
					email: "mailto:hello@black-needle.example?subject=Hi",
					instagram: "data:text/html,hi",
				},
				challengeSiteKey: SITE_KEY,
			}),
		);
		const panel = html.match(/<aside [\s\S]*?<\/aside>/)?.[0] ?? "";

		assert.match(
			panel,
			/href="mailto:hello@black-needle\.example\?subject=Hi"/,
		);
		assert.doesNotMatch(panel, /javascript:|data:/);
		assert.equal((panel.match(/<a /g) ?? []).length, 1);
	});

	test("a panel with no chat link to offer says nothing about chatting", () => {
		const html = renderToStaticMarkup(
			createElement(InquirySection, {
				state: OPEN,
				channels: {
					whatsapp: "javascript:alert(1)",
					email: null,
					instagram: null,
				},
				challengeSiteKey: SITE_KEY,
			}),
		);
		const panel = html.match(/<aside [\s\S]*?<\/aside>/)?.[0] ?? "";

		assert.doesNotMatch(panel, /Prefer to chat/);
		assert.equal((panel.match(/<a /g) ?? []).length, 0);
	});

	test("a closed section has no panel and no steps", () => {
		for (const state of [
			{ kind: "studio-closed", studioName: "Black Needle" },
			{
				kind: "artist-closed",
				studioName: "Black Needle",
				artistName: "Sita Rai",
				studioOpen: true,
				closedMessage: null,
			},
		] as const) {
			const html = section(state);
			assert.doesNotMatch(html, /<aside|How booking works|step-title/);
			assert.match(html, /<section id="inquiry" class="inquiry" /);
		}
	});
});

describe("the mounted form belongs to the artist it is for (TAT-127)", () => {
	const SITA = { id: "0199f000-0000-7000-8000-000000000048", name: "Sita Rai" };
	const open = (preferredArtist: typeof SITA | null): typeof OPEN & object => ({
		...OPEN,
		preferredArtist,
	});

	test("a different artist, or none, is a different form", () => {
		const general = intakeFormKey(open(null));
		const sita = intakeFormKey(open(SITA));
		const other = intakeFormKey(
			open({ id: "0199f000-0000-7000-8000-000000000049", name: "Arjun" }),
		);

		assert.equal(general, "");
		assert.equal(sita, SITA.id);
		assert.equal(new Set([general, sita, other]).size, 3);
		// The same artist on a later render is the same form (nothing typed is lost).
		assert.equal(intakeFormKey(open(SITA)), sita);
	});

	test("IntakeMount keys the lazy form by it, so moving between /request addresses mounts a fresh one", () => {
		const text = readFileSync(
			new URL("../../src/intake/components/intake-mount.tsx", import.meta.url),
			"utf8",
		);

		assert.match(
			text,
			/<LazyIntakeForm key=\{intakeFormKey\(props\.state\)\} \{\.\.\.props\} \/>/,
		);
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
