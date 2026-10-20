import { Form } from "@adonisjs/inertia/react";
import Section from "~/components/section";
import type { AddressHost, StudioPageProps } from "~/components/studio_link";
import StudioLinkCard from "~/components/studio_link_card";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type Profile = {
	name: string;
	timezone: string;
	intro: string | null;
	contactPhone: string | null;
	contactEmail: string | null;
	address: string | null;
	instagramUrl: string | null;
	facebookUrl: string | null;
	tiktokUrl: string | null;
	websiteUrl: string | null;
};

const SOCIAL_LINKS = [
	{
		name: "instagramUrl",
		label: "Instagram",
		placeholder: "https://instagram.com/yourstudio",
	},
	{
		name: "facebookUrl",
		label: "Facebook",
		placeholder: "https://facebook.com/yourstudio",
	},
	{
		name: "tiktokUrl",
		label: "TikTok",
		placeholder: "https://tiktok.com/@yourstudio",
	},
	{
		name: "websiteUrl",
		label: "Website",
		placeholder: "https://yourstudio.com",
	},
] as const;

export default function StudioProfile({
	profile,
	timezones,
	studioPage,
	addressHost,
}: {
	profile: Profile;
	timezones: string[];
	studioPage: StudioPageProps;
	addressHost: AddressHost;
}) {
	const tenant = useTenant();

	return (
		<>
			<Form
				route="tenant.settings.profile.update"
				routeParams={{ tenant: tenant.slug }}
			>
				{({ errors, processing }) => (
					<>
						<Section
							title="Your studio page"
							description="The link clients use to send you their idea. Put it in your Instagram bio."
						>
							<StudioLinkCard studioPage={studioPage} />
						</Section>

						<Section title="Business">
							<FieldGroup>
								<Field data-invalid={!!errors.name}>
									<FieldLabel htmlFor="name">Business name</FieldLabel>
									<Input
										id="name"
										name="name"
										autoComplete="organization"
										defaultValue={profile.name}
										aria-invalid={!!errors.name}
									/>
									{errors.name && <FieldError>{errors.name}</FieldError>}
								</Field>

								<Field data-invalid={!!errors.timezone}>
									<FieldLabel htmlFor="timezone">Time zone</FieldLabel>
									<Select name="timezone" defaultValue={profile.timezone}>
										<SelectTrigger
											id="timezone"
											className="w-full"
											aria-invalid={!!errors.timezone}
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{timezones.map((zone) => (
												<SelectItem key={zone} value={zone}>
													{zone.replaceAll("_", " ")}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FieldDescription>
										Session times and reminders use this time zone.
									</FieldDescription>
									{errors.timezone && (
										<FieldError>{errors.timezone}</FieldError>
									)}
								</Field>

								<Field data-invalid={!!errors.intro}>
									<FieldLabel htmlFor="intro">Intro</FieldLabel>
									<Textarea
										id="intro"
										name="intro"
										rows={4}
										maxLength={1000}
										defaultValue={profile.intro ?? ""}
										placeholder="What you tattoo, and what clients can expect."
										aria-invalid={!!errors.intro}
									/>
									<FieldDescription>
										Shown on your booking page. Up to 1000 characters.
									</FieldDescription>
									{errors.intro && <FieldError>{errors.intro}</FieldError>}
								</Field>
							</FieldGroup>
						</Section>

						<Section
							title="Contact"
							description="Shown on your booking page so clients can reach you."
						>
							<FieldGroup>
								<Field data-invalid={!!errors.contactPhone}>
									<FieldLabel htmlFor="contactPhone">Phone</FieldLabel>
									<Input
										id="contactPhone"
										name="contactPhone"
										type="tel"
										autoComplete="tel"
										defaultValue={profile.contactPhone ?? ""}
										placeholder="98XXXXXXXX"
										aria-invalid={!!errors.contactPhone}
									/>
									<FieldDescription>
										Nepali numbers don&apos;t need +977.
									</FieldDescription>
									{errors.contactPhone && (
										<FieldError>{errors.contactPhone}</FieldError>
									)}
								</Field>

								<Field data-invalid={!!errors.contactEmail}>
									<FieldLabel htmlFor="contactEmail">Email</FieldLabel>
									<Input
										id="contactEmail"
										name="contactEmail"
										type="email"
										autoComplete="email"
										defaultValue={profile.contactEmail ?? ""}
										aria-invalid={!!errors.contactEmail}
									/>
									{errors.contactEmail && (
										<FieldError>{errors.contactEmail}</FieldError>
									)}
								</Field>

								<Field data-invalid={!!errors.address}>
									<FieldLabel htmlFor="address">Address</FieldLabel>
									<Textarea
										id="address"
										name="address"
										rows={2}
										maxLength={300}
										autoComplete="street-address"
										defaultValue={profile.address ?? ""}
										aria-invalid={!!errors.address}
									/>
									{errors.address && <FieldError>{errors.address}</FieldError>}
								</Field>
							</FieldGroup>
						</Section>

						<Section title="Social links">
							<FieldGroup>
								{SOCIAL_LINKS.map((link) => (
									<Field key={link.name} data-invalid={!!errors[link.name]}>
										<FieldLabel htmlFor={link.name}>{link.label}</FieldLabel>
										<Input
											id={link.name}
											name={link.name}
											type="url"
											defaultValue={profile[link.name] ?? ""}
											placeholder={link.placeholder}
											aria-invalid={!!errors[link.name]}
										/>
										{errors[link.name] && (
											<FieldError>{errors[link.name]}</FieldError>
										)}
									</Field>
								))}
							</FieldGroup>
						</Section>

						<Button type="submit" className="mt-6" disabled={processing}>
							{processing ? "Saving…" : "Save profile"}
						</Button>
					</>
				)}
			</Form>
			<WebAddress addressHost={addressHost} />
		</>
	);
}

/**
 * The page link, in its own form: a change moves every link to the new
 * name, and the old one keeps redirecting. Keyed by the slug, so the
 * field shows the stored name again after a change.
 */
function WebAddress({ addressHost }: { addressHost: AddressHost }) {
	const tenant = useTenant();

	return (
		<div className="mt-8 border-t pt-6">
			<Form
				key={tenant.slug}
				route="tenant.settings.slug.update"
				routeParams={{ tenant: tenant.slug }}
			>
				{({ errors, processing }) => (
					<Section
						title="Page link"
						description="The name in your page link. If you change it, old links keep working and the old name stays yours."
					>
						<Field data-invalid={!!errors.slug}>
							<FieldLabel htmlFor="slug">Your page link</FieldLabel>
							<div className="flex items-center gap-2">
								{addressHost.prefix && (
									<span className="shrink-0 text-sm text-muted-foreground">
										{addressHost.prefix}
									</span>
								)}
								<Input
									id="slug"
									name="slug"
									type="text"
									autoComplete="off"
									spellCheck={false}
									defaultValue={tenant.slug}
									aria-invalid={!!errors.slug}
									aria-describedby="slug-hint"
								/>
								<span className="shrink-0 text-sm text-muted-foreground">
									{addressHost.suffix}
								</span>
							</div>
							<FieldDescription id="slug-hint">
								Lowercase letters, numbers and single hyphens, 3 to 63
								characters.
							</FieldDescription>
							{errors.slug && <FieldError>{errors.slug}</FieldError>}
						</Field>
						<Button
							type="submit"
							variant="outline"
							className="mt-4"
							disabled={processing}
						>
							{processing ? "Changing…" : "Change page link"}
						</Button>
					</Section>
				)}
			</Form>
		</div>
	);
}

StudioProfile.layout = [AppLayout, SettingsLayout];
