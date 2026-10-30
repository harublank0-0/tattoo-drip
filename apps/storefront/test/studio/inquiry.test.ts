import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flashDesignView } from "../../src/studio/flash.ts";
import {
	flashInquiryState,
	inquiryChannels,
	inquiryState,
	similarInquiryState,
} from "../../src/studio/inquiry.ts";
import {
	artistViewModels,
	studioViewModel,
} from "../../src/studio/view-model.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	EMPTY_STUDIO,
	flashPage,
	SITA,
	STUDIO,
} from "./fixtures.ts";

const studio = studioViewModel(STUDIO);
const closedStudio = studioViewModel(CLOSED_STUDIO);
const [sita, arjun] = artistViewModels([SITA, ARJUN]);
const SITA_CHOICE = { id: SITA.id, name: "Sita Rai" };

describe("inquiryState", () => {
	test("the studio page takes a general inquiry, offering the accepting artists", () => {
		assert.deepEqual(inquiryState(studio, [sita, arjun], null), {
			kind: "open",
			studioName: "Black Needle",
			preferredArtist: null,
			artists: [SITA_CHOICE],
		});
	});

	test("an artist's page asks for that artist", () => {
		assert.deepEqual(inquiryState(studio, [sita, arjun], sita), {
			kind: "open",
			studioName: "Black Needle",
			preferredArtist: SITA_CHOICE,
			artists: [SITA_CHOICE],
		});
	});

	test("a studio with no visible artist takes general inquiries", () => {
		assert.deepEqual(inquiryState(studio, [], null), {
			kind: "open",
			studioName: "Black Needle",
			preferredArtist: null,
			artists: [],
		});
	});

	test("a closed studio takes none", () => {
		assert.deepEqual(inquiryState(closedStudio, [arjun], null), {
			kind: "studio-closed",
			studioName: "Black Needle",
		});
	});

	test("a closed artist's page points to the studio while it is open", () => {
		assert.deepEqual(inquiryState(studio, [sita, arjun], arjun), {
			kind: "artist-closed",
			studioName: "Black Needle",
			artistName: "अर्जुन थापा",
			studioOpen: true,
			closedMessage: "Books open in March.",
		});
		assert.deepEqual(inquiryState(closedStudio, [arjun], arjun), {
			kind: "artist-closed",
			studioName: "Black Needle",
			artistName: "अर्जुन थापा",
			studioOpen: false,
			closedMessage: "Books open in March.",
		});
	});

	test("a closed artist with no message of their own has none", () => {
		const [quiet] = artistViewModels([{ ...ARJUN, closedMessage: null }]);
		assert.deepEqual(inquiryState(studio, [quiet], quiet), {
			kind: "artist-closed",
			studioName: "Black Needle",
			artistName: "अर्जुन थापा",
			studioOpen: true,
			closedMessage: null,
		});
	});

	test("an artist's own switch decides their page, even against an older studio flag", () => {
		assert.equal(inquiryState(closedStudio, [sita], sita).kind, "open");
	});
});

describe("inquiryChannels", () => {
	test("prefills WhatsApp and email with the studio's name", () => {
		assert.deepEqual(inquiryChannels(studio, null), {
			whatsapp:
				"https://wa.me/9779812345678?text=Hi%20Black%20Needle%2C%20I'd%20like%20to%20ask%20about%20a%20tattoo.",
			email:
				"mailto:hello@black-needle.example?subject=Tattoo%20inquiry&body=Hi%20Black%20Needle%2C%0D%0A%0D%0AMy%20idea%3A%0D%0APlacement%20and%20size%3A%0D%0APreferred%20dates%3A%0D%0A",
			instagram: null,
		});
	});

	test("names the artist the inquiry asks for", () => {
		const channels = inquiryChannels(studio, SITA_CHOICE);

		assert.equal(
			channels.whatsapp,
			"https://wa.me/9779812345678?text=Hi%20Black%20Needle%2C%20I'd%20like%20to%20ask%20Sita%20Rai%20about%20a%20tattoo.",
		);
		assert.match(
			channels.email ?? "",
			/\?subject=Tattoo%20inquiry%20for%20Sita%20Rai&body=/,
		);
	});

	test("falls back to Instagram, then to nothing", () => {
		const instagramOnly = studioViewModel({
			...EMPTY_STUDIO,
			socialLinks: [
				{ platform: "instagram", url: "https://instagram.com/blackneedle" },
			],
		});

		assert.deepEqual(inquiryChannels(instagramOnly, null), {
			whatsapp: null,
			email: null,
			instagram: "https://instagram.com/blackneedle",
		});
		assert.deepEqual(inquiryChannels(studioViewModel(EMPTY_STUDIO), null), {
			whatsapp: null,
			email: null,
			instagram: null,
		});
	});
});

describe("a flash request (TAT-129)", () => {
	const design = flashDesignView(
		flashPage(1).data[0],
		"https://api.example.com",
	);

	test("is open for the design's artist alone, with the idea and size filled in", () => {
		assert.ok(design);
		const [closedBooks] = artistViewModels([
			{ ...SITA, acceptingInquiries: false, closedMessage: "Booked." },
		]);

		const state = flashInquiryState(studio, design, closedBooks);

		assert.deepEqual(state, {
			kind: "open",
			studioName: "Black Needle",
			preferredArtist: { id: SITA.id, name: "Sita Rai" },
			artists: [{ id: SITA.id, name: "Sita Rai" }],
			start: { idea: "The Moth flash", approximateSize: "About 3 in" },
			flashDesignId: design.id,
		});
	});

	test("something similar: open for an artist taking new work, with the idea started and no design id", () => {
		assert.ok(design);
		const state = similarInquiryState(studio, design, sita, [sita, arjun]);

		assert.equal(state.kind, "open");
		if (state.kind !== "open") return;
		assert.deepEqual(state.preferredArtist, { id: sita.id, name: sita.name });
		assert.deepEqual(state.start, {
			idea: "Something similar to the Moth flash",
			approximateSize: "About 3 in",
		});
		assert.equal("flashDesignId" in state, false);
	});

	test("something similar from an artist whose books are closed is the artist-closed state with their words", () => {
		assert.ok(design);
		const [closedBooks] = artistViewModels([
			{ ...SITA, acceptingInquiries: false, closedMessage: "Booked." },
		]);

		const state = similarInquiryState(studio, design, closedBooks, [
			closedBooks,
			arjun,
		]);

		assert.deepEqual(
			state,
			inquiryState(studio, [closedBooks, arjun], closedBooks),
		);
		assert.equal(state.kind, "artist-closed");
		if (state.kind === "artist-closed") {
			assert.equal(state.closedMessage, "Booked.");
		}
	});

	test("a custom request's state has neither key", () => {
		const state = inquiryState(studio, [sita, arjun], sita);

		assert.equal(state.kind, "open");
		assert.equal("start" in state, false);
		assert.equal("flashDesignId" in state, false);
	});

	test("the fallback channels name the design", () => {
		const channels = inquiryChannels(studio, null, "Moth");

		assert.equal(
			decodeURIComponent(channels.whatsapp ?? ""),
			"https://wa.me/9779812345678?text=Hi Black Needle, I'd like to ask about the Moth flash.",
		);
		assert.match(channels.email ?? "", /subject=Flash%20request%3A%20Moth/);
		assert.match(
			decodeURIComponent(channels.email ?? ""),
			/My idea:\r\nPlacement and size:/,
		);
		// Without a name nothing changes.
		assert.deepEqual(
			inquiryChannels(studio, null),
			inquiryChannels(studio, null, null),
		);
	});
});
