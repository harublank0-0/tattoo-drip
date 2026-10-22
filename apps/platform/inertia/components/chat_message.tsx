import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import {
	type MouseEvent,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import {
	type ContactChannelName,
	type ContactLinksProps,
	foldToggle,
	type OtherWay,
	otherWays,
	PRIMARY_LABELS,
	type PrimaryChannel,
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
 * the text first and says so once. Every tap tells the page its channel,
 * which records the contact: `onSent` for the taps that send the message
 * (the page adds its kind) and `plain.onSent` for Call and the chat without
 * a message. Without `plain` the row has no call and no plain chat: the
 * Message the client card has them.
 */
export default function ChatMessage({
	message,
	onSent,
	primary = "whatsapp",
	label,
	plain,
}: {
	message: ChatMessageProps;
	onSent: (channel: ContactChannelName) => void;
	primary?: PrimaryChannel;
	/** What the message is called, shown above the text. */
	label?: string;
	plain?: {
		links: ContactLinksProps;
		onSent: (channel: ContactChannelName) => void;
	};
}) {
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const text = useRef<HTMLParagraphElement>(null);
	const textId = useId();
	const fold = foldToggle(expanded, overflows);

	// Only the folded text can be measured: open, it shows everything.
	useLayoutEffect(() => {
		const element = text.current;
		if (!element || expanded) return;
		const measure = () =>
			setOverflows(element.scrollHeight > element.clientHeight + 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [expanded]);

	const failed = () => {
		toast.error("Couldn't copy: select the text instead.");
		// The staff can still select it: show all of it.
		setExpanded(true);
	};
	const copyTap = async () => {
		if (await copyText(message.text)) {
			toast.success("Message copied.");
			onSent("copy");
		} else {
			failed();
		}
	};
	// Copy first, then open: the chat opens empty, and by then the text is on
	// the clipboard. A refused copy still opens the chat (the old link did
	// too), with the text unfolded to select.
	const openViber = async (event: MouseEvent<HTMLAnchorElement>) => {
		event.preventDefault();
		if (await copyText(message.text)) {
			toast.success(VIBER_HINT);
		} else {
			failed();
		}
		onSent("viber");
		window.location.assign(message.viberUrl);
	};

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
		<a href={message.viberUrl} onClick={openViber} className={className}>
			{content}
			{note && <span className="sr-only"> {note}</span>}
		</a>
	);
	const way = (item: OtherWay) => {
		switch (item.id) {
			case "whatsapp":
				return whatsapp(WAY, item.label);
			case "viber":
				return viber(WAY, item.label, "(copies the message first)");
			case "copy":
				return (
					<Button type="button" variant="outline" onClick={copyTap}>
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
					ref={text}
					className={cn(
						"text-sm leading-normal break-words whitespace-pre-line",
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
