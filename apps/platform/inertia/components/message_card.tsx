import { useState } from "react";
import ChatMessage, { ChatLinks } from "~/components/chat_message";
import type {
	CardMessageProps,
	ContactLinksProps,
	ContactVia,
	MessageKindName,
} from "~/components/messages";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldLabel } from "~/components/ui/field";

/**
 * "Message the client" (TAT-52): the messages a project or an inquiry
 * offers now, each sent in one tap, and plain links to a chat or a call.
 * Every tap goes to `onContact`, which records the last contact.
 */
export default function MessageCard({
	contact,
	messages,
	initialKind,
	onContact,
	footer,
}: {
	contact: ContactLinksProps | null;
	messages: CardMessageProps[];
	initialKind: MessageKindName | null;
	onContact: (via: ContactVia) => void;
	/** Shown under the links, e.g. the inquiry's last contact. */
	footer?: string;
}) {
	const [kind, setKind] = useState(initialKind);
	const selected =
		messages.find((message) => message.kind === kind) ?? messages[0] ?? null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Message the client</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{contact === null ? (
					<p className="text-sm text-muted-foreground">
						This client has no phone number to message.
					</p>
				) : (
					<>
						{messages.length > 1 && (
							<Field>
								<FieldLabel htmlFor="message-kind">Message</FieldLabel>
								<select
									id="message-kind"
									value={selected?.kind}
									onChange={(event) =>
										setKind(event.target.value as MessageKindName)
									}
									className="h-11 min-w-0 rounded-md border bg-transparent px-3 text-sm"
								>
									{messages.map((message) => (
										<option key={message.kind} value={message.kind}>
											{message.label}
										</option>
									))}
								</select>
							</Field>
						)}
						{messages.length === 1 && selected && (
							<p className="text-sm font-medium">{selected.label}</p>
						)}
						{selected && (
							<ChatMessage
								message={selected}
								onSent={(channel) =>
									onContact({ channel, kind: selected.kind })
								}
							/>
						)}
						<div className="flex flex-col gap-2">
							<p className="text-sm text-muted-foreground">
								{messages.length > 0
									? "Or open a chat without a message:"
									: "Open a chat with the client:"}
							</p>
							<ChatLinks
								contact={contact}
								onSent={(channel) => onContact({ channel })}
							/>
						</div>
					</>
				)}
				{footer && <p className="text-sm text-muted-foreground">{footer}</p>}
			</CardContent>
		</Card>
	);
}
