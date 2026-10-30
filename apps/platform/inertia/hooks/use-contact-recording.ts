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
 * come back (with the lost-connection toast).
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
			// Only the latest tap clears the mark: a second tap interrupts the first visit.
			onFinish: () => {
				if (latest.current === mine) setMark(null);
			},
		});
	};
	return { ...shownContact(mark, recordId, server), record };
}
