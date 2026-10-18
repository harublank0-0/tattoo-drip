import { cn } from "cn";
import { toast } from "sonner";
import type {
	ContactChannelName,
	ContactLinksProps,
} from "~/components/messages";
import type { ChatMessageProps } from "~/components/projects";
import { Button, buttonVariants } from "~/components/ui/button";

const LINK = cn(buttonVariants({ variant: "outline" }), "h-11");

/**
 * A chat message with its one-tap links (TAT-64, TAT-52): WhatsApp opens
 * with it filled in; Viber's link can't carry text, so staff copy it and
 * paste. Every tap tells the page its channel, which records the contact.
 */
export default function ChatMessage({
	message,
	onSent,
}: {
	message: ChatMessageProps;
	onSent: (channel: ContactChannelName) => void;
}) {
	const copy = () => {
		navigator.clipboard.writeText(message.text).then(
			() => {
				toast.success("Message copied.");
				onSent("copy");
			},
			() => toast.error("Couldn't copy: select the text instead."),
		);
	};

	return (
		<div className="flex flex-col gap-3 rounded-md border p-3">
			<p className="text-sm break-words whitespace-pre-line">{message.text}</p>
			<div className="flex flex-wrap gap-2">
				<a
					href={message.whatsappUrl}
					target="_blank"
					rel="noreferrer"
					onClick={() => onSent("whatsapp")}
					className={LINK}
				>
					Send on WhatsApp
				</a>
				<a
					href={message.viberUrl}
					onClick={() => onSent("viber")}
					className={LINK}
				>
					Open Viber chat
				</a>
				<Button type="button" variant="ghost" className="h-11" onClick={copy}>
					Copy message
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				Viber opens the chat empty: copy the message first, then paste it there.
			</p>
		</div>
	);
}

/** One-tap links to the client without a message: a WhatsApp chat, a Viber chat and a call. */
export function ChatLinks({
	contact,
	onSent,
}: {
	contact: ContactLinksProps;
	onSent: (channel: ContactChannelName) => void;
}) {
	return (
		<div className="flex flex-wrap gap-2">
			<a
				href={contact.whatsappUrl}
				target="_blank"
				rel="noreferrer"
				onClick={() => onSent("whatsapp")}
				className={LINK}
			>
				WhatsApp
			</a>
			<a
				href={contact.viberUrl}
				onClick={() => onSent("viber")}
				className={LINK}
			>
				Viber
			</a>
			<a href={contact.callUrl} onClick={() => onSent("call")} className={LINK}>
				Call
			</a>
		</div>
	);
}
