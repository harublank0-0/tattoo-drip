import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTattooClient } from "@tattoo-drip/sdk";
import * as React from "react";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	IntakeForm,
	type IntakeFormProps,
	summaryItems,
} from "../../src/intake/components/intake-form.tsx";
import {
	IntakeSent,
	statusText,
} from "../../src/intake/components/notices.tsx";
import { ReferencePicker } from "../../src/intake/components/reference-picker.tsx";
import { copy } from "../../src/intake/copy.ts";
import {
	EMPTY_REFERENCES,
	type ReferencesState,
} from "../../src/intake/references.ts";
import { isAllowedHref } from "../../src/studio/links.ts";
import { renderWithProviders } from "./providers.tsx";

// @tattoo-drip/react is used from source, and tsx compiles its .tsx files with
// the classic JSX transform (the storefront's tsconfig doesn't cover them),
// which calls the global React.
Object.assign(globalThis, { React });

const SITA = { id: "0199f000-0000-7000-8000-000000000048", name: "Sita Rai" };
const MINA = { id: "0199f000-0000-7000-8000-000000000050", name: "मीना गुरुङ" };
const CHANNELS = {
	whatsapp: "https://wa.me/9779812345678?text=Hi",
	email: "mailto:hello@black-needle.example?subject=Tattoo%20inquiry",
	instagram: null,
};
const SITE_KEY = "1x00000000000000000000AA";

type Open = IntakeFormProps["state"];
const open = (overrides: Partial<Open> = {}): Open => ({
	kind: "open",
	studioName: "Black Needle",
	preferredArtist: null,
	artists: [SITA, MINA],
	...overrides,
});

/** Rendered as the page renders it: inside the query and SDK providers. */
function render(element: ReactElement): string {
	const client = createTattooClient({
		baseUrl: "http://api.test",
		tenant: "black-needle-48",
		fetch: () => Promise.reject(new Error("no request during a render")),
	});
	return renderWithProviders(client, element);
}

const formHtml = (
	state: Open = open(),
	challengeSiteKey: string | null = SITE_KEY,
) =>
	render(
		createElement(IntakeForm, { state, channels: CHANNELS, challengeSiteKey }),
	);

const count = (html: string, pattern: RegExp) =>
	html.match(pattern)?.length ?? 0;
const tags = (html: string, name: string): string[] =>
	html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
const attr = (tag: string, name: string) =>
	new RegExp(` ${name}="([^"]*)"`, "i").exec(tag)?.[1];
const decode = (value: string) =>
	value
		.replaceAll("&amp;", "&")
		.replaceAll("&#x27;", "'")
		.replaceAll("&quot;", '"');
const hrefs = (html: string) =>
	Array.from(html.matchAll(/ href="([^"]*)"/g), (match) => decode(match[1]));
const control = (html: string, id: string) =>
	[...tags(html, "input"), ...tags(html, "textarea")].find(
		(tag) => attr(tag, "id") === id,
	) ?? "";
const radiosOf = (html: string, name: string) =>
	tags(html, "input").filter(
		(tag) => attr(tag, "type") === "radio" && attr(tag, "name") === name,
	);

