import { Form } from "@adonisjs/inertia/react";
import { Link, router } from "@inertiajs/react";
import { urlFor } from "~/client";
import { type InquiryPageProps, SOURCE_LABELS } from "~/components/inquiries";
import Page from "~/components/page";
import ReferenceGrid from "~/components/references";
import { Badge } from "~/components/ui/badge";
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
}: InquiryPageProps) {
	const tenant = useTenant();
	const details: [string, string | null][] = [
		["Placement", inquiry.placement],
		["Approximate size", inquiry.approximateSize],
		["Preferred dates", inquiry.preferredDates],
		["Preferred artist", inquiry.preferredArtistName ?? "Any artist"],
		["Budget", inquiry.budget],
		[
			"Found the studio through",
			SOURCE_LABELS[inquiry.source] ?? inquiry.source,
		],
		["Phone", inquiry.contactPhone],
		["Email", inquiry.contactEmail],
	];

	return (
		<Page
			title={inquiry.contactName}
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
				{accept && (
					<Card>
						<CardHeader>
							<CardTitle>Decide</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<AcceptForm inquiryId={inquiry.id} accept={accept} />
							<DeclineButton inquiryId={inquiry.id} />
						</CardContent>
					</Card>
				)}

				{inquiry.status !== "new" && (
					<Card>
						<CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
							<span className="flex items-center gap-2">
								<Badge variant="secondary">
									{inquiry.status === "accepted" ? "Accepted" : "Declined"}
								</Badge>
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

				<Card>
					<CardHeader>
						<CardTitle>Idea</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<p className="text-sm whitespace-pre-line">{inquiry.idea}</p>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
							{details.map(([label, value]) => (
								<div key={label} className="contents">
									<dt className="text-muted-foreground">{label}</dt>
									<dd className="min-w-0 break-words">{value ?? "—"}</dd>
								</div>
							))}
						</dl>
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
			</div>
		</Page>
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
					<div className="flex flex-wrap gap-2">
						<select
							id="artistId"
							name="artistId"
							defaultValue={accept.artistId ?? ""}
							aria-invalid={!!errors.artistId}
							className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm"
						>
							<option value="">No artist</option>
							{accept.choices.map(({ id, name }) => (
								<option key={id} value={id}>
									{name}
								</option>
							))}
						</select>
						<Button type="submit" disabled={processing}>
							{processing ? "Saving…" : "Accept and create project"}
						</Button>
					</div>
					{errors.artistId && <FieldError>{errors.artistId}</FieldError>}
				</Field>
			)}
		</Form>
	);
}

function DeclineButton({ inquiryId }: { inquiryId: string }) {
	const tenant = useTenant();
	const decline = () => {
		if (!window.confirm("Decline this inquiry? This can't be undone.")) return;
		router.post(
			urlFor("tenant.inbox.decline", { tenant: tenant.slug, id: inquiryId }),
		);
	};

	return (
		<div>
			<Button type="button" variant="outline" onClick={decline}>
				Decline
			</Button>
		</div>
	);
}

InquiryShow.layout = [AppLayout];
