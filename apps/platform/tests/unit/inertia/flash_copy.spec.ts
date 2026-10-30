import { test } from "@japa/runner";
import { MAX_FLASH_DESIGNS } from "#modules/flash/services/flash_service";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `FlashModule` below restates its shape and the inertia project type-checks the real one.
import * as flashModule from "../../../inertia/components/flash.js";

type FlashModule = {
	MAX_FLASH_DESIGNS: number;
	flashCount(count: number): string;
	flashIntro(owner: boolean): string;
	designNote(design: {
		size: string;
		priceText: string | null;
		hidden: boolean;
		oneOfAKind?: boolean;
		claimed?: boolean;
	}): string;
	flashCardLine(card: {
		artistName: string | null;
		size: string;
		priceText: string | null;
	}): string;
	editDesignLabel(name: string): string;
	removeDesignLabel(name: string): string;
	FLASH_CREATE_NOTE: string;
	FLASH_FULL: string;
	NO_FLASH: string;
	REMOVE_FLASH_QUESTION: string;
	REMOVE_FLASH_CONFIRM: string;
	REMOVE_FLASH_KEEP: string;
	FLASH_OPEN_LABEL: string;
	FLASH_OPEN_HELP: string;
	PICTURE_LABEL: string;
	NAME_HELP: string;
	SIZE_HELP: string;
	PRICE_LABEL: string;
	PRICE_HELP: string;
	SHOWN_LABEL: string;
	SHOWN_HELP: string;
	ONE_OF_A_KIND_LABEL: string;
	ONE_OF_A_KIND_HELP: string;
	MARK_CLAIMED: string;
	MAKE_AVAILABLE: string;
	TAKEN_LABEL: string;
	CLAIMED_HERE: string;
	QUOTE_TAKEN_WARNING: string;
	LINK_TAKEN_QUESTION: string;
	LINK_TAKEN_CONFIRM: string;
	LINK_TAKEN_KEEP: string;
	VERIFY_TAKEN_NOTE: string;
	RECORD_TAKEN_NOTE: string;
	recordTakenNote(designTaken: boolean, kind: string): string | null;
};
const flash = flashModule as FlashModule;

