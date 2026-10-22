import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (path: string) =>
	readFile(new URL(`../../../inertia/${path}`, import.meta.url), "utf8");

/**
 * The source of one function (`function name(` or `const name = `), from its
 * name to its closing brace, so an assertion can't pass by matching another
 * function in the file. The functions it reads hold no braces in strings.
 */
function body(source: string, name: string): string {
	const start = source.search(
		new RegExp(`(async )?function ${name}\\(|const ${name} = `),
	);
	if (start === -1) throw new Error(`no ${name}`);
	const open = source.slice(start).search(/\)(: [\w<>]+)? \{|=> \{/);
	let depth = 0;
	for (let at = start + open; at < source.length; at++) {
		if (source[at] === "{") depth++;
		if (source[at] === "}" && --depth === 0) {
			return source.slice(start, at + 1);
		}
	}
	throw new Error(`${name} never closes`);
}

/** Every `<Tag ... />` of a component in `source`, as written. */
function elements(source: string, tag: string): string[] {
	return source
		.split(`<${tag}`)
		.slice(1)
		.map((rest) => rest.slice(0, rest.search(/\/>|<\//)));
}

// The contract of the "Message the client" card (TAT-104) that only a browser
// can fully show: the keyboard path of the fold, the order of copy and open,
// and that no call site draws a message without the channel that leads.
test.group("the message block (TAT-104)", () => {
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
		assert.notInclude(chat, "<button");
	});

	test("Viber copies the message, then opens the chat, and says so once", async ({
		assert,
	}) => {
		const chat = await read("components/chat_message.tsx");
		const open = body(chat, "openViber");
		const order = [
			open.indexOf("preventDefault"),
			open.indexOf("copyText("),
			open.indexOf("VIBER_HINT"),
			open.indexOf("onSent("),
			open.indexOf("window.location.assign("),
		];
		assert.isTrue(
			order.every((at) => at !== -1),
			"each step is in the handler",
		);
		assert.deepEqual(
			order,
			[...order].sort((a, b) => a - b),
			"preventDefault, copy, hint, record, open",
		);
		// One toast per tap: the hint is the copy's confirmation, not a second one.
		assert.lengthOf(open.match(/toast\.success\(/g) ?? [], 1);
	});

	test("a failed copy never leaves the staff without the text: the preview opens and nothing is recorded as a copy", async ({
		assert,
	}) => {
		const chat = await read("components/chat_message.tsx");
		const copy = body(chat, "copyText");
		assert.include(copy, "navigator.clipboard");
		const failed = body(chat, "failed");
		assert.include(failed, "setExpanded(true)");
		assert.include(failed, "Couldn't copy: select the text instead.");
		// "Copy text" records the copy only after the write went through.
		const copyTap = body(chat, "copyTap");
		assert.isAbove(
			copyTap.indexOf('onSent("copy")'),
			copyTap.indexOf("copyText("),
		);
	});

	test("the card and the block draw every control with Button or a button-styled link", async ({
		assert,
	}) => {
		for (const file of [
			"components/chat_message.tsx",
			"components/message_card.tsx",
		]) {
			const source = await read(file);
			assert.notInclude(source, "<button", file);
			assert.notInclude(source, "Open Viber chat", file);
			assert.notInclude(source, "Copy message", file);
		}
	});

	test("every ChatMessage on the pages is told which channel leads", async ({
		assert,
	}) => {
		const project = await read("pages/projects/show.tsx");
		const drawn = elements(project, "ChatMessage");
		// The Quote card and the Deposit card.
		assert.lengthOf(drawn, 2);
		for (const props of drawn) assert.include(props, "primary=");
		for (const props of elements(project, "MessageCard")) {
			assert.include(props, "lastChannel=");
		}
		for (const props of elements(
			await read("pages/inquiries/show.tsx"),
			"MessageCard",
		)) {
			assert.include(props, "lastChannel=");
		}
	});
});
