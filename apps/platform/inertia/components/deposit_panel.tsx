import { router } from "@inertiajs/react";
import { type RefObject, useState } from "react";
import { toast } from "sonner";
import { urlFor } from "~/client";
import ChatMessage from "~/components/chat_message";
import { useDesignTaken } from "~/components/design_taken";
import DevHostWarning from "~/components/dev_host_warning";
import {
	LINK_TAKEN_CONFIRM,
	LINK_TAKEN_KEEP,
	LINK_TAKEN_QUESTION,
	newLinkQuestion,
} from "~/components/flash";
import InlineConfirm from "~/components/inline_confirm";
import {
	type ContactChannelName,
	type ContactVia,
	type PrimaryChannel,
	primaryChannel,
} from "~/components/messages";
import { cardId } from "~/components/project_page";
import type { ProjectPageProps } from "~/components/projects";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";

/**
 * The deposit link, for owners while the project waits for its deposit (TAT-65): copy it or send
 * it in a chat, read the reference code, and replace a leaked or expired link. TAT-108 draws it
 * inside the Next step card: a waiting screenshot is the Next step itself (Verify and Reject),
 * so the panel no longer points at it. A new link asks inline, never in the browser's box.
 */
export default function DepositPanel({
	projectId,
	deposit,
	primary,
	onSent,
	fallback,
}: {
	projectId: string;
	deposit: NonNullable<ProjectPageProps["deposit"]>;
	primary: PrimaryChannel;
	onSent: (channel: ContactChannelName) => void;
	fallback: RefObject<HTMLElement | null>;
}) {
	const tenant = useTenant();
	const designTaken = useDesignTaken();
	const [busy, setBusy] = useState(false);
	const { link, problem, message, devHost } = deposit;

	const issue = (finished?: () => void) =>
		router.post(
			urlFor("tenant.projects.deposit_link.store", {
				tenant: tenant.slug,
				id: projectId,
			}),
			{},
			{
				preserveScroll: true,
				onStart: () => setBusy(true),
				onFinish: () => {
					setBusy(false);
					finished?.();
				},
			},
		);
	const copy = (url: string) => {
		navigator.clipboard.writeText(url).then(
			() => toast.success("Link copied."),
			() => toast.error("Couldn't copy: select the link instead."),
		);
	};

	return (
		<div className="flex flex-col gap-4">
			{devHost && (
				<DevHostWarning>
					deposit links point at this computer, so a client can't open them.
				</DevHostWarning>
			)}
			{link?.url ? (
				<>
					<Field>
						<FieldLabel htmlFor="deposit-link">Deposit link</FieldLabel>
						<div className="flex gap-2">
							<Input
								id="deposit-link"
								readOnly
								value={link.url}
								onFocus={(event) => event.currentTarget.select()}
								className="min-w-0 flex-1"
							/>
							<Button
								type="button"
								variant="outline"
								onClick={() => copy(link.url ?? "")}
							>
								Copy link
							</Button>
						</div>
						<FieldDescription>
							Works until {link.expiresText}. The client pays with your QR codes
							and sends a screenshot there.
						</FieldDescription>
					</Field>
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
						<dt className="text-muted-foreground">Reference code</dt>
						<dd className="font-mono tracking-widest">{link.referenceCode}</dd>
					</dl>
					{message && (
						<ChatMessage message={message} primary={primary} onSent={onSent} />
					)}
				</>
			) : (
				<p className="text-sm text-muted-foreground">
					{link
						? `The link you sent no longer works. Make a new one: the reference code stays ${link.referenceCode}.`
						: "Make a link where the client pays the deposit with your QR codes and sends a screenshot."}
				</p>
			)}
			{problem ? (
				<p className="text-sm text-muted-foreground">{problem}</p>
			) : link?.url ? (
				<InlineConfirm
					label="New link"
					question={newLinkQuestion(designTaken)}
					confirmLabel="Make a new link"
					keepLabel="Keep this link"
					onConfirm={(finished) => issue(finished)}
					fallback={fallback}
				/>
			) : designTaken ? (
				// The design is claimed by another client: ask before a link is made (the
				// studio may still want to send it), in the page and not in a sheet.
				<InlineConfirm
					label={link ? "New link" : "Make deposit link"}
					variant="default"
					question={LINK_TAKEN_QUESTION}
					confirmLabel={LINK_TAKEN_CONFIRM}
					keepLabel={LINK_TAKEN_KEEP}
					onConfirm={(finished) => issue(finished)}
					fallback={fallback}
				/>
			) : (
				<div>
					<Button type="button" disabled={busy} onClick={() => issue()}>
						{busy ? "Saving…" : link ? "New link" : "Make deposit link"}
					</Button>
				</div>
			)}
		</div>
	);
}

/**
 * The Deposit card (TAT-108): the deposit panel in a card of its own, for a project that waits for
 * its deposit while the Next step card is something else (a screenshot to check, a price that
 * ended). The panel is the Next step's own when it names `deposit_link`; the old page always drew
 * it, so it is never out of reach. The card carries the `deposit` id unless the Next step does.
 */
export function DepositCard({
	projectId,
	deposit,
	lastChannel,
	onContact,
	anchor,
	fallback,
}: {
	projectId: string;
	deposit: NonNullable<ProjectPageProps["deposit"]>;
	lastChannel: ProjectPageProps["lastChannel"];
	onContact: (via: ContactVia) => void;
	anchor: string | null;
	fallback: RefObject<HTMLElement | null>;
}) {
	return (
		<Card
			id={cardId("deposit", anchor)}
			className="scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] lg:scroll-mt-0"
		>
			<CardHeader>
				<CardTitle className="leading-snug">
					<h2>Deposit</h2>
				</CardTitle>
			</CardHeader>
			<CardContent>
				<DepositPanel
					projectId={projectId}
					deposit={deposit}
					primary={primaryChannel(lastChannel)}
					onSent={(channel) => onContact({ channel, kind: "deposit_link" })}
					fallback={fallback}
				/>
			</CardContent>
		</Card>
	);
}
