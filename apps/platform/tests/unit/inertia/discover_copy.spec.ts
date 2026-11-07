import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";
import {
	ARTWORK_STATE_WORDS,
	DISCOVER_RECOMMENDED,
	PUBLICATION_STATUSES,
	readiness,
} from "#modules/discovery/publication";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `DiscoverModule` below restates its shape and the inertia project type-checks the real one.
import * as discoverModule from "../../../inertia/components/discover.js";

type BusinessType = "studio" | "independent";
type Tone = "success" | "warning" | "danger" | "neutral";
type DiscoverModule = {
	DISCOVER_STATUSES: readonly string[];
	statusTone(key: string): Tone;
	TONE_CLASS: Record<Exclude<Tone, "danger">, string>;
	pageIntro(type: BusinessType): string;
	previewLabel(type: BusinessType): string;
	listLabel(type: BusinessType): string;
	optionalNote(type: BusinessType): string;
	blockedLine(labels: string[]): string;
	onLine(type: BusinessType): string;
	acceptedLine(accepted: { acceptedOn: string; current: boolean }): string;
	TAKEN_DOWN_NOTE: string;
	turnOffQuestion(type: BusinessType): string;
	consentShowsHeading(type: BusinessType): string;
	DRAFT_MARKER: string;
	CONSENT_LABEL: string;
	consentSubmit(processing: boolean): string;
	citySave(processing: boolean, clearing: boolean): string;
	cityClear(processing: boolean, clearing: boolean): string;
	requirementLabel(required: boolean): string;
	metWords(met: boolean): string;
	checklistFigure(
		current: number | null,
		recommended: number | null,
	): string | null;
	actionLabel(action: string, type: BusinessType, met?: boolean): string;
	offLine(type: BusinessType): string;
	samePageHash(
		target: { route: string; hash?: string },
		currentRoute: string,
	): string | null;
	photosFigure(published: number, recommended: number): string;
	artistSwitchLabel(listed: boolean, processing: boolean): string;
	manageLabel(name: string): string;
	PREVIEW_BANNER: string;
	PREVIEW_PHOTO_LIMIT: number;
	discoverAddressLine(url: string | null): string;
	locationLine(
		location: {
			name: string;
			region: string | null;
			countryCode: string;
		} | null,
	): string | null;
	noIntro(type: BusinessType): string;
	pageLinkLabel(type: BusinessType): string;
};
const words = discoverModule as DiscoverModule;
const TYPES: BusinessType[] = ["studio", "independent"];

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

test.group("Discover words: city link and the off line", () => {
	test("the city link says Change once a city is set; the off line isn't the button again", ({
		assert,
	}) => {
		assert.equal(
			words.actionLabel("discover_place", "studio"),
			"Choose your city",
		);
		assert.equal(
			words.actionLabel("discover_place", "studio", true),
			"Change city",
		);
		for (const type of ["studio", "independent"] as const) {
			assert.notEqual(words.offLine(type), words.listLabel(type));
		}
		assert.notMatch(words.offLine("independent"), /studio/i);
	});
});

test.group("Discover words (D04): statuses and the badge", () => {
	test("the page knows the server's statuses, in its order", ({ assert }) => {
		assert.deepEqual([...words.DISCOVER_STATUSES], [...PUBLICATION_STATUSES]);
	});

	test("listed reads as good news, a takedown as the worst, the rest quietly", ({
		assert,
	}) => {
		assert.equal(words.statusTone("listed"), "success");
		assert.equal(words.statusTone("needs_attention"), "warning");
		assert.equal(words.statusTone("taken_down"), "danger");
		assert.equal(words.statusTone("eligible"), "neutral");
		assert.equal(words.statusTone("not_listed"), "neutral");
		// A status nobody mapped never looks like a success.
		assert.equal(words.statusTone("something_new"), "neutral");
	});

	test("each tone's colours are the dashboard's status tokens", ({
		assert,
	}) => {
		for (const status of PUBLICATION_STATUSES) {
			const tone = words.statusTone(status);
			if (tone === "danger") continue;
			assert.match(
				words.TONE_CLASS[tone],
				/^bg-status-\w+-bg text-status-\w+-fg$/,
			);
		}
	});
});

