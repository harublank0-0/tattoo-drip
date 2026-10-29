import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `TypingModule` below restates its shape and the inertia project type-checks the real one.
import * as typingModule from "../../../inertia/components/shell/typing.js";

type Target = {
	tagName: string;
	type?: string;
	readOnly?: boolean;
	isContentEditable?: boolean;
};
const { opensKeyboard } = typingModule as {
	opensKeyboard(element: Target | null): boolean;
};

// TAT-84: the phone's tab bar hides while the keyboard is up.
test.group("Fields that open the keyboard", () => {
	test("text fields, textareas and editable text do", ({ assert }) => {
		for (const type of [
			"text",
			"email",
			"tel",
			"number",
			"search",
			"password",
			"url",
		]) {
			assert.isTrue(opensKeyboard({ tagName: "INPUT", type }), type);
		}
		assert.isTrue(opensKeyboard({ tagName: "INPUT" }));
		assert.isTrue(opensKeyboard({ tagName: "TEXTAREA" }));
		assert.isTrue(opensKeyboard({ tagName: "DIV", isContentEditable: true }));
	});

	test("buttons, boxes, pickers, read-only fields and nothing don't", ({
		assert,
	}) => {
		for (const type of [
			"checkbox",
			"radio",
			"submit",
			"button",
			"file",
			"date",
			"time",
			"color",
			"range",
		]) {
			assert.isFalse(opensKeyboard({ tagName: "INPUT", type }), type);
		}
		assert.isFalse(opensKeyboard({ tagName: "BUTTON", type: "submit" }));
		assert.isFalse(opensKeyboard({ tagName: "SELECT" }));
		assert.isFalse(opensKeyboard({ tagName: "A" }));
		assert.isFalse(opensKeyboard({ tagName: "BODY" }));
		assert.isFalse(
			opensKeyboard({ tagName: "INPUT", type: "text", readOnly: true }),
		);
		assert.isFalse(opensKeyboard({ tagName: "TEXTAREA", readOnly: true }));
		assert.isFalse(opensKeyboard(null));
	});
});
