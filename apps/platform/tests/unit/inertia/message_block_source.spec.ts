import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (path: string) =>
	readFile(new URL(`../../../inertia/${path}`, import.meta.url), "utf8");

// What the behaviour tests (message_ways.spec.ts, fold.spec.ts) can't see: the
// markup of the preview. A source scan, kept to structure: the handlers' order
// and the call sites' arguments are tested by behaviour and by the type
// checker (`primary` is a required prop).
test.group("the message block's markup (TAT-104)", () => {
	test("the preview folds to two lines behind a Button that says whether it is open and what it opens", async ({
		assert,
	}) => {
		const chat = await read("components/chat_message.tsx");
		assert.include(chat, "line-clamp-2");
		assert.match(chat, /aria-expanded=\{/);
		assert.match(chat, /aria-controls=\{/);
		// A real <button> (the shared Button): Enter and Space work with no
		// key handler of ours, and below lg it is 44px (TAT-103).
		const at = chat.indexOf("aria-expanded");
		const tag = chat.slice(chat.lastIndexOf("<", at), at);
		assert.match(tag, /^<Button\b/);
	});

	test("every control is a Button or a button-styled link, so the 44px rule applies", async ({
		assert,
	}) => {
		for (const file of [
			"components/chat_message.tsx",
			"components/message_card.tsx",
		]) {
			assert.notInclude(await read(file), "<button", file);
		}
	});

	test("no handler in the block prevents a link's own navigation", async ({
		assert,
	}) => {
		// The Viber tap opens Viber by the anchor's default action, in the tap
		// (tapViber, message_ways.spec.ts): preventDefault followed by a
		// navigation after an await is what iOS Safari can refuse. The
		// component can't be loaded here (the `~/` alias), so this one is a
		// scan of the source.
		assert.notInclude(
			await read("components/chat_message.tsx"),
			"preventDefault",
		);
	});
});