test.group("Discover words (D04): a studio and an independent artist", () => {
	test("a studio is asked to list its studio", ({ assert }) => {
		assert.equal(
			words.listLabel("studio"),
			"List my studio on TattooDrip Discover",
		);
		assert.equal(words.previewLabel("studio"), "Preview my studio");
		assert.equal(
			words.pageIntro("studio"),
			"Make your studio discoverable to people looking for tattoo artists and studios.",
		);
	});

	test("an independent artist is never called a studio", ({ assert }) => {
		assert.equal(
			words.listLabel("independent"),
			"List my artist profile on Discover",
		);
		assert.equal(
			words.previewLabel("independent"),
			"Preview my artist profile",
		);
		assert.equal(
			words.actionLabel("portfolio", "independent"),
			"Manage my public portfolio",
		);
		for (const line of [
			words.pageIntro("independent"),
			words.listLabel("independent"),
			words.previewLabel("independent"),
			words.optionalNote("independent"),
			words.onLine("independent"),
			words.turnOffQuestion("independent"),
			words.consentShowsHeading("independent"),
			words.noIntro("independent"),
			words.pageLinkLabel("independent"),
			...["discover_place", "profile", "look", "portfolio", "artists"].map(
				(action) => words.actionLabel(action, "independent"),
			),
		]) {
			// "artists and studios" is what people look for; the business itself is never one.
			assert.notMatch(line, /\b(your|my|the|a) studio\b|studio page/i, line);
		}
	});

	test("Discover is optional and changes neither the page nor bookings", ({
		assert,
	}) => {
		for (const type of TYPES) {
			assert.include(words.optionalNote(type), "optional");
			assert.include(words.optionalNote(type), "bookings work the same");
		}
	});
});

test.group("Discover words (D04): the listing", () => {
	test("a disabled switch points at the required steps by name", ({
		assert,
	}) => {
		assert.equal(
			words.blockedLine(["City"]),
			"Finish the required step first: City. It's marked in the checklist below.",
		);
		assert.equal(
			words.blockedLine(["City", "Logo", "Description"]),
			"Finish the required steps first: City, Logo and Description. They're marked in the checklist below.",
		);
		assert.equal(words.blockedLine([]), "");
	});

	test("the consent box is named, its button says what it does and waits honestly", ({
		assert,
	}) => {
		assert.equal(words.CONSENT_LABEL, "I accept these listing terms");
		assert.equal(words.consentSubmit(false), "Turn on listing");
		assert.equal(words.consentSubmit(true), "Turning on…");
		assert.equal(words.DRAFT_MARKER, "Draft: not legally reviewed");
	});

	test("the accepted terms say when, and how to accept newer ones", ({
		assert,
	}) => {
		assert.equal(
			words.acceptedLine({ acceptedOn: "7 Nov 2026", current: true }),
			"Terms accepted on 7 Nov 2026.",
		);
		const older = words.acceptedLine({
			acceptedOn: "7 Nov 2026",
			current: false,
		});
		assert.include(older, "Terms accepted on 7 Nov 2026.");
		assert.include(older, "Newer listing terms exist");
		assert.include(older, "turning the listing off and on again accepts them");
	});

	test("turning off says the business leaves Discover and nothing else changes", ({
		assert,
	}) => {
		assert.equal(
			words.turnOffQuestion("studio"),
			"Turn off your listing? Your studio leaves Discover within a few minutes. Your studio page, Studio OS and bookings stay as they are.",
		);
		assert.include(
			words.turnOffQuestion("independent"),
			"Your artist profile leaves Discover",
		);
		assert.include(
			words.turnOffQuestion("independent"),
			"Studio OS and bookings stay as they are",
		);
	});

	test("a takedown keeps the listing off Discover whatever the switch says", ({
		assert,
	}) => {
		assert.include(words.TAKEN_DOWN_NOTE, "stays off Discover");
		assert.include(
			words.TAKEN_DOWN_NOTE,
			"You can still turn the listing on or off",
		);
	});

	test("the city buttons say which of them is waiting", ({ assert }) => {
		assert.equal(words.citySave(false, false), "Save city");
		assert.equal(words.citySave(true, false), "Saving…");
		assert.equal(words.citySave(true, true), "Save city");
		assert.equal(words.cityClear(false, false), "Remove city");
		assert.equal(words.cityClear(true, true), "Removing…");
		assert.equal(words.cityClear(true, false), "Remove city");
	});
});

