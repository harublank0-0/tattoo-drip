import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { useFold } from "~/components/fold";
import {
	type ContactChannelName,
	type ContactLinksProps,
	type OtherWay,
	otherWays,
	PRIMARY_LABELS,
	type PrimaryChannel,
	tapCopy,
	tapViber,
	VIBER_HINT,
} from "~/components/messages";
import type { ChatMessageProps } from "~/components/projects";
import { Button, buttonVariants } from "~/components/ui/button";

// Compact side padding: the row has four buttons, and "Copy text" and
// "Chat without a message" share a line at 375px with it.
const WAY = cn(buttonVariants({ variant: "outline" }), "px-3");
// Full width on a phone, where the thumb needs the room; its own width from sm.
const LEAD = cn(buttonVariants({ size: "lg" }), "max-sm:w-full sm:self-start");

/**
 * Copies `text`. False where there is no clipboard (a phone on the LAN
 * opening http://192.168.x.x is not a secure context) or the write is
 * refused.
 */
async function copyText(text: string): Promise<boolean> {
	if (!navigator.clipboard) return false;
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/**
 * A chat message and its ways to send it (TAT-64, TAT-52, TAT-104): the text
 * folded to two lines, one leading button (WhatsApp, or Viber when the
 * client was last reached there), and one "Other ways" row. WhatsApp opens
 * with the text filled in; Viber's link can't carry text, so its tap copies
 * the text as the chat opens and says so once. Every tap tells the page its channel,
 * which records the contact: `onSent` for the taps that send the message
 * (the page adds its kind) and `plain.onSent` for Call and the chat without
 * a message. Without `plain` the row has no call and no plain chat: the
 * Message the client card has them.
 */
export default function ChatMessage({
	message,
	onSent,
	primary,
	label,
	plain,
}: {
	message: ChatMessageProps;
	onSent: (channel: ContactChannelName) => void;
	primary: PrimaryChannel;
	/** What the message is called, shown above the text. */
	label?: string;
	plain?: {
		links: ContactLinksProps;
		onSent: (channel: ContactChannelName) => void;
	};
}) {
	const fold = useFold(message.text);
	const { expanded, setExpanded } = fold;
	const textId = useId();

	const failed = () => {
		toast.error("Couldn't copy: select the text instead.");
		// The staff can still select it: show all of it.
		setExpanded(true);
	};
	const copyTap = () =>
		tapCopy({
			copy: () => copyText(message.text),
			done: () => toast.success("Message copied."),
			record: () => onSent("copy"),
			refused: failed,
		});
	// The anchor opens Viber by itself, in the tap: nothing here may wait for
	// the copy or cancel the click (see tapViber).
	const viberTap = () =>
		tapViber({
			copy: () => copyText(message.text),
			record: () => onSent("viber"),
			hint: () => toast.success(VIBER_HINT),
			refused: failed,
		});

	const whatsapp = (className: string, content: string) => (
		<a
			href={message.whatsappUrl}
			target="_blank"
			rel="noreferrer"
			onClick={() => onSent("whatsapp")}
			className={className}
		>
			{content}
		</a>
	);
	const viber = (className: string, content: string, note?: string) => (
		<a href={message.viberUrl} onClick={viberTap} className={className}>
			{content}
			{note && <span className="sr-only"> {note}</span>}
		</a>
	);
	const way = (item: OtherWay) => {
		switch (item.id) {
			case "whatsapp":
				return whatsapp(WAY, item.label);
			case "viber":
				return viber(WAY, item.label, "(copies the message)");
			case "copy":
				return (
					<Button
						type="button"
						variant="outline"
						className="px-3"
						onClick={copyTap}
					>
						{item.label}
					</Button>
				);
			case "call":
				return (
					plain && (
						<a
							href={plain.links.callUrl}
							onClick={() => plain.onSent(item.channel)}
							className={WAY}
						>
							{item.label}
						</a>
					)
				);
			case "chat":
				return (
					plain && (
						<a
							href={
								primary === "viber"
									? plain.links.viberUrl
									: plain.links.whatsappUrl
							}
							target={primary === "viber" ? undefined : "_blank"}
							rel={primary === "viber" ? undefined : "noreferrer"}
							onClick={() => plain.onSent(item.channel)}
							className={WAY}
						>
							{item.label}
							<span className="sr-only">
								{primary === "viber" ? " on Viber" : " on WhatsApp"}
							</span>
						</a>
					)
				);
		}
	};

	return (
		<div className="flex flex-col gap-2 sm:gap-3">
			<div className="rounded-md border px-3 py-2">
				{(label || fold.showToggle) && (
					<div className="flex items-center gap-2 sm:mb-1">
						{label && <span className="text-sm font-medium">{label}</span>}
						{fold.showToggle && (
							<Button
								ref={fold.toggleRef}
								type="button"
								variant="ghost"
								size="sm"
								aria-expanded={expanded}
								aria-controls={textId}
								onClick={() => setExpanded(!expanded)}
								className={cn(
									"max-lg:-my-2",
									label ? "-mr-3 ml-auto" : "-ml-3",
								)}
							>
								{fold.label}
								<ChevronDown
									aria-hidden
									className={cn(
										"transition-transform",
										expanded && "rotate-180",
									)}
								/>
							</Button>
						)}
					</div>
				)}
				<p
					id={textId}
					ref={fold.textRef}
					tabIndex={-1}
					className={cn(
						"text-sm leading-normal break-words whitespace-pre-line outline-none",
						fold.clamp && "line-clamp-2",
					)}
				>
					{message.text}
				</p>
			</div>
			{primary === "viber"
				? viber(LEAD, PRIMARY_LABELS.viber)
				: whatsapp(LEAD, PRIMARY_LABELS.whatsapp)}
			<fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
				<legend className="sr-only">Other ways</legend>
				<span aria-hidden className="text-sm text-muted-foreground">
					Other ways
				</span>
				{otherWays(primary, plain !== undefined).map((item) => (
					<span key={item.id} className="contents">
						{way(item)}
					</span>
				))}
			</fieldset>
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
				className={WAY}
			>
				WhatsApp
			</a>
			<a
				href={contact.viberUrl}
				onClick={() => onSent("viber")}
				className={WAY}
			>
				Viber
			</a>
			<a href={contact.callUrl} onClick={() => onSent("call")} className={WAY}>
				Call
			</a>
		</div>
	);
}
