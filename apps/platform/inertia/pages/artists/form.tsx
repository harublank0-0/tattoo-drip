import { Form, Link } from "@adonisjs/inertia/react";
import { useState } from "react";
import type { ArtistProps } from "~/components/artists";
import Section from "~/components/section";
import { Button, buttonVariants } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";
import { slugify } from "~/lib/slugify";

type Errors = Partial<Record<string, string>>;

/**
 * Adds an artist (`artist` is null) or edits one. `canLink` says whether
 * "This is my profile" can succeed for the signed-in owner.
 */
export default function ArtistForm({
	artist,
	canLink,
}: {
	artist: ArtistProps | null;
	canLink: boolean;
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };

	return (
		<Section title={artist ? "Edit artist" : "Add an artist"}>
			{artist ? (
				<Form
					route="tenant.artists.update"
					routeParams={{ ...params, id: artist.id }}
				>
					{({ errors, processing }) => (
						<ArtistFields
							artist={artist}
							canLink={canLink}
							errors={errors}
							processing={processing}
							tenantSlug={tenant.slug}
						/>
					)}
				</Form>
			) : (
				<Form route="tenant.artists.store" routeParams={params}>
					{({ errors, processing }) => (
						<ArtistFields
							artist={null}
							canLink={canLink}
							errors={errors}
							processing={processing}
							tenantSlug={tenant.slug}
						/>
					)}
				</Form>
			)}
		</Section>
	);
}

