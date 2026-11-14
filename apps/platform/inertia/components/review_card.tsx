import { router } from "@inertiajs/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { urlFor } from "~/client";
import ChatMessage from "~/components/chat_message";
import CopyLinkButton from "~/components/copy_link_button";
import DevHostWarning from "~/components/dev_host_warning";
import InlineConfirm from "~/components/inline_confirm";
import {
	type ContactChannelName,
	type ContactVia,
	primaryChannel,
} from "~/components/messages";
import {
	ASK_INTRO,
	linkDatesText,
	REVOKE_QUESTION,
	type ReviewPanelProps,
} from "~/components/reviews";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";

/**
 * "Ask for a review" (Reviews and Fresh ink, slice 2, ruling 3): on a project whose tattoo work is
 * done, for owners and the project's artist. Before a link exists one button makes it; then the
 * link (selectable, Copy link), when it was sent, made and works until, the review request in the
 * studio's words with the chat links (TAT-52's message block; every tap records the contact as a
 * review request), and Revoke, which asks inline. After a revoke the button makes a new link.
 */
export default function ReviewCard({
	projectId,
	review,
	lastChannel,
	onContact,
	fallback,
}: {
	projectId: string;
	review: ReviewPanelProps;
	lastChannel: ContactChannelName | null;
	onContact: (via: ContactVia) => void;
	fallback: RefObject<HTMLElement | null>;
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug, id: projectId };
	const [busy, setBusy] = useState(false);
	// A second click in the same frame sends nothing.
	const sending = useRef(false);
	const { link, lastText, text, message, devHost } = review;
	// The button that made the link is gone once it is there: focus moves to the link.
	const asked = useRef(false);
	const linkInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (link && asked.current) {
			asked.current = false;
			linkInput.current?.focus();
		}
	}, [link]);

	const ask = () => {
		if (sending.current) return;
		sending.current = true;
		asked.current = true;
		router.post(
			urlFor("tenant.projects.review_link.store", params),
			{},
			{
				preserveScroll: true,
				onStart: () => setBusy(true),
				onFinish: () => {
					sending.current = false;
					setBusy(false);
				},
			},
		);
	};
	const revoke = (finished: () => void) =>
		router.delete(urlFor("tenant.projects.review_link.destroy", params), {
			preserveScroll: true,
			onFinish: finished,
		});

	return (
		<Card
			id="review"
			className="scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)]"
		>
			<CardHeader>
				<CardTitle className="leading-snug">
					<h2>Ask for a review</h2>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{devHost && (
					<DevHostWarning>
						review links point at this computer, so a client can't open them.
					</DevHostWarning>
				)}
				{link ? (
					<>
						<Field>
							<FieldLabel htmlFor="review-link">Review link</FieldLabel>
							<div className="flex gap-2">
								<Input
									ref={linkInput}
									id="review-link"
									readOnly
									value={link.url}
									onFocus={(event) => event.currentTarget.select()}
									className="min-w-0 flex-1"
									aria-describedby="review-link-dates"
								/>
								<CopyLinkButton text={link.url} variant="outline" />
							</div>
							<FieldDescription id="review-link-dates">
								{linkDatesText(link)}
							</FieldDescription>
						</Field>
						{message ? (
							<ChatMessage
								message={message}
								label="Review request"
								primary={primaryChannel(lastChannel)}
								onSent={(channel) =>
									onContact({ channel, kind: "review_request" })
								}
							/>
						) : text ? (
							<div className="flex flex-col gap-2">
								<p className="text-sm text-muted-foreground">
									This client has no phone number. Copy the message and send it
									another way:
								</p>
								<p className="rounded-md bg-muted/50 p-3 text-sm whitespace-pre-line wrap-anywhere">
									{text}
								</p>
								<div>
									<CopyLinkButton
										text={text}
										label="Copy message"
										copiedText="Message copied."
										variant="outline"
										onCopied={() =>
											onContact({ channel: "copy", kind: "review_request" })
										}
									/>
								</div>
							</div>
						) : null}
						<InlineConfirm
							label="Revoke link"
							question={REVOKE_QUESTION}
							confirmLabel="Revoke link"
							keepLabel="Keep the link"
							busyLabel="Revoking…"
							onConfirm={revoke}
							fallback={fallback}
						/>
					</>
				) : (
					<>
						<p className="text-sm text-muted-foreground">
							{lastText ? `${lastText} ` : ""}
							{ASK_INTRO}
						</p>
						<div>
							<Button type="button" disabled={busy} onClick={ask}>
								{busy
									? "Saving…"
									: lastText
										? "Make a new link"
										: "Ask for a review"}
							</Button>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}
