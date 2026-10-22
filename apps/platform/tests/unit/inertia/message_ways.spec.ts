import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `MessagesModule` below restates its shape and the inertia project type-checks the real one.
import * as messagesModule from "../../../inertia/components/messages.js";

type Channel = "whatsapp" | "viber" | "call" | "copy";
type Primary = "whatsapp" | "viber";
type Way = {
	id: string;
	label: string;
	channel: Channel;
	withMessage: boolean;
};
type MessagesModule = {
	primaryChannel(last: Channel | null): Primary;
	PRIMARY_LABELS: Record<Primary, string>;
	otherWays(primary: Primary, offersPlain: boolean): Way[];
	foldToggle(
		expanded: boolean,
		overflows: boolean,
	): { clamp: boolean; showToggle: boolean; label: string };
	FOLD_LINES: number;
	VIBER_HINT: string;
};
const {
	primaryChannel,
	PRIMARY_LABELS,
	otherWays,
	foldToggle,
	FOLD_LINES,
	VIBER_HINT,
} = messagesModule as MessagesModule;

// TAT-104: one primary way to message the client, the rest in one row.
test.group("primaryChannel (TAT-104)", () => {
	test("WhatsApp unless the last message went out on Viber", ({ assert }) => {
		assert.equal(primaryChannel(null), "whatsapp");
		assert.equal(primaryChannel("whatsapp"), "whatsapp");
		assert.equal(primaryChannel("viber"), "viber");
	});

	test("a call or a copied text says nothing about where the client reads messages", ({
		assert,
	}) => {
		assert.equal(primaryChannel("call"), "whatsapp");
		assert.equal(primaryChannel("copy"), "whatsapp");
	});

	test("the primary button says what the tap does", ({ assert }) => {
		assert.equal(PRIMARY_LABELS.whatsapp, "Send on WhatsApp");
		// Viber's chat link can't carry text: the tap copies it first.
		assert.equal(PRIMARY_LABELS.viber, "Copy and open Viber");
	});
});

test.group("otherWays (TAT-104)", () => {
	test("with WhatsApp first: Viber, Call, Copy text, Chat without a message", ({
		assert,
	}) => {
		assert.deepEqual(
			otherWays("whatsapp", true).map(({ id, label }) => [id, label]),
			[
				["viber", "Viber"],
				["call", "Call"],
				["copy", "Copy text"],
				["chat", "Chat without a message"],
			],
		);
	});

	test("with Viber first, WhatsApp takes Viber's place and the rest stays", ({
		assert,
	}) => {
		assert.deepEqual(
			otherWays("viber", true).map(({ id, label }) => [id, label]),
			[
				["whatsapp", "WhatsApp"],
				["call", "Call"],
				["copy", "Copy text"],
				["chat", "Chat without a message"],
			],
		);
	});

	test("a message that stands alone (the quote, the deposit link) has no call or plain chat", ({
		assert,
	}) => {
		assert.deepEqual(
			otherWays("whatsapp", false).map(({ id }) => id),
			["viber", "copy"],
		);
		assert.deepEqual(
			otherWays("viber", false).map(({ id }) => id),
			["whatsapp", "copy"],
		);
	});

	test("each tap records the channel it used, and the message only when it sends one", ({
		assert,
	}) => {
		// What the pages post to the contacted route: Call and the plain chat
		// carry no message kind, exactly as the three plain links did before.
		const recorded = (primary: Primary) =>
			otherWays(primary, true).map(
				({ id, channel, withMessage }) => `${id}:${channel}:${withMessage}`,
			);
		assert.deepEqual(recorded("whatsapp"), [
			"viber:viber:true",
			"call:call:false",
			"copy:copy:true",
			"chat:whatsapp:false",
		]);
		// The plain chat opens the chat on the channel that leads.
		assert.deepEqual(recorded("viber"), [
			"whatsapp:whatsapp:true",
			"call:call:false",
			"copy:copy:true",
			"chat:viber:false",
		]);
	});
});

test.group("foldToggle (TAT-104)", () => {
	test("the preview folds to two lines", ({ assert }) => {
		assert.equal(FOLD_LINES, 2);
	});

	test("a long message is folded, with a toggle that offers to show it", ({
		assert,
	}) => {
		assert.deepEqual(foldToggle(false, true), {
			clamp: true,
			showToggle: true,
			label: "Show message",
		});
	});

	test("shown in full, the toggle offers to hide it again", ({ assert }) => {
		assert.deepEqual(foldToggle(true, true), {
			clamp: false,
			showToggle: true,
			label: "Hide message",
		});
	});

	test("a message that fits in two lines has nothing to fold", ({ assert }) => {
		assert.deepEqual(foldToggle(false, false), {
			clamp: true,
			showToggle: false,
			label: "Show message",
		});
	});
});

test.group("the Viber hint (TAT-104)", () => {
	test("is one sentence pair that says the message is copied and where to paste it", ({
		assert,
	}) => {
		assert.match(VIBER_HINT, /copied/i);
		assert.match(VIBER_HINT, /paste/i);
		assert.include(VIBER_HINT, "Viber");
	});
});
