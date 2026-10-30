import { router } from "@inertiajs/react";
import { useRef, useState } from "react";
import {
	type ContactChannelName,
	type ContactMark,
	type ContactVia,
	shownContact,
} from "~/components/messages";

/**
 * Recording a contact on a project or an inquiry (TAT-46, TAT-52, TAT-84): every chat link, Call,
 * "Copy message" and "Mark contacted". `record` posts it to `url`; until the visit ends the
 * Message card shows what the server will answer (`shownContact`: "contacted today on WhatsApp",
 * and the channel it leads with), at once. The mark is page state scoped to `recordId`, never an
 * Inertia optimistic visit (that one leaks its props into the next page), and it is cleared when
 * the visit ends: by then the answer carries the truth, or the request failed and the old words
 * come back (with the lost-connection toast). Taps overlap freely (async), so only the latest
 * tap clears the mark.
 */
export function useContactRecording(
	recordId: string,
	url: string,
	server: { contactedText: string; lastChannel: ContactChannelName | null },
) {
	const [mark, setMark] = useState<ContactMark | null>(null);
	const latest = useRef(0);
	const record = (via: ContactVia = {}) => {
		const mine = ++latest.current;
		setMark({ id: recordId, via });
		router.post(url, via, {
			preserveScroll: true,
			preserveState: true,
			// An async partial visit. Async: only sync visits interrupt each other, so a tap on a
			// chat link neither aborts a save in flight (Accept and create project, a payment, a
			// quote) nor is aborted by the next navigation (Inertia does not apply an async answer
			// to another page). Partial: a late answer carries only what the contact changes (the
			// contact line and the leading channel, which both pages read) plus the always-shared
			// props, so it cannot put any other prop back to an older value.
			async: true,
			only: ["contactedText", "lastChannel"],
			// Only the latest tap clears the mark: an earlier tap's answer must not drop it.
			onFinish: () => {
				if (latest.current === mine) setMark(null);
			},
		});
	};
	return { ...shownContact(mark, recordId, server), record };
}
