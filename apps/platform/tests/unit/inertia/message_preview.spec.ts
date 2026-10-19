import { test } from "@japa/runner";
import {
	DEFAULT_TEMPLATES,
	KIND_PLACEHOLDERS,
	MESSAGE_KINDS,
	type MessageKind,
	renderMessage,
	sampleValues,
} from "#modules/notifications/messages";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `MessagesModule` below restates its shape and the inertia project type-checks the real one.
import * as messagesModule from "../../../inertia/components/messages.js";

type MessagesModule = {
	previewMessage(
		text: string,
		allowed: readonly string[],
		values: Readonly<Record<string, string>>,
	): string;
};
const { previewMessage } = messagesModule as MessagesModule;

test.group("previewMessage", () => {
	test("shows exactly what the server sends", ({ assert }) => {
		const sample = sampleValues({ name: "Black Needle", address: null });
		const cases: [MessageKind, string][] = [
			...MESSAGE_KINDS.map((kind): [MessageKind, string] => [
				kind,
				DEFAULT_TEMPLATES[kind],
			]),
			["quote", "Hi {client_name}, {deposit_link} {price} {Price} {}"],
			[
				"booking_confirmation",
				"See you {session_time}{studio_address} at {studio_address}.\nनमस्ते 🙏",
			],
		];

		for (const [kind, text] of cases) {
			assert.equal(
				previewMessage(text, KIND_PLACEHOLDERS[kind], sample),
				renderMessage(kind, text, sample),
				`${kind}: ${text}`,
			);
		}
	});
});