describe("the intake form", () => {
	test("is one form, named by the section's heading, in two groups", () => {
		const html = formHtml();
		const [form] = tags(html, "form");

		assert.equal(count(html, /<form[\s>]/g), 1);
		assert.equal(attr(form, "method"), "post");
		assert.match(form, / novalidate=""/i);
		assert.equal(attr(form, "aria-labelledby"), "inquiry-title");
		assert.doesNotMatch(form, / action=/);
		assert.match(html, /<legend class="intake-legend">Your tattoo<\/legend>/);
		assert.match(
			html,
			/<legend class="intake-legend">How <bdi>Black Needle<\/bdi> reaches you<\/legend>/,
		);
		assert.match(html, /Everything is needed unless it says \(optional\)\./);
	});

	test("opens on one reassuring line and keeps the Cloudflare notice for under Send (TAT-105)", () => {
		const html = formHtml();
		const at = (text: string) => {
			const index = html.indexOf(text);
			assert.ok(index >= 0, text);
			return index;
		};

		assert.match(
			html,
			/<p class="intake-note intake-reassure">Only <bdi>Black Needle<\/bdi> sees what you send\.<\/p>/,
		);
		// Nothing about spam bots or Cloudflare until the person has reached Send.
		assert.ok(
			at("Only <bdi>Black Needle</bdi> sees what you send.") <
				at("Your tattoo"),
		);
		assert.ok(at("Your tattoo") < at(">Send inquiry<"));
		assert.ok(at(">Send inquiry<") < at("Cloudflare"));
		assert.ok(html.lastIndexOf("Cloudflare") < at("Prefer to chat?"));
		assert.match(
			html,
			/<p class="intake-fine">Tattoo Drip runs this page for <bdi>Black Needle<\/bdi>\./,
		);
		assert.doesNotMatch(html, /begin filling this in/);
		assert.doesNotMatch(
			html.slice(0, at("Your tattoo")),
			/Cloudflare|spam/,
			"the top of the form",
		);
	});

	test("labels every control", () => {
		const html = formHtml();
		const labelled = new Set(
			Array.from(
				html.matchAll(/<label[^>]* for="([^"]+)"/g),
				(match) => match[1],
			),
		);

		for (const tag of [...tags(html, "input"), ...tags(html, "textarea")]) {
			const type = attr(tag, "type");
			if (type === "radio" || type === "file") continue;
			const id = attr(tag, "id");
			assert.ok(id && labelled.has(id), tag);
		}
		const radios = tags(html, "input").filter(
			(tag) => attr(tag, "type") === "radio",
		);
		assert.equal(
			count(html, /<label[^>]*>\s*<input[^>]*type="radio"/g),
			radios.length,
		);
		assert.match(html, /<label class="photo-add"><input[^>]*type="file"/);
	});

	test("marks what is needed and what is optional", () => {
		const html = formHtml();

		for (const id of [
			"idea",
			"placement",
			"approximateSize",
			"preferredDates",
			"contactName",
			"contactPhone",
		]) {
			assert.match(control(html, id), / required=""/, id);
			assert.match(control(html, id), / aria-required="true"/, id);
		}
		for (const id of ["budget", "contactEmail"]) {
			assert.doesNotMatch(control(html, id), / required/, id);
		}
		for (const label of [
			"Budget (optional)",
			"Email (optional)",
			"Reference photos (optional)",
		]) {
			assert.ok(html.includes(label), label);
		}
		for (const radio of radiosOf(html, "sourceChannel")) {
			assert.match(radio, / required=""/);
		}
	});

	test("limits each one-line field like the API; the idea box has no maxlength, so a paste is never cut", () => {
		const html = formHtml();

		for (const [id, max] of [
			["placement", 120],
			["approximateSize", 120],
			["preferredDates", 500],
			["budget", 120],
			["contactName", 120],
			["contactPhone", 40],
			["contactEmail", 254],
		] as const) {
			assert.equal(attr(control(html, id), "maxlength"), String(max), id);
		}
		assert.equal(attr(control(html, "idea"), "maxlength"), undefined);
	});

	test("what a person writes lays out in its own direction; a number and an address stay as they are", () => {
		const html = formHtml();

		for (const id of [
			"idea",
			"placement",
			"approximateSize",
			"preferredDates",
			"budget",
			"contactName",
		]) {
			assert.equal(attr(control(html, id), "dir"), "auto", id);
		}
		for (const id of ["contactPhone", "contactEmail"]) {
			assert.equal(attr(control(html, id), "dir"), undefined, id);
		}
	});

	test("the honeypot is out of sight, not out of the page", () => {
		const html = formHtml();
		const trap =
			/<div class="intake-trap" aria-hidden="true">([\s\S]*?)<\/div>/.exec(
				html,
			);

		assert.ok(trap, "the off-screen wrapper");
		assert.match(
			trap[1],
			/<label for="intake-website">Leave this empty<\/label>/,
		);
		const [input] = tags(trap[1], "input");
		assert.equal(attr(input, "name"), "website");
		assert.equal(attr(input, "type"), "text");
		assert.equal(attr(input, "tabindex"), "-1");
		assert.equal(attr(input, "autocomplete"), "off");
		assert.equal(attr(input, "value"), "");
		assert.doesNotMatch(input, /required|hidden/);
		assert.doesNotMatch(html, / style=/);
	});

	test("asks for JPEG, PNG or WebP photos, several at once", () => {
		const html = formHtml();
		const file =
			tags(html, "input").find((tag) => attr(tag, "type") === "file") ?? "";

		assert.equal(attr(file, "accept"), "image/jpeg,image/png,image/webp");
		assert.match(file, / multiple=""/);
		assert.equal(attr(file, "id"), "references-input");
		assert.match(html, /<fieldset id="references" class="intake-photos"/);
		assert.match(html, />Add photos</);
		assert.match(
			html,
			/Up to 5 photos: designs you like, or the spot on your body\. Only <bdi>Black Needle<\/bdi> sees them\./,
		);
	});

	test("offers an artist only with two or more, or on an artist's page", () => {
		const studioPage = radiosOf(formHtml(), "preferredArtistId");
		assert.deepEqual(
			studioPage.map((tag) => attr(tag, "value")),
			["", SITA.id, MINA.id],
		);
		assert.match(studioPage[0], / checked=""/);
		assert.match(formHtml(), /<span dir="auto">मीना गुरुङ<\/span>/);

		assert.deepEqual(
			radiosOf(formHtml(open({ artists: [SITA] })), "preferredArtistId"),
			[],
		);
		assert.deepEqual(
			radiosOf(formHtml(open({ artists: [] })), "preferredArtistId"),
			[],
		);

		const artistPage = radiosOf(
			formHtml(open({ preferredArtist: SITA, artists: [SITA] })),
			"preferredArtistId",
		);
		assert.deepEqual(
			artistPage.map((tag) => attr(tag, "value")),
			["", SITA.id],
		);
		assert.match(artistPage[1], / checked=""/);
		assert.doesNotMatch(artistPage[0], / checked/);
	});

	test("asks how they found the studio: six choices, none picked", () => {
		const html = formHtml();
		const radios = radiosOf(html, "sourceChannel");

		assert.deepEqual(
			radios.map((tag) => attr(tag, "value")),
			["instagram", "facebook", "tiktok", "google", "friend", "other"],
		);
		for (const radio of radios) assert.doesNotMatch(radio, / checked/);
		assert.match(html, /How did you find <bdi>Black Needle<\/bdi>\?/);
		assert.match(html, /<span dir="auto">A friend<\/span>/);
		assert.match(html, /<span dir="auto">Somewhere else<\/span>/);
	});

	test("helps a phone fill in the contact fields", () => {
		const html = formHtml();
		const phone = control(html, "contactPhone");
		const email = control(html, "contactEmail");

		assert.deepEqual(
			[
				attr(phone, "type"),
				attr(phone, "inputmode"),
				attr(phone, "autocomplete"),
			],
			["tel", "tel", "tel"],
		);
		assert.deepEqual(
			[
				attr(email, "type"),
				attr(email, "inputmode"),
				attr(email, "autocomplete"),
			],
			["email", "email", "email"],
		);
		assert.equal(attr(control(html, "contactName"), "autocomplete"), "name");
		assert.match(
			html,
			/<bdi>Black Needle<\/bdi> replies here\. A Nepali number needs no \+977\./,
		);
	});

	test("is safe markup: only allowed links, no style, no target, no script", () => {
		const html = formHtml();

		assert.doesNotMatch(html, / style=/);
		assert.doesNotMatch(html, / target=/);
		assert.doesNotMatch(html, /javascript:/i);
		assert.equal(
			count(html, /<script[\s>]/g),
			0,
			"Turnstile never loads on the server",
		);
		for (const href of hrefs(html)) assert.ok(isAllowedHref(href), href);
		for (const anchor of tags(html, "a")) {
			if (/ href="https?:/.test(anchor)) {
				assert.match(anchor, / rel="noopener noreferrer"/, anchor);
			}
		}
		assert.ok(
			hrefs(html).includes(
				"https://www.cloudflare.com/turnstile-privacy-policy/",
			),
		);
		assert.match(html, /Prefer to chat\?/);
		assert.ok(hrefs(html).includes(CHANNELS.whatsapp));
		assert.match(
			html,
			/<button type="submit" class="action action-primary">Send inquiry<\/button>/,
		);
		assert.match(
			html,
			/Cloudflare sees your connection and device, not your answers\./,
		);
	});

	test("keeps hostile names as text", () => {
		const html = formHtml(
			open({
				studioName: '<img src=x onerror="alert(1)">',
				artists: [SITA, { id: MINA.id, name: "</label><script>x</script>" }],
			}),
		);

		assert.doesNotMatch(html, /<img src=x/);
		assert.doesNotMatch(html, /<script/);
		assert.match(html, /&lt;img src=x/);
	});

	test("renders the same without a site key (development)", () => {
		assert.equal(formHtml(open(), null), formHtml(open(), SITE_KEY));
	});
});

