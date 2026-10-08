import { Form } from "@adonisjs/inertia/react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import AuthLayout from "~/layouts/auth";

/**
 * Wording for each tenant type. The values themselves come from the
 * server, so a new type still shows up (with its raw value) until it's
 * given copy here.
 */
const TYPE_COPY: Record<string, { title: string; description: string }> = {
	studio: {
		title: "Studio",
		description: "A shop with one or more artists.",
	},
	independent: {
		title: "Independent artist",
		description: "Just you, working on your own.",
	},
};

/**
 * Turns a business name into a subdomain-safe slug: lowercase letters,
 * digits and single hyphens, at most 63 characters.
 */
function slugify(name: string) {
	return name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 63)
		.replace(/-+$/, "");
}

export default function CreateTenant({
	tenantTypes,
	timezones,
	defaultTimezone,
}: {
	tenantTypes: string[];
	timezones: string[];
	defaultTimezone: string;
}) {
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	// The slug follows the name until the user edits it themselves.
	const [slugTouched, setSlugTouched] = useState(false);

	return (
		<>
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					Set up your business
				</h1>
				<p className="text-sm text-muted-foreground">
					Clients will find you at your own address. You can change the details
					later.
				</p>
			</div>

			<Form route="onboarding.store">
				{({ errors, processing }) => (
					<FieldGroup>
						<Field data-invalid={!!errors.name}>
							<FieldLabel htmlFor="name">Business name</FieldLabel>
							<Input
								id="name"
								name="name"
								type="text"
								autoComplete="organization"
								placeholder="Black Needle Tattoo"
								value={name}
								onChange={(event) => {
									setName(event.target.value);
									if (!slugTouched) setSlug(slugify(event.target.value));
								}}
								aria-invalid={!!errors.name}
							/>
							{errors.name && <FieldError>{errors.name}</FieldError>}
						</Field>

						<FieldSet data-invalid={!!errors.type}>
							<FieldLegend variant="label">
								What are you setting up?
							</FieldLegend>
							<RadioGroup name="type" defaultValue={tenantTypes[0]}>
								{tenantTypes.map((value) => {
									const type = {
										value,
										...(TYPE_COPY[value] ?? { title: value, description: "" }),
									};
									return (
										<FieldLabel key={type.value} htmlFor={`type-${type.value}`}>
											<Field orientation="horizontal">
												<FieldContent>
													<FieldTitle>{type.title}</FieldTitle>
													<FieldDescription>
														{type.description}
													</FieldDescription>
												</FieldContent>
												<RadioGroupItem
													value={type.value}
													id={`type-${type.value}`}
													aria-invalid={!!errors.type}
												/>
											</Field>
										</FieldLabel>
									);
								})}
							</RadioGroup>
							{errors.type && <FieldError>{errors.type}</FieldError>}
						</FieldSet>

						<Field data-invalid={!!errors.slug}>
							<FieldLabel htmlFor="slug">Your address</FieldLabel>
							<div className="flex items-center gap-2">
								<Input
									id="slug"
									name="slug"
									type="text"
									autoComplete="off"
									spellCheck={false}
									placeholder="black-needle"
									value={slug}
									onChange={(event) => {
										setSlugTouched(true);
										setSlug(event.target.value);
									}}
									aria-invalid={!!errors.slug}
									aria-describedby="slug-preview"
								/>
								<span className="shrink-0 text-sm text-muted-foreground">
									.tattoodrip.com
								</span>
							</div>
							<FieldDescription id="slug-preview">
								Lowercase letters, numbers and hyphens, 3 to 63 characters.
							</FieldDescription>
							{errors.slug && <FieldError>{errors.slug}</FieldError>}
						</Field>

						<Field data-invalid={!!errors.timezone}>
							<FieldLabel htmlFor="timezone">Time zone</FieldLabel>
							<Select name="timezone" defaultValue={defaultTimezone}>
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

						<Button type="submit" disabled={processing}>
							{processing ? "One moment…" : "Create"}
						</Button>
					</FieldGroup>
				)}
			</Form>
		</>
	);
}

CreateTenant.layout = [AuthLayout];
