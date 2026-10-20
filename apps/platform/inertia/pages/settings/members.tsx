import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { cn } from "cn";
import { urlFor } from "~/client";
import CopyLinkButton from "~/components/copy_link_button";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type Role = "owner" | "artist";

type MemberRow = {
	id: string;
	name: string | null;
	email: string;
	role: Role;
	isYou: boolean;
};

type InvitationRow = {
	id: string;
	email: string;
	role: Role;
	profileName: string | null;
	expired: boolean;
	expiresText: string;
};

type NewLink = {
	email: string;
	url: string;
	message: string;
	whatsappUrl: string;
	expiresText: string;
};

const ROLE_LABELS: Record<Role, string> = { owner: "Owner", artist: "Artist" };

const ROLE_COPY: Record<Role, string> = {
	artist: "Their own profile, and the projects and sessions assigned to them.",
	owner: "Everything in the studio, including payments and settings.",
};

/**
 * Settings, Members (TAT-33): who is in the studio, the invitations waiting,
 * and a way to invite someone. A new link shows once, at the top.
 */
export default function Members({
	members,
	invitations,
	profiles,
	newLink,
}: {
	members: MemberRow[];
	invitations: InvitationRow[];
	profiles: { id: string; name: string }[];
	newLink: NewLink | null;
}) {
	const tenant = useTenant();

	return (
		<>
			{newLink && <NewLinkBox link={newLink} />}

			<Section
				title="Invite someone"
				description="They join with an account that uses this address. You send them the link yourself."
			>
				<Form
					route="tenant.settings.members.invitations.store"
					routeParams={{ tenant: tenant.slug }}
					resetOnSuccess
				>
					{({ errors, processing }) => (
						<FieldGroup>
							<Field data-invalid={!!errors.email}>
								<FieldLabel htmlFor="invite-email">Email</FieldLabel>
								<Input
									id="invite-email"
									name="email"
									type="email"
									autoComplete="off"
									className="h-11"
									aria-invalid={!!errors.email}
								/>
								{errors.email && <FieldError>{errors.email}</FieldError>}
							</Field>

							<FieldSet data-invalid={!!errors.role}>
								<FieldLegend variant="label">Role</FieldLegend>
								<RadioGroup name="role" defaultValue="artist">
									{(["artist", "owner"] as const).map((role) => (
										<FieldLabel key={role} htmlFor={`role-${role}`}>
											<Field orientation="horizontal">
												<FieldContent>
													<FieldTitle>{ROLE_LABELS[role]}</FieldTitle>
													<FieldDescription>{ROLE_COPY[role]}</FieldDescription>
												</FieldContent>
												<RadioGroupItem
													value={role}
													id={`role-${role}`}
													aria-invalid={!!errors.role}
												/>
											</Field>
										</FieldLabel>
									))}
								</RadioGroup>
								{errors.role && <FieldError>{errors.role}</FieldError>}
							</FieldSet>

							{profiles.length > 0 && (
								<Field data-invalid={!!errors.artistId}>
									<FieldLabel htmlFor="invite-profile">
										Artist profile
									</FieldLabel>
									<select
										id="invite-profile"
										name="artistId"
										defaultValue=""
										className="h-11 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm"
										aria-invalid={!!errors.artistId}
									>
										<option value="">None</option>
										{profiles.map(({ id, name }) => (
											<option key={id} value={id}>
												{name}
											</option>
										))}
									</select>
									<FieldDescription>
										Gives them this profile, with its projects and sessions.
									</FieldDescription>
									{errors.artistId && (
										<FieldError>{errors.artistId}</FieldError>
									)}
								</Field>
							)}

							<div>
								<Button type="submit" className="h-11" disabled={processing}>
									{processing ? "Creating…" : "Create invitation link"}
								</Button>
							</div>
						</FieldGroup>
					)}
				</Form>
			</Section>

			<Section title="Members">
				<ul className="flex flex-col gap-2">
					{members.map((member) => (
						<MemberItem
							key={member.id}
							member={member}
							studio={tenant.name}
							tenantSlug={tenant.slug}
						/>
					))}
				</ul>
			</Section>

			<Section title="Invitations">
				{invitations.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No invitations waiting.
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{invitations.map((invitation) => (
							<InvitationItem
								key={invitation.id}
								invitation={invitation}
								tenantSlug={tenant.slug}
							/>
						))}
					</ul>
				)}
			</Section>
		</>
	);
}

