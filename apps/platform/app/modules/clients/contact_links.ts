/**
 * Links that reach a client at `phone` (E.164): a chat on WhatsApp or
 * Viber, and a call. WhatsApp can prefill `text`; Viber's chat link takes
 * no text, so staff paste it (the project page's Copy button).
 */
export function chatLinks(
	phone: string,
	text?: string,
): { whatsapp: string; viber: string } {
	const digits = phone.replace(/\D/g, "");
	return {
		whatsapp:
			text === undefined
				? `https://wa.me/${digits}`
				: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`,
		viber: `viber://chat?number=%2B${digits}`,
	};
}

/** A link that starts a phone call to `phone` (E.164). */
export function telLink(phone: string): string {
	return `tel:${phone}`;
}