function ArtistFields({
	artist,
	canLink,
	errors,
	processing,
	tenantSlug,
}: {
	artist: ArtistProps | null;
	canLink: boolean;
	errors: Errors;
	processing: boolean;
	tenantSlug: string;
}) {
	const [name, setName] = useState(artist?.name ?? "");
	const [slug, setSlug] = useState(artist?.slug ?? "");
	// A new artist's link follows the name until the owner edits it; an
	// existing link never changes by itself.
	const [slugTouched, setSlugTouched] = useState(artist !== null);
	const slugChanged = artist !== null && slug !== artist.slug;

	return (
		<FieldGroup>
			<Field data-invalid={!!errors.name}>
				<FieldLabel htmlFor="name">Name</FieldLabel>
				<Input
					id="name"
					name="name"
					maxLength={120}
					autoComplete="off"
					value={name}
					onChange={(event) => {
						setName(event.target.value);
						if (!slugTouched) setSlug(slugify(event.target.value));
					}}
					aria-invalid={!!errors.name}
				/>
				{errors.name && <FieldError>{errors.name}</FieldError>}
			</Field>

			<Field data-invalid={!!errors.slug}>
				<FieldLabel htmlFor="slug">Link</FieldLabel>
				<Input
					id="slug"
					name="slug"
					autoComplete="off"
					spellCheck={false}
					value={slug}
					onChange={(event) => {
						setSlugTouched(true);
						setSlug(event.target.value);
					}}
					aria-invalid={!!errors.slug}
				/>
				<FieldDescription>
					Lowercase letters, numbers and hyphens, 2 to 63 characters. It ends
					this artist&apos;s own link.
				</FieldDescription>
				{slugChanged && (
					<FieldDescription className="text-destructive" role="status">
						Changing the link breaks the old one: anyone you already sent it to
						will no longer reach this artist.
					</FieldDescription>
				)}
				{errors.slug && <FieldError>{errors.slug}</FieldError>}
			</Field>

			<Field data-invalid={!!errors.bio}>
				<FieldLabel htmlFor="bio">Bio</FieldLabel>
				<Textarea
					id="bio"
					name="bio"
					rows={5}
					maxLength={1000}
					defaultValue={artist?.bio ?? ""}
					aria-invalid={!!errors.bio}
				/>
				{errors.bio && <FieldError>{errors.bio}</FieldError>}
			</Field>

			<Field data-invalid={!!errors.photo}>
				<FieldLabel htmlFor="photo">Photo</FieldLabel>
				{artist?.photoUrl && (
					<div className="flex flex-wrap items-center gap-4">
						<img
							src={artist.photoUrl}
							alt={`${artist.name} (current)`}
							className="size-24 rounded-md border object-cover"
						/>
						<Field orientation="horizontal" className="w-auto">
							<Checkbox id="removePhoto" name="removePhoto" />
							<FieldLabel htmlFor="removePhoto" className="font-normal">
								Remove this photo
							</FieldLabel>
						</Field>
					</div>
				)}
				<Input
					id="photo"
					name="photo"
					type="file"
					accept="image/jpeg,image/png,image/webp"
					aria-invalid={!!errors.photo}
				/>
				<FieldDescription>
					JPEG, PNG or WebP, up to 10 MB.
					{artist?.photoUrl ? " Choose a file to replace the current one." : ""}
				</FieldDescription>
				{errors.photo && <FieldError>{errors.photo}</FieldError>}
			</Field>

			<Field orientation="horizontal">
				<Checkbox
					id="visible"
					name="visible"
					defaultChecked={artist?.visible ?? true}
				/>
				<FieldContent>
					<FieldLabel htmlFor="visible">Show on the public page</FieldLabel>
					<FieldDescription>
						Uncheck to hide this artist everywhere clients can see.
					</FieldDescription>
					{errors.visible && <FieldError>{errors.visible}</FieldError>}
				</FieldContent>
			</Field>

			<Field orientation="horizontal">
				<Checkbox
					id="acceptingInquiries"
					name="acceptingInquiries"
					defaultChecked={artist?.acceptingInquiries ?? true}
				/>
				<FieldContent>
					<FieldLabel htmlFor="acceptingInquiries">
						Accepting new inquiries
					</FieldLabel>
					<FieldDescription>
						Uncheck while the books are closed: the artist stays visible, but
						clients can&apos;t send a request.
					</FieldDescription>
					{errors.acceptingInquiries && (
						<FieldError>{errors.acceptingInquiries}</FieldError>
					)}
				</FieldContent>
			</Field>

			<Field data-invalid={!!errors.closedMessage}>
				<FieldLabel htmlFor="closedMessage">Message when closed</FieldLabel>
				<Textarea
					id="closedMessage"
					name="closedMessage"
					rows={2}
					maxLength={300}
					defaultValue={artist?.closedMessage ?? ""}
					placeholder="Books reopen in May."
					aria-invalid={!!errors.closedMessage}
				/>
				<FieldDescription>
					Shown instead of the request form while inquiries are off.
				</FieldDescription>
				{errors.closedMessage && (
					<FieldError>{errors.closedMessage}</FieldError>
				)}
			</Field>

			{canLink && (
				<Field orientation="horizontal">
					<Checkbox
						id="linkToMe"
						name="linkToMe"
						defaultChecked={artist?.isMine ?? false}
					/>
					<FieldContent>
						<FieldLabel htmlFor="linkToMe">This is my profile</FieldLabel>
						<FieldDescription>
							Links the profile to your login. You can have one per studio.
						</FieldDescription>
						{errors.linkToMe && <FieldError>{errors.linkToMe}</FieldError>}
					</FieldContent>
				</Field>
			)}

			{!canLink && errors.linkToMe && (
				<Field data-invalid>
					<FieldError>{errors.linkToMe}</FieldError>
				</Field>
			)}

			<div className="flex gap-2">
				<Button type="submit" disabled={processing}>
					{processing ? "Saving…" : artist ? "Save" : "Add artist"}
				</Button>
				<Link
					route="tenant.artists"
					routeParams={{ tenant: tenantSlug }}
					className={buttonVariants({ variant: "ghost" })}
				>
					Cancel
				</Link>
			</div>
		</FieldGroup>
	);
}

ArtistForm.layout = [AppLayout, SettingsLayout];
