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
	tapViber(steps: {
		copy(): Promise<boolean>;
		record(): void;
		hint(): void;
		refused(): void;
	}): void;
	tapCopy(steps: {
		copy(): Promise<boolean>;
		done(): void;
		record(): void;
		refused(): void;
	}): void;
	VIBER_HINT: string;
};
const {
	primaryChannel,
	PRIMARY_LABELS,
	otherWays,
	tapViber,
	tapCopy,
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

test.group("the Viber hint (TAT-104)", () => {
	test("is one sentence pair that says the message is copied and where to paste it", ({
		assert,
	}) => {
		assert.match(VIBER_HINT, /copied/i);
		assert.match(VIBER_HINT, /paste/i);
		assert.include(VIBER_HINT, "Viber");
	});
});

/** Lets the promise callbacks a tap queued run. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// The Viber tap is the anchor's own navigation: the page's click handler may
// start the copy and record the contact, but must not wait for the copy, or
// iOS Safari can refuse the viber:// navigation as not made by a user gesture.
test.group("tapViber (TAT-104)", () => {
	test("starts the copy and records the contact in the same tick, whatever the copy does", async ({
		assert,
	}) => {
		const calls: string[] = [];
		// A copy that never settles, like a clipboard that is slow to answer.
		const never = new Promise<boolean>(() => {});
		tapViber({
			copy: () => {
				calls.push("copy");
				return never;
			},
			record: () => calls.push("record"),
			hint: () => calls.push("hint"),
			refused: () => calls.push("refused"),
		});
		// Nothing has been awaited: the click handler is done, so the anchor
		// opens Viber now. (The hint and the refusal wait for the copy.)
		assert.deepEqual(calls, ["copy", "record"]);
		await settled();
		assert.deepEqual(calls, ["copy", "record"]);
	});

	test("a copy that went through shows the hint, once", async ({ assert }) => {
		const calls: string[] = [];
		tapViber({
			copy: async () => true,
			record: () => calls.push("record"),
			hint: () => calls.push("hint"),
			refused: () => calls.push("refused"),
		});
		await settled();
		assert.deepEqual(calls, ["record", "hint"]);
	});

	test("a refused or failed copy asks to select the text, and the contact is still recorded once", async ({
		assert,
	}) => {
		for (const copy of [
			async () => false,
			() => Promise.reject(new Error("denied")),
		]) {
			const calls: string[] = [];
			tapViber({
				copy,
				record: () => calls.push("record"),
				hint: () => calls.push("hint"),
				refused: () => calls.push("refused"),
			});
			await settled();
			assert.deepEqual(calls, ["record", "refused"]);
		}
	});
});

test.group("tapCopy (TAT-104)", () => {
	test("records the copy only after the clipboard took it", async ({
		assert,
	}) => {
		const calls: string[] = [];
		let finish: (copied: boolean) => void = () => {};
		tapCopy({
			copy: () => new Promise<boolean>((resolve) => (finish = resolve)),
			done: () => calls.push("done"),
			record: () => calls.push("record"),
			refused: () => calls.push("refused"),
		});
		assert.deepEqual(calls, []);
		finish(true);
		await settled();
		assert.deepEqual(calls, ["done", "record"]);
	});

	test("a refused copy records nothing", async ({ assert }) => {
		const calls: string[] = [];
		tapCopy({
			copy: async () => false,
			done: () => calls.push("done"),
			record: () => calls.push("record"),
			refused: () => calls.push("refused"),
		});
		await settled();
		assert.deepEqual(calls, ["refused"]);
	});
});
