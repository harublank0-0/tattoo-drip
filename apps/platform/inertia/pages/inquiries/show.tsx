import { Form } from "@adonisjs/inertia/react";
import { Link, router } from "@inertiajs/react";
import { type ReactNode, type RefObject, useRef } from "react";
import { urlFor } from "~/client";
import InlineConfirm from "~/components/inline_confirm";
import { type InquiryPageProps, SOURCE_LABELS } from "~/components/inquiries";
import MessageCard from "~/components/message_card";
import { type ContactVia, justContacted } from "~/components/messages";
import Page from "~/components/page";
import ReferenceGrid from "~/components/references";
import StatusBadge from "~/components/status_badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/** One inquiry, exactly as the client sent it (TAT-46). Owners only. */
export default function InquiryShow({
	inquiry,
	references,
	accept,
	projectId,
	contact,
	message,
	contactedText,
	lastChannel,
}: InquiryPageProps) {
	const tenant = useTenant();
	// A decline that finishes may remove its button: focus goes to the heading.
	const heading = useRef<HTMLHeadingElement>(null);
	// The chat links record the contact in the background (TAT-52); the footer
	// says so at once (optimistic, TAT-84).
	const markContacted = (via: ContactVia = {}) =>
		router.post(
			urlFor("tenant.inbox.contacted.store", {
				tenant: tenant.slug,
				id: inquiry.id,
			}),
			via,
			{
				preserveScroll: true,
				preserveState: true,
				optimistic: () => justContacted(via),
			},
		);
	// The same link as the Message card's Call button (`contact.callUrl`), and
	// the same record of the contact.
	const phone =
		inquiry.contactPhone && contact ? (
			<PhoneLink
				phone={inquiry.contactPhone}
				callUrl={contact.callUrl}
				onCall={() => markContacted({ channel: "call" })}
			/>
		) : null;
	const details: [string, ReactNode][] = [
		["Placement", inquiry.placement],
		["Approximate size", inquiry.approximateSize],
		["Preferred dates", inquiry.preferredDates],
		["Preferred artist", inquiry.preferredArtistName ?? "Any artist"],
		["Budget", inquiry.budget],
		[
			"Found the studio through",
			SOURCE_LABELS[inquiry.source] ?? inquiry.source,
		],
		["Phone", phone],
		["Email", inquiry.contactEmail],
	];

	return (
		<Page
			title={inquiry.contactName}
			titleRef={heading}
			description={inquiry.receivedText}
			actions={
				<Link
					href={urlFor("tenant.clients.show", {
						tenant: tenant.slug,
						id: inquiry.clientId,
					})}
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					View client
				</Link>
			}
		>
			<div className="flex max-w-2xl flex-col gap-6">
				{inquiry.status !== "new" && (
					<Card>
						<CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
							<span className="flex items-center gap-2">
								<StatusBadge status={inquiry.status} />
								{inquiry.decidedOn}
							</span>
							{projectId && (
								<Link
									href={urlFor("tenant.projects.show", {
										tenant: tenant.slug,
										id: projectId,
									})}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									View project
								</Link>
							)}
						</CardContent>
					</Card>
				)}

				{/* Read first, decide last (TAT-100): the idea, then the references
				    an artist wants to see, then the details, the message and the
				    decision. */}
				<Card>
					<CardHeader>
						<CardTitle>Idea</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-sm whitespace-pre-line">{inquiry.idea}</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>References</CardTitle>
					</CardHeader>
					<CardContent>
						<ReferenceGrid references={references} />
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Details</CardTitle>
					</CardHeader>
					<CardContent>
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
							{details.map(([label, value]) => (
								<div key={label} className="contents">
									<dt className="text-muted-foreground">{label}</dt>
									<dd className="min-w-0 wrap-anywhere">{value ?? "—"}</dd>
								</div>
							))}
						</dl>
					</CardContent>
				</Card>

				<MessageCard
					contact={contact}
					messages={message ? [message] : []}
					initialKind={message?.kind ?? null}
					lastChannel={lastChannel}
					onContact={markContacted}
					footer={contactedText}
				/>

				{accept && (
					<Card>
						<CardHeader>
							<CardTitle>Decide</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<AcceptForm inquiryId={inquiry.id} accept={accept} />
							<DeclineButton inquiryId={inquiry.id} fallback={heading} />
						</CardContent>
					</Card>
				)}
			</div>
		</Page>
	);
}

/**
 * The number the client sent (E.164), as a call link (`callUrl` from the
 * server). Tapping it tells the page, which records the call like the
 * Message card's Call button does. It never wraps: a number split over two
 * lines reads as two numbers. The 44px tap target is the link's own height,
 * pulled back with a negative margin so the row keeps the height of its
 * text.
 */
function PhoneLink({
	phone,
	callUrl,
	onCall,
}: {
	phone: string;
	callUrl: string;
	onCall: () => void;
}) {
	return (
		<a
			href={callUrl}
			onClick={() => onCall()}
			className="-my-3 inline-flex min-h-11 items-center whitespace-nowrap text-foreground underline underline-offset-4"
		>
			{phone}
		</a>
	);
}

function AcceptForm({
	inquiryId,
	accept,
}: {
	inquiryId: string;
	accept: NonNullable<InquiryPageProps["accept"]>;
}) {
	const tenant = useTenant();

	return (
		<Form
			route="tenant.inbox.accept"
			routeParams={{ tenant: tenant.slug, id: inquiryId }}
		>
			{({ errors, processing }) => (
				<Field data-invalid={!!errors.artistId}>
					<FieldLabel htmlFor="artistId">Artist</FieldLabel>
					<div className="flex flex-col gap-2 sm:flex-row">
						<select
							id="artistId"
							name="artistId"
							defaultValue={accept.artistId ?? ""}
							aria-invalid={!!errors.artistId}
							className="h-11 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm sm:flex-1"
						>
							<option value="">No artist</option>
							{accept.choices.map(({ id, name }) => (
								<option key={id} value={id}>
									{name}
								</option>
							))}
						</select>
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Accept and create project"}
						</Button>
					</div>
					{errors.artistId && <FieldError>{errors.artistId}</FieldError>}
				</Field>
			)}
		</Form>
	);
}

function DeclineButton({
	inquiryId,
	fallback,
}: {
	inquiryId: string;
	fallback: RefObject<HTMLElement | null>;
}) {
	const tenant = useTenant();

	return (
		<InlineConfirm
			label="Decline"
			question="Decline this inquiry? This can't be undone."
			confirmLabel="Decline the inquiry"
			keepLabel="Keep the inquiry"
			onConfirm={(finished) =>
				router.post(
					urlFor("tenant.inbox.decline", {
						tenant: tenant.slug,
						id: inquiryId,
					}),
					{},
					{ onFinish: finished },
				)
			}
			fallback={fallback}
		/>
	);
}

InquiryShow.layout = [AppLayout];
