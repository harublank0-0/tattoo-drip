import { toast } from "sonner";
import { Button } from "~/components/ui/button";

/**
 * Copies `text` exactly as given. There is no clipboard outside a secure
 * context (a phone on the LAN opening http://192.168.x.x): the failure toast
 * says to select the text instead, so the text near the button must be
 * selectable.
 */
export default function CopyLinkButton({
	text,
	label = "Copy link",
	variant = "default",
	className,
	copiedText = "Link copied.",
	failedText = "Couldn't copy: select the link instead.",
	onCopied,
}: {
	text: string;
	label?: string;
	variant?: "default" | "outline";
	className?: string;
	/** The toast once copied. */
	copiedText?: string;
	/** The toast when there is no clipboard: what to select instead. */
	failedText?: string;
	/** Called once the text is on the clipboard (a review request records its contact). */
	onCopied?: () => void;
}) {
	const copy = () => {
		const failed = () => toast.error(failedText);
		if (!navigator.clipboard) return failed();
		navigator.clipboard.writeText(text).then(() => {
			toast.success(copiedText);
			onCopied?.();
		}, failed);
	};

	return (
		<Button
			type="button"
			variant={variant}
			className={className}
			onClick={copy}
		>
			{label}
		</Button>
	);
}
