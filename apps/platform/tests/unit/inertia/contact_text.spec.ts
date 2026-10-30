import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	CONTACT_CHANNELS,
	type ContactChannel,
	MESSAGE_KINDS,
	type MessageKind,
} from "#modules/notifications/messages";
import { lastContactText } from "#modules/projects/contact";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `MessagesModule` below restates its shape and the inertia project type-checks the real one.
import * as messagesModule from "../../../inertia/components/messages.js";

type Via = { channel?: ContactChannel; kind?: MessageKind };
type MessagesModule = {
	justContactedText(via: Via): string;
	justContacted(via: Via): {
		contactedText: string;
		lastChannel: ContactChannel | null;
	};
};
const { justContactedText, justContacted } = messagesModule as MessagesModule;

// TAT-84: the page shows the last contact before the server answers, in the
// server's own words, so the answer doesn't change the text.
test.group("Last contact shown at once", () => {
	test("says what the server says for a contact made now, for every channel and message", ({
		assert,
	}) => {
		const now = DateTime.now();
		const channels = [undefined, ...CONTACT_CHANNELS];
		const kinds = [undefined, ...MESSAGE_KINDS];
		for (const channel of channels) {
			for (const kind of kinds) {
				assert.equal(
					justContactedText({ channel, kind }),
					lastContactText(now, "Asia/Kathmandu", {
						channel: channel ?? null,
						kind: kind ?? null,
					}),
				);
			}
		}
	});

	test("sets the channel the card leads with, none for Mark contacted", ({
		assert,
	}) => {
		assert.deepEqual(justContacted({ channel: "viber", kind: "quote" }), {
			contactedText: "contacted today on Viber (Quote)",
			lastChannel: "viber",
		});
		assert.deepEqual(justContacted({}), {
			contactedText: "contacted today",
			lastChannel: null,
		});
	});
});
