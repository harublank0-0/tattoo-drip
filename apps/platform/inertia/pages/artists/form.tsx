import { Form, Link } from "@adonisjs/inertia/react";
import { useState } from "react";
import type { ArtistProps, StyleOption } from "~/components/artists";
import {
	FLASH_CREATE_NOTE,
	FLASH_OPEN_HELP,
	FLASH_OPEN_LABEL,
	type FlashDesignProps,
	flashIntro,
} from "~/components/flash";
import FlashTray from "~/components/flash_tray";
import {
	TRAY_CREATE_NOTE,
	trayIntro,
	type WorkPhotoProps,
} from "~/components/photos";
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
	FieldLegend,
	FieldSet,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import WorkPhotoTray from "~/components/work_photo_tray";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";
import { slugify } from "~/lib/slugify";

type Errors = Partial<Record<string, string>>;

const SOCIAL_LINKS = [
	{ name: "instagramUrl", label: "Instagram link" },
	{ name: "facebookUrl", label: "Facebook link" },
	{ name: "tiktokUrl", label: "TikTok link" },
] as const;

/**
 * Adds an artist (`artist` is null) or edits one. `canLink` says whether
 * "This is my profile" can succeed for the signed-in owner; an artist on
 * their own profile (TAT-30) never gets it, and their Cancel goes to
 * Projects.
 */
export default function ArtistForm({
	artist,
	canLink,
	workPhotos,
	flashDesigns,
	styleOptions,
}: {
	artist: ArtistProps | null;
	canLink: boolean;
	workPhotos: WorkPhotoProps[];
	flashDesigns: FlashDesignProps[];
	styleOptions: StyleOption[];
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };
	const owner = tenant.role === "owner";

	return (
		<>
			<Section
				title={owner ? (artist ? "Edit artist" : "Add an artist") : "Profile"}
			>
				{artist ? (
					// An artist's save redirects back to this same page, and Inertia
					// keeps a same-page form's state after a non-GET visit: the chosen
					// photo would stay in the file input and ride along on every later
					// save (silently winning over "Remove this photo"). Keep the state
					// only when the save failed, so the form is fresh after a success.
					<Form
						route="tenant.artists.update"
						routeParams={{ ...params, id: artist.id }}
						options={{ preserveState: "errors" }}
					>
						{({ errors, processing }) => (
							<ArtistFields
								artist={artist}
								canLink={canLink}
								errors={errors}
								owner={owner}
								processing={processing}
								styleOptions={styleOptions}
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
								owner={owner}
								processing={processing}
								styleOptions={styleOptions}
								tenantSlug={tenant.slug}
							/>
						)}
					</Form>
				)}
			</Section>

			{/* Outside the profile's <Form>: forms can't nest, and a photo is
			    saved by its own request (TAT-116). */}
			<Section
				title="Work photos"
				description={artist ? trayIntro(owner) : undefined}
			>
				{artist ? (
					<WorkPhotoTray
						tenantSlug={tenant.slug}
						artistId={artist.id}
						photos={workPhotos}
						styleOptions={styleOptions}
					/>
				) : (
					<p className="text-sm text-muted-foreground">{TRAY_CREATE_NOTE}</p>
				)}
			</Section>

			{/* Flash designs (TAT-129): also outside the profile's <Form>, each
			    design is saved by its own request. */}
			<Section
				title="Flash"
				description={artist ? flashIntro(owner) : undefined}
			>
				{artist ? (
					<FlashTray
						tenantSlug={tenant.slug}
						artistId={artist.id}
						designs={flashDesigns}
					/>
				) : (
					<p className="text-sm text-muted-foreground">{FLASH_CREATE_NOTE}</p>
				)}
			</Section>
		</>
	);
}

function ArtistFields({
	artist,
	canLink,
	errors,
	owner,
	processing,
	styleOptions,
	tenantSlug,
}: {
	artist: ArtistProps | null;
	canLink: boolean;
	errors: Errors;
	owner: boolean;
	processing: boolean;
	styleOptions: StyleOption[];
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
					className="h-11"
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
					className="h-11"
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

			<FieldSet data-invalid={!!errors.styles}>
				<FieldLegend variant="label">Styles</FieldLegend>
				<FieldDescription>Pick up to 5.</FieldDescription>
				<div className="grid gap-x-6 sm:grid-cols-2">
					{styleOptions.map((style) => (
						<Field
							key={style.slug}
							orientation="horizontal"
							className="min-h-11 items-center"
						>
							<Checkbox
								id={`style-${style.slug}`}
								name="styles[]"
								value={style.slug}
								defaultChecked={artist?.styles.includes(style.slug) ?? false}
							/>
							<FieldLabel
								htmlFor={`style-${style.slug}`}
								className="font-normal"
							>
								{style.name}
							</FieldLabel>
						</Field>
					))}
				</div>
				{errors.styles && <FieldError>{errors.styles}</FieldError>}
			</FieldSet>

			{SOCIAL_LINKS.map((link) => (
				<Field key={link.name} data-invalid={!!errors[link.name]}>
					<FieldLabel htmlFor={link.name}>{link.label}</FieldLabel>
					<Input
						id={link.name}
						name={link.name}
						className="h-11"
						type="url"
						inputMode="url"
						autoComplete="off"
						placeholder="https://"
						defaultValue={artist?.[link.name] ?? ""}
						aria-invalid={!!errors[link.name]}
					/>
					{errors[link.name] && <FieldError>{errors[link.name]}</FieldError>}
				</Field>
			))}

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
					className="h-11"
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

			<Field orientation="horizontal">
				<Checkbox
					id="acceptingFlash"
					name="acceptingFlash"
					defaultChecked={artist?.acceptingFlash ?? true}
				/>
				<FieldContent>
					<FieldLabel htmlFor="acceptingFlash">{FLASH_OPEN_LABEL}</FieldLabel>
					<FieldDescription>{FLASH_OPEN_HELP}</FieldDescription>
					{errors.acceptingFlash && (
						<FieldError>{errors.acceptingFlash}</FieldError>
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
				<Button type="submit" className="h-11" disabled={processing}>
					{processing ? "Saving…" : artist ? "Save" : "Add artist"}
				</Button>
				<Link
					route={owner ? "tenant.artists" : "tenant.projects.index"}
					routeParams={{ tenant: tenantSlug }}
					className={buttonVariants({
						variant: "ghost",
						className: "h-11",
					})}
				>
					Cancel
				</Link>
			</div>
		</FieldGroup>
	);
}

ArtistForm.layout = [AppLayout, SettingsLayout];
