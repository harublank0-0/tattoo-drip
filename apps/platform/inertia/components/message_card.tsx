import { useState } from "react";
import ChatMessage, { ChatLinks } from "~/components/chat_message";
import {
	type CardMessageProps,
	type ContactChannelName,
	type ContactLinksProps,
	type ContactVia,
	type MessageKindName,
	primaryChannel,
} from "~/components/messages";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Label } from "~/components/ui/label";

/**
 * "Message the client" (TAT-52, TAT-104): the message a project or an inquiry
 * offers now, folded to two lines, with one leading way to send it and one
 * row of other ways; with no message to offer, plain links to a chat or a
 * call. Every tap goes to `onContact`, which records the last contact.
 */
export default function MessageCard({
	contact,
	messages,
	initialKind,
	lastChannel,
	onContact,
	footer,
	onMarkContacted,
}: {
	contact: ContactLinksProps | null;
	messages: CardMessageProps[];
	initialKind: MessageKindName | null;
	/** The channel of the last contact: the button that leads follows it. */
	lastChannel: ContactChannelName | null;
	onContact: (via: ContactVia) => void;
	/** Shown under the title, e.g. the inquiry's last contact. */
	footer?: string;
	/** Records a contact made some other way (TAT-46): the project page's "Mark contacted". */
	onMarkContacted?: () => void;
}) {
	const [kind, setKind] = useState(initialKind);
	const selected =
		messages.find((message) => message.kind === kind) ?? messages[0] ?? null;

	return (
		<Card className="max-sm:gap-3 max-sm:py-4">
			{/* On a phone the note shares the title's line when it fits. */}
			<CardHeader className="max-sm:flex max-sm:flex-wrap max-sm:items-baseline max-sm:gap-x-3 max-sm:gap-y-1">
				<CardTitle>
					<h2>Message the client</h2>
				</CardTitle>
				{footer && <CardDescription>{footer}</CardDescription>}
			</CardHeader>
			<CardContent className="flex flex-col gap-3 sm:gap-4">
				{contact === null ? (
					<p className="text-sm text-muted-foreground">
						This client has no phone number to message.
					</p>
				) : (
					<>
						{messages.length > 1 && (
							<div>
								<Label htmlFor="message-kind" className="sr-only">
									Message
								</Label>
								<select
									id="message-kind"
									value={selected?.kind}
									onChange={(event) =>
										setKind(event.target.value as MessageKindName)
									}
									className="h-9 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm max-lg:min-h-11 sm:w-72"
								>
									{messages.map((message) => (
										<option key={message.kind} value={message.kind}>
											{message.label}
										</option>
									))}
								</select>
							</div>
						)}
						{selected ? (
							<ChatMessage
								key={selected.kind}
								message={selected}
								label={messages.length === 1 ? selected.label : undefined}
								primary={primaryChannel(lastChannel)}
								onSent={(channel) =>
									onContact({ channel, kind: selected.kind })
								}
								plain={{
									links: contact,
									onSent: (channel) => onContact({ channel }),
								}}
							/>
						) : (
							<div className="flex flex-col gap-2">
								<p className="text-sm text-muted-foreground">
									Open a chat with the client:
								</p>
								<ChatLinks
									contact={contact}
									onSent={(channel) => onContact({ channel })}
								/>
							</div>
						)}
					</>
				)}
				{onMarkContacted && (
					<div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={onMarkContacted}
						>
							Mark contacted
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