describe("the photo tray", () => {
	const photo = (size: number) =>
		new File([new Uint8Array(size)], "reference.jpg", { type: "image/jpeg" });
	const state: ReferencesState = {
		items: [
			{
				id: "p1",
				name: "IMG_1.JPG",
				status: "ready",
				source: null,
				file: photo(300_000),
				error: null,
			},
			{
				id: "p2",
				name: "IMG_2.JPG",
				status: "ready",
				source: null,
				file: photo(200_000),
				error:
					"This photo wasn't accepted: Upload a JPEG, PNG or WebP image. Remove it, then send again.",
			},
			{
				id: "p3",
				name: "IMG_3.JPG",
				status: "queued",
				source: photo(9),
				file: null,
				error: null,
			},
		],
		workingId: "p3",
		notices: [
			{ kind: "heic", name: "IMG_4.HEIC" },
			{ kind: "too-many", count: 2 },
		],
		error: null,
	};
	const tray = (value: ReferencesState) =>
		renderToStaticMarkup(
			createElement(ReferencePicker, {
				state: value,
				previews: new Map([
					["p1", "blob:http://x/1"],
					["p2", "blob:http://x/2"],
				]),
				studioName: "Black Needle",
				disabled: false,
				onPick: () => {},
				onRemove: () => {},
			}),
		);

	test("shows each photo by its place, with a named remove button and its problem", () => {
		const html = tray(state);

		assert.match(
			html,
			/<img src="blob:http:\/\/x\/1" alt="Reference photo 1" width="96" height="96"\/>/,
		);
		assert.match(html, /<li class="photo photo-error">/);
		assert.match(html, />Preparing…</);
		for (const index of [1, 2, 3]) {
			assert.match(
				html,
				new RegExp(
					`<button type="button" class="photo-remove" aria-label="Remove reference photo ${index}"`,
				),
			);
		}
		assert.match(html, /3 of 5 photos, 0\.5 MB in total/);
	});

	test("says why photos weren't added, politely", () => {
		const html = tray(state);
		const messages =
			/<ul class="photo-messages" aria-live="polite">([\s\S]*?)<\/ul>/.exec(
				html,
			)?.[1] ?? "";

		assert.match(
			messages,
			/IMG_4\.HEIC is a HEIC photo, which this browser can&#x27;t convert\./,
		);
		assert.match(
			messages,
			/You can send up to 5 photos, so 2 weren&#x27;t added\./,
		);
		assert.match(
			messages,
			/Reference photo 2: This photo wasn&#x27;t accepted: Upload a JPEG, PNG or WebP image\./,
		);
	});

	test("at five photos the picker goes and says why", () => {
		const five: ReferencesState = {
			...state,
			workingId: null,
			notices: [],
			items: ["a", "b", "c", "d", "e"].map((id) => ({
				id,
				name: id,
				status: "ready" as const,
				source: null,
				file: photo(10),
				error: null,
			})),
		};
		const html = tray(five);

		assert.equal(count(html, /type="file"/g), 0);
		assert.match(
			html,
			/That&#x27;s 5 photos, the most you can send\. Remove one to add another\./,
		);
	});
});