test.group("Discover words (D04): the checklist", () => {
	test("required and recommended items, and their mark for a screen reader", ({
		assert,
	}) => {
		assert.equal(words.requirementLabel(true), "Required");
		assert.equal(words.requirementLabel(false), "Recommended");
		assert.equal(words.metWords(true), "Done:");
		assert.equal(words.metWords(false), "Not done yet:");
	});

	test("a figure is a count against the recommendation, never a percentage", ({
		assert,
	}) => {
		assert.equal(words.checklistFigure(4, 6), "4 of 6");
		assert.equal(words.checklistFigure(0, 3), "0 of 3");
		assert.isNull(words.checklistFigure(null, null));
		assert.isNull(words.checklistFigure(2, null));
	});

	test("every action the server can send has a link of its own", ({
		assert,
	}) => {
		const items = readiness({
			type: "studio",
			optedIn: false,
			takenDown: false,
			publiclyVisible: false,
			hasPlace: false,
			hasLogo: false,
			hasCover: false,
			hasIntro: false,
			artists: [],
		}).items;
		for (const type of TYPES) {
			for (const { action } of items) {
				assert.notEqual(words.actionLabel(action, type), "Open", action);
			}
		}
		assert.equal(
			words.actionLabel("discover_place", "studio"),
			"Choose your city",
		);
	});

	test("the city item scrolls on this page; every other target is a visit", ({
		assert,
	}) => {
		const here = "tenant.settings.discover";
		assert.equal(
			words.samePageHash({ route: here, hash: "city" }, here),
			"#city",
		);
		assert.isNull(words.samePageHash({ route: "tenant.portfolio" }, here));
		assert.isNull(words.samePageHash({ route: here }, here));
	});

	test("an artist's photos read against the server's recommendation", ({
		assert,
	}) => {
		const m = DISCOVER_RECOMMENDED.artistPhotos;
		assert.equal(
			words.photosFigure(1, m),
			`1 of ${m} recommended published photos`,
		);
		assert.equal(words.photosFigure(m, m), `${m} published photos`);
		assert.equal(words.photosFigure(1, 1), "1 published photo");
	});

	test("the artist's switch and the overview's link", ({ assert }) => {
		assert.equal(words.artistSwitchLabel(true, false), "Hide from Discover");
		assert.equal(words.artistSwitchLabel(false, false), "Show on Discover");
		assert.equal(words.artistSwitchLabel(true, true), "Saving…");
		assert.equal(words.manageLabel("Asha"), "Manage Asha");
	});
});

test.group("Discover words (D04): the preview", () => {
	test("the preview never says Discover is live", ({ assert }) => {
		assert.equal(
			words.PREVIEW_BANNER,
			"Preview: this is how your listing could look on Discover. Discover isn't online yet.",
		);
		assert.equal(
			words.discoverAddressLine(null),
			"Your Discover address is set when Discover launches.",
		);
		assert.equal(
			words.discoverAddressLine("https://discover.example/studios/bn"),
			"Your Discover address will be https://discover.example/studios/bn",
		);
	});

	test("the city line and the photo limit", ({ assert }) => {
		assert.isNull(words.locationLine(null));
		assert.equal(
			words.locationLine({
				name: "Pokhara",
				region: "Gandaki",
				countryCode: "NP",
			}),
			"Pokhara, Gandaki",
		);
		assert.equal(
			words.locationLine({
				name: "Kathmandu",
				region: null,
				countryCode: "NP",
			}),
			"Kathmandu",
		);
		assert.equal(words.PREVIEW_PHOTO_LIMIT, 12);
	});

	test("a photo's Discover row shows the server's words", async ({
		assert,
	}) => {
		const details = await read("components/artwork_details.tsx");
		assert.include(details, "photo.discover.label");
		assert.include(details, "photo.discover.note");
		// Every state has both words, so the row is never empty.
		for (const { label, note } of Object.values(ARTWORK_STATE_WORDS)) {
			assert.isAbove(label.length, 0);
			assert.isAbove(note.length, 0);
		}
	});
});

test.group("Discover pages (D04): no optimism, no browser dialog", () => {
	test("the settings page asks in the page and shows no status of its own", async ({
		assert,
	}) => {
		const source = await read("pages/settings/discover.tsx");
		assert.include(source, "<InlineConfirm");
		assert.notInclude(source, "window.confirm");
		assert.notMatch(source, /[^\w.]confirm\(/);
		assert.notMatch(source, /\boptimistic\s*[:=(]|\.optimistic\b/);
		// The consent box starts unticked.
		assert.notMatch(source, /defaultChecked|checked=\{true\}/);
		// The badge is the server's label, and the city item an anchor on this page.
		assert.include(source, "{status.label}");
		assert.include(source, 'id="city"');
	});

	test("the artist's switch is a form that sends the opposite of what the server holds", async ({
		assert,
	}) => {
		const source = await read("pages/artists/form.tsx");
		assert.include(source, 'route="tenant.artists.discover.update"');
		assert.include(source, 'value={discover.listed ? "false" : "true"}');
		assert.include(source, '{ id: "discover", label: "Discover" }');
	});
});
