import { Form } from "@adonisjs/inertia/react";
import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { useEffect, useRef } from "react";
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
	takesFocusBack,
} from "~/components/page_look";
import Section from "~/components/section";
import { useStoredChoice } from "~/components/stored_choice";
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
 * sends keys and "#rrggbb" codes, and the server refuses the rest. Nothing is
 * keyed to the stored look (a remount drops focus): the colour boxes and the
 * radio groups follow a changed stored value in place (`ColourField`,
 * `useStoredChoice`: fresher data from another tab must not be sent back) and the Save button, which is
 * disabled while it saves, takes its focus back when the save ends (`SaveButton`),
 * so a keyboard user does not land on <body> after a save or a refusal.
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
	// Each group follows the stored value in place when it changes (no keys).
	const [pickedTheme, pickTheme] = useStoredChoice(look.theme);
	const [pickedFont, pickFont] = useStoredChoice(look.font);
	const [pickedArtists, pickArtists] = useStoredChoice(look.artists);

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
						className={cn(buttonVariants({ variant: "outline" }), "self-start")}
					>
						Open your page
					</a>
					<p className="text-sm text-muted-foreground">{PREVIEW_NOTE}</p>
				</div>
			</Section>

			<div className="mt-6 border-t pt-6">
				<Form
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
										<RadioGroup
											name="theme"
											value={pickedTheme}
											onValueChange={pickTheme}
											aria-invalid={!!errors.theme}
											aria-describedby={
												errors.theme ? "theme-error" : undefined
											}
										>
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
										{errors.theme && (
											<FieldError id="theme-error">{errors.theme}</FieldError>
										)}
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
										<FieldDescription id="font-help">
											Your studio's name and the headings on your page.
										</FieldDescription>
										<RadioGroup
											name="font"
											value={pickedFont}
											onValueChange={pickFont}
											aria-invalid={!!errors.font}
											aria-describedby={
												errors.font ? "font-help font-error" : "font-help"
											}
										>
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
										{errors.font && (
											<FieldError id="font-error">{errors.font}</FieldError>
										)}
									</FieldSet>

									<FieldSet data-invalid={!!errors.artists}>
										<FieldLegend variant="label">Artists list</FieldLegend>
										<FieldDescription id="artists-help">
											{PLACEMENT_INTRO}
										</FieldDescription>
										<RadioGroup
											name="artists"
											value={pickedArtists}
											onValueChange={pickArtists}
											aria-invalid={!!errors.artists}
											aria-describedby={
												errors.artists
													? "artists-help artists-error"
													: "artists-help"
											}
										>
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
											<FieldError id="artists-error">
												{errors.artists}
											</FieldError>
										)}
									</FieldSet>
								</FieldGroup>
							</Section>

							<SaveButton processing={processing} />
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

/**
 * The form's Save button: disabled while it saves ("Saving…"), and when the save
 * ends, if it had focus when the save started and nothing else has focus now,
 * it takes focus back (a disabled focused button drops its focus to the page:
 * takesFocusBack). A refusal ends the same way, so the error and the button are
 * where the keyboard user is. The user may move to another field while the
 * request is pending: that field keeps its focus.
 */
function SaveButton({ processing }: { processing: boolean }) {
	const button = useRef<HTMLButtonElement>(null);
	const hadFocus = useRef(false);
	const wasProcessing = useRef(false);
	useEffect(() => {
		const active = document.activeElement;
		const otherHasFocus =
			active !== null && active !== document.body && active !== button.current;
		if (
			takesFocusBack(
				hadFocus.current,
				wasProcessing.current,
				processing,
				otherHasFocus,
			)
		) {
			button.current?.focus();
		}
		wasProcessing.current = processing;
	}, [processing]);

	return (
		<Button
			ref={button}
			type="submit"
			className="mt-6"
			disabled={processing}
			onFocus={() => {
				hadFocus.current = true;
			}}
			onBlur={() => {
				hadFocus.current = false;
			}}
		>
			{processing ? "Saving…" : "Save page look"}
		</Button>
	);
}

PageLook.layout = [AppLayout, SettingsLayout];