test.group("flash design words (TAT-129)", () => {
	test("the limit is 100 and the server's", ({ assert }) => {
		assert.equal(flash.MAX_FLASH_DESIGNS, MAX_FLASH_DESIGNS);
	});

	test("the count reads 'n of 100 designs'", ({ assert }) => {
		assert.equal(flash.flashCount(3), "3 of 100 designs");
		assert.equal(flash.flashCount(1), "1 of 100 designs");
	});

	test("the intro speaks to an owner about 'this artist' and to an artist about 'you'", ({
		assert,
	}) => {
		assert.equal(
			flash.flashIntro(true),
			"Flash designs this artist offers. Clients see them on the studio page, newest first, and can ask for one.",
		);
		assert.equal(
			flash.flashIntro(false),
			"Flash designs you offer. Clients see them on the studio page, newest first, and can ask for one.",
		);
	});

	test("the notes and the empty and full states", ({ assert }) => {
		assert.equal(
			flash.FLASH_CREATE_NOTE,
			"Once the artist is saved, you can add their flash designs here.",
		);
		assert.equal(
			flash.FLASH_FULL,
			"That's 100 designs, the most an artist can show. Remove one to add another.",
		);
		assert.equal(flash.NO_FLASH, "No flash designs yet.");
	});

	test("removing a design asks in the page", ({ assert }) => {
		assert.equal(
			flash.REMOVE_FLASH_QUESTION,
			"Remove this design? Clients won't see it any more, and it can't be brought back.",
		);
		assert.equal(flash.REMOVE_FLASH_CONFIRM, "Remove design");
		assert.equal(flash.REMOVE_FLASH_KEEP, "Keep the design");
	});

	test("a design's note is its size, then its price or that it is hidden", ({
		assert,
	}) => {
		assert.equal(
			flash.designNote({
				size: "About 3 in",
				priceText: "NPR 3,000",
				hidden: false,
			}),
			"About 3 in · NPR 3,000",
		);
		assert.equal(
			flash.designNote({ size: "About 3 in", priceText: null, hidden: true }),
			"About 3 in · Hidden",
		);
	});

	test("the buttons name their design", ({ assert }) => {
		assert.equal(flash.editDesignLabel("Moth"), "Edit Moth");
		assert.equal(flash.removeDesignLabel("Moth"), "Remove Moth");
	});

	test("the switch and the field words", ({ assert }) => {
		assert.equal(flash.FLASH_OPEN_LABEL, "Taking flash requests");
		assert.equal(
			flash.FLASH_OPEN_HELP,
			"Clients can ask for this artist's flash designs, even while the books are closed.",
		);
		assert.equal(flash.PICTURE_LABEL, "Picture");
		assert.equal(flash.NAME_HELP, "Up to 80 characters.");
		assert.equal(flash.SIZE_HELP, "In words, as you'd say it to a client.");
		assert.equal(flash.PRICE_LABEL, "Price (optional)");
		assert.equal(
			flash.PRICE_HELP,
			"In whole rupees. Leave it empty to agree the price with each client.",
		);
		assert.equal(flash.SHOWN_LABEL, "Show on the studio page");
		assert.equal(
			flash.SHOWN_HELP,
			"Uncheck to take it off the studio page for now. Requests already sent keep it.",
		);
	});

	test("a design card's line is the artist, the size and the price, whichever it has", ({
		assert,
	}) => {
		assert.equal(
			flash.flashCardLine({
				artistName: "Sita Rai",
				size: "About 3 in",
				priceText: "NPR 3,000",
			}),
			"By Sita Rai · About 3 in · NPR 3,000",
		);
		assert.equal(
			flash.flashCardLine({
				artistName: null,
				size: "About 3 in",
				priceText: null,
			}),
			"About 3 in",
		);
	});
	test("one of a kind: the box, its help, the two claim buttons and the note under a design's name", ({
		assert,
	}) => {
		assert.equal(flash.ONE_OF_A_KIND_LABEL, "One of a kind");
		assert.equal(
			flash.ONE_OF_A_KIND_HELP,
			"You'll tattoo it only once. It's marked Claimed when its client's deposit is verified or their project is booked. Leave it unchecked for a design that can be tattooed again. Unchecking a claimed design releases its claim.",
		);
		assert.equal(flash.MARK_CLAIMED, "Mark claimed");
		assert.equal(flash.MAKE_AVAILABLE, "Make available");
		assert.equal(
			flash.designNote({
				size: "About 3 in",
				priceText: "NPR 3,000",
				hidden: false,
				oneOfAKind: true,
				claimed: true,
			}),
			"About 3 in · NPR 3,000 · One of a kind · Claimed",
		);
		assert.equal(
			flash.designNote({
				size: "About 3 in",
				priceText: null,
				hidden: true,
				oneOfAKind: false,
				claimed: false,
			}),
			"About 3 in · Hidden",
		);
		// Plan 4a's calls pass neither field.
		assert.equal(
			flash.designNote({
				size: "About 3 in",
				priceText: null,
				hidden: false,
			}),
			"About 3 in",
		);
		assert.equal(
			flash.designNote({
				size: "About 3 in",
				priceText: null,
				hidden: false,
				oneOfAKind: true,
				claimed: false,
			}),
			"About 3 in · One of a kind",
		);
	});
	test("the words of a design taken: the label, the claimed-here note and the three warnings", ({
		assert,
	}) => {
		assert.equal(flash.TAKEN_LABEL, "Design taken: offer something similar");
		assert.equal(flash.CLAIMED_HERE, "Claimed for this client");
		assert.equal(
			flash.QUOTE_TAKEN_WARNING,
			"This design is already claimed by another client. Talk to this client about something similar before you send a price.",
		);
		assert.equal(
			flash.LINK_TAKEN_QUESTION,
			"This design is already claimed by another client. Make a deposit link anyway?",
		);
		assert.equal(flash.LINK_TAKEN_CONFIRM, "Make the link anyway");
		assert.equal(flash.LINK_TAKEN_KEEP, "Not yet");
		assert.equal(
			flash.VERIFY_TAKEN_NOTE,
			"This design is already claimed by another client: talk to this client before you verify.",
		);
	});

	test("recording a deposit at the desk is a claim moment, so the record sheet warns about a taken design for a deposit only", ({
		assert,
	}) => {
		assert.equal(
			flash.RECORD_TAKEN_NOTE,
			"This design is already claimed by another client: talk to this client before you record the deposit.",
		);
		assert.equal(
			flash.recordTakenNote(true, "deposit"),
			flash.RECORD_TAKEN_NOTE,
		);
		assert.isNull(flash.recordTakenNote(false, "deposit"));
		assert.isNull(flash.recordTakenNote(true, "session"));
		assert.isNull(flash.recordTakenNote(true, "balance"));
	});
});
