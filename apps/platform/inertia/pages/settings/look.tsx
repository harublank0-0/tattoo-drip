import { Form } from "@adonisjs/inertia/react";
import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { urlFor } from "~/client";
import ColourField from "~/components/colour_field";
import DevHostWarning from "~/components/dev_host_warning";
import LogoForm from "~/components/logo_form";
import {
	COLOUR_HELP,
	COVER_INTRO_LINE,
	coverLine,
	coverLink,
	DARK_COLOUR_HELP,
	FONT_SAMPLE_CLASS,
	type FontOption,
	type LogoProps,
	type PageLookProps,
	PLACEMENT_INTRO,
	PLACEMENT_WORDS,
	type PlacementKey,
	PREVIEW_NOTE,
	type Swatches,
	type ThemeOption,
} from "~/components/page_look";
import Section from "~/components/section";
import type { StudioPageProps } from "~/components/studio_link";
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
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

/**
 * Settings, Page look (TAT-56): how the studio page looks. The server sends
 * every list (themes, fonts, placements), the stored look already filtered
 * to what the page can use, and the logo's preview; this page holds only the
 * colour text while it is typed. Nothing here is markup or CSS: the form
 * sends keys and "#rrggbb" codes, and the server refuses the rest.
 */
export default function PageLook({
	look,
	themes,
	fonts,
	placements,
	swatches,
	logo,
	hasCover,
	studioPage,
}: {
	look: PageLookProps;
	themes: ThemeOption[];
	fonts: FontOption[];
	placements: PlacementKey[];
	swatches: Swatches;
	logo: LogoProps | null;
	hasCover: boolean;
	studioPage: StudioPageProps;
}) {
	const tenant = useTenant();

	return (
		<>
			<Section
				title="Your page"
				description="See your studio page as clients see it."
			>
				<div className="flex flex-col gap-3">
					{studioPage.devHost && (
						<DevHostWarning>
							your studio page link points at this computer, so a client can't
							open it.
						</DevHostWarning>
					)}
					<a
						href={studioPage.url}
						target="_blank"
						rel="noreferrer"
						className={cn(
							buttonVariants({ variant: "outline" }),
							"h-11 self-start",
						)}
					>
						Open your page
					</a>
					<p className="text-sm text-muted-foreground">{PREVIEW_NOTE}</p>
				</div>
			</Section>

			<div className="mt-6 border-t pt-6">
				<Form
					key={JSON.stringify(look)}
					route="tenant.settings.look.update"
					routeParams={{ tenant: tenant.slug }}
					options={{ preserveScroll: true }}
				>
					{({ errors, processing }) => (
						<>
							<Section title="Look">
								<FieldGroup>
									<FieldSet data-invalid={!!errors.theme}>
										<FieldLegend variant="label">Theme</FieldLegend>
										<RadioGroup name="theme" defaultValue={look.theme}>
											{themes.map((theme) => (
												<FieldLabel
													key={theme.key}
													htmlFor={`theme-${theme.key}`}
												>
													<Field orientation="horizontal">
														<FieldContent>
															<FieldTitle>{theme.label}</FieldTitle>
															<FieldDescription>
																{theme.description}
															</FieldDescription>
														</FieldContent>
														<RadioGroupItem
															value={theme.key}
															id={`theme-${theme.key}`}
															aria-invalid={!!errors.theme}
														/>
													</Field>
												</FieldLabel>
											))}
										</RadioGroup>
										{errors.theme && <FieldError>{errors.theme}</FieldError>}
									</FieldSet>

									<ColourField
										name="accent"
										label="Your colour"
										pickLabel="Pick your colour"
										description={COLOUR_HELP}
										defaultValue={look.accent ?? ""}
										fallback={swatches.light}
										error={errors.accent}
									/>
									<ColourField
										name="accentDark"
										label="Colour in dark mode (optional)"
										pickLabel="Pick the dark mode colour"
										description={DARK_COLOUR_HELP}
										defaultValue={look.accentDark ?? ""}
										fallback={swatches.dark}
										error={errors.accentDark}
									/>

									<FieldSet data-invalid={!!errors.font}>
										<FieldLegend variant="label">Heading font</FieldLegend>
										<FieldDescription>
											Your studio's name and the headings on your page.
										</FieldDescription>
										<RadioGroup name="font" defaultValue={look.font}>
											{fonts.map((font) => (
												<FieldLabel key={font.key} htmlFor={`font-${font.key}`}>
													<Field orientation="horizontal">
														<FieldContent>
															<FieldTitle
																dir="auto"
																className={cn(
																	"wrap-anywhere text-lg leading-[1.35]",
																	FONT_SAMPLE_CLASS[font.key],
																)}
															>
																{tenant.name}
															</FieldTitle>
															<FieldDescription>{font.label}</FieldDescription>
														</FieldContent>
														<RadioGroupItem
															value={font.key}
															id={`font-${font.key}`}
															aria-invalid={!!errors.font}
														/>
													</Field>
												</FieldLabel>
											))}
										</RadioGroup>
										{errors.font && <FieldError>{errors.font}</FieldError>}
									</FieldSet>

									<FieldSet data-invalid={!!errors.artists}>
										<FieldLegend variant="label">Artists list</FieldLegend>
										<FieldDescription>{PLACEMENT_INTRO}</FieldDescription>
										<RadioGroup name="artists" defaultValue={look.artists}>
											{placements.map((placement) => (
												<FieldLabel
													key={placement}
													htmlFor={`artists-${placement}`}
												>
													<Field orientation="horizontal">
														<FieldContent>
															<FieldTitle>
																{PLACEMENT_WORDS[placement].title}
															</FieldTitle>
															{PLACEMENT_WORDS[placement].description && (
																<FieldDescription>
																	{PLACEMENT_WORDS[placement].description}
																</FieldDescription>
															)}
														</FieldContent>
														<RadioGroupItem
															value={placement}
															id={`artists-${placement}`}
															aria-invalid={!!errors.artists}
														/>
													</Field>
												</FieldLabel>
											))}
										</RadioGroup>
										{errors.artists && (
											<FieldError>{errors.artists}</FieldError>
										)}
									</FieldSet>
								</FieldGroup>
							</Section>

							<Button type="submit" className="mt-6" disabled={processing}>
								{processing ? "Saving…" : "Save page look"}
							</Button>
						</>
					)}
				</Form>
			</div>

			<LogoForm logo={logo} />

			<div className="mt-8 border-t pt-6">
				<Section title="Cover photo" description={COVER_INTRO_LINE}>
					<div className="flex flex-col gap-1">
						<p className="text-sm">{coverLine(hasCover)}</p>
						<Link
							href={`${urlFor("tenant.settings.profile", { tenant: tenant.slug })}#cover-photo`}
							className={cn(
								buttonVariants({ variant: "link" }),
								"-my-3 flex min-h-11 items-center self-start px-0",
							)}
						>
							{coverLink(hasCover)}
						</Link>
					</div>
				</Section>
			</div>
		</>
	);
}

PageLook.layout = [AppLayout, SettingsLayout];
