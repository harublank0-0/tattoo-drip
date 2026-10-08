import { Form } from "@adonisjs/inertia/react";
import Section from "~/components/section";
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
}: {
	profile: Profile;
	timezones: string[];
}) {
	const tenant = useTenant();

	return (
		<Form
			route="tenant.settings.profile.update"
			routeParams={{ tenant: tenant.slug }}
		>
			{({ errors, processing }) => (
				<>
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
								{errors.timezone && <FieldError>{errors.timezone}</FieldError>}
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
	);
}

StudioProfile.layout = [AppLayout, SettingsLayout];