describe("the success screen", () => {
	const html = render(
		createElement(IntakeSent, {
			studioName: "Black Needle",
			phone: "98-4100-0111",
			channels: CHANNELS,
		}),
	);

	test("says the studio will reply on WhatsApp or Viber, at the number given, and promises no time", () => {
		assert.match(
			html,
			/<h3 class="intake-sent-title" tabindex="-1">Inquiry sent<\/h3>/i,
		);
		assert.match(
			html,
			/<bdi>Black Needle<\/bdi> will reply on WhatsApp or Viber at <bdi>98-4100-0111<\/bdi>\./,
		);
		assert.doesNotMatch(html, /within|hours|days|soon/i);
	});

	test("links back to the studio page and its chat, never with the person's details", () => {
		const links = hrefs(html);

		assert.ok(links.includes("/"));
		assert.ok(links.includes(CHANNELS.whatsapp));
		for (const href of links) {
			assert.ok(isAllowedHref(href), href);
			assert.ok(!href.includes("4100") && !href.includes("0111"), href);
		}
	});
});

describe("statusText", () => {
	test("says what is happening, and the size while sending", () => {
		assert.equal(statusText("idle", false, 0, 0), "");
		assert.equal(
			statusText("preparing", false, 2, 0),
			"Preparing your photos…",
		);
		assert.equal(
			statusText("checking", false, 0, 0),
			"Running a quick security check…",
		);
		assert.equal(
			statusText("interactive", false, 0, 0),
			"Tick the box above to send.",
		);
		assert.equal(statusText("sending", false, 0, 0), "Sending your inquiry…");
		assert.equal(
			statusText("sending", false, 1, 400_000),
			"Sending your inquiry with 1 photo (0.4 MB)…",
		);
		assert.equal(
			statusText("sending", false, 3, 2_202_009),
			"Sending your inquiry with 3 photos (2.1 MB)…",
		);
		assert.equal(
			statusText("sending", true, 3, 2_202_009),
			"Still sending. On a slow connection this can take up to 2 minutes; keep this page open.",
		);
	});
});

describe("the error summary's items", () => {
	const items = (photosStopped: boolean, references = EMPTY_REFERENCES) =>
		summaryItems({}, references, "Black Needle", photosStopped);

	test("has none when nothing is wrong", () => {
		assert.deepEqual(items(false), []);
	});

	test("says a send stopped for a photo, and links to the photo picker", () => {
		const [item, ...rest] = items(true);

		assert.equal(rest.length, 0);
		assert.equal(item.target, "references-input");
		assert.equal(item.message, copy.photos.stopped);
	});

	test("links to the tray itself when it is full and has no picker", () => {
		const full: ReferencesState = {
			...EMPTY_REFERENCES,
			items: Array.from({ length: 5 }, (_, index) => ({
				id: `photo-${index}`,
				name: `p${index}.jpg`,
				status: "ready" as const,
				source: null,
				file: new File([new Uint8Array(3)], "reference.jpg"),
				error: null,
			})),
		};

		assert.equal(items(true, full)[0].target, "references");
	});
});