function NewLinkBox({ link }: { link: NewLink }) {
	return (
		<Section title={`Invitation link for ${link.email}`}>
			<div className="flex flex-col gap-3 rounded-lg border p-3">
				<div className="flex flex-wrap gap-2">
					<Input
						aria-label="Invitation link"
						readOnly
						value={link.url}
						onFocus={(event) => event.currentTarget.select()}
						className="h-11 min-w-0 flex-1"
					/>
					<CopyLinkButton text={link.url} variant="outline" className="h-11" />
				</div>
				<a
					href={link.whatsappUrl}
					target="_blank"
					rel="noopener noreferrer"
					className={cn(buttonVariants(), "h-11 self-start")}
				>
					Share on WhatsApp
				</a>
				<p className="text-sm text-muted-foreground">
					Send it to them yourself, on WhatsApp, Viber or any chat. It works
					once, until {link.expiresText}, and only for an account with{" "}
					<span className="break-words">{link.email}</span>. You won't see this
					link again: if you lose it, make a new one below.
				</p>
			</div>
		</Section>
	);
}

function MemberItem({
	member,
	studio,
	tenantSlug,
}: {
	member: MemberRow;
	studio: string;
	tenantSlug: string;
}) {
	const params = { tenant: tenantSlug, id: member.id };
	const label = member.name ?? member.email;
	const next: Role = member.role === "owner" ? "artist" : "owner";

	const change = () => {
		const question =
			next === "owner"
				? `Make ${label} an owner? Owners can do everything in the studio, including payments and settings.`
				: `Make ${label} an artist? They keep their own profile and assigned projects, and lose everything else.`;
		if (window.confirm(question)) {
			router.put(
				urlFor("tenant.settings.members.role.update", params),
				{ role: next },
				{ preserveScroll: true },
			);
		}
	};
	const remove = () => {
		if (
			window.confirm(
				`Remove ${label}? They lose access to ${studio} at once. Their artist profile stays with the studio, unlinked.`,
			)
		) {
			router.delete(urlFor("tenant.settings.members.destroy", params), {
				preserveScroll: true,
			});
		}
	};

	return (
		<li className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
			{/* min-w-40: on narrow screens the buttons wrap below instead. */}
			<div className="flex min-w-40 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-medium break-words">{label}</span>
					<Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
					{member.isYou && <Badge variant="outline">You</Badge>}
				</div>
				{member.name && (
					<p className="text-sm break-words text-muted-foreground">
						{member.email}
					</p>
				)}
			</div>
			{!member.isYou && (
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						className="h-11"
						onClick={change}
					>
						{next === "owner" ? "Make owner" : "Make artist"}
					</Button>
					<Button
						type="button"
						variant="ghost"
						className="h-11"
						onClick={remove}
					>
						Remove
					</Button>
				</div>
			)}
		</li>
	);
}

function InvitationItem({
	invitation,
	tenantSlug,
}: {
	invitation: InvitationRow;
	tenantSlug: string;
}) {
	const params = { tenant: tenantSlug, id: invitation.id };

	// No preserveScroll on a new link: the page opens at the top, where it shows.
	const renew = () => {
		if (
			window.confirm(
				`Make a new link for ${invitation.email}? The link you sent before stops working.`,
			)
		) {
			router.post(
				urlFor("tenant.settings.members.invitations.renew", params),
				{},
			);
		}
	};
	const cancel = () => {
		if (
			window.confirm(
				`Cancel the invitation for ${invitation.email}? Its link stops working.`,
			)
		) {
			router.delete(
				urlFor("tenant.settings.members.invitations.destroy", params),
				{ preserveScroll: true },
			);
		}
	};
	const details = [
		ROLE_LABELS[invitation.role],
		invitation.profileName ? `profile "${invitation.profileName}"` : null,
		invitation.expired
			? `Expired ${invitation.expiresText}`
			: `Works until ${invitation.expiresText}`,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<li className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
			<div className="flex min-w-40 flex-1 flex-col gap-1">
				<span className="font-medium break-words">{invitation.email}</span>
				<p className="text-sm text-muted-foreground">{details}</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					className="h-11"
					onClick={renew}
				>
					New link
				</Button>
				<Button type="button" variant="ghost" className="h-11" onClick={cancel}>
					Cancel invitation
				</Button>
			</div>
		</li>
	);
}

Members.layout = [AppLayout, SettingsLayout];
