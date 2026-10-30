import { Form } from "@adonisjs/inertia/react";
import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useRef } from "react";
import { urlFor } from "~/client";
import ColourField from "~/components/colour_field";
import DevHostWarning from "~/components/dev_host_warning";
import LogoForm from "~/components/logo_form";
import {
	COLOUR_HELP,
	COVER_INTRO_LINE,
	canMove,
	coverLine,
	coverLink,
	DARK_COLOUR_HELP,
	FONT_SAMPLE_CLASS,
	type FontOption,
	focusAfterMove,
	type LogoProps,
	type MoveDirection,
	moveRow,
	moveSectionLabel,
	type PageLookProps,
	PREVIEW_NOTE,
	REQUIRED_SECTION,
	SECTION_WORDS,
	SECTIONS_INTRO,
	type SectionKey,
	type SectionRow,
	type Swatches,
	sectionsError,
	sentSections,
	type ThemeOption,
	takesFocusBack,
	toggleRow,
} from "~/components/page_look";
import Section from "~/components/section";
import { useStoredChoice, useStoredRows } from "~/components/stored_choice";
import type { StudioPageProps } from "~/components/studio_link";
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
	FieldTitle,
} from "~/components/ui/field";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

/**
 * Settings, Page look (TAT-56): how the studio page looks. The server sends
 * every list (themes, fonts, sections), the stored look already filtered
 * to what the page can use, and the logo's preview; this page holds only the
 * colour text while it is typed and the sections' order and visibility. Nothing here is markup or CSS: the form
 * sends keys and "#rrggbb" codes, and the server refuses the rest. Nothing is
 * keyed to the stored look (a remount drops focus): the colour boxes, the
 * radio groups and the sections list follow a changed stored value in place (`ColourField`,
 * `useStoredChoice`, `useStoredRows`: fresher data from another tab must not be sent back) and the Save button, which is
 * disabled while it saves, takes its focus back when the save ends (`SaveButton`),
 * so a keyboard user does not land on <body> after a save or a refusal.
 */
export default function PageLook({
	look,
	themes,
	fonts,
	sectionKeys,
	swatches,
	logo,
	hasCover,
	studioPage,
}: {
	look: PageLookProps;
	themes: ThemeOption[];
	fonts: FontOption[];
	sectionKeys: SectionKey[];
	swatches: Swatches;
	logo: LogoProps | null;
	hasCover: boolean;
	studioPage: StudioPageProps;
}) {
	const tenant = useTenant();
	// Each group follows the stored value in place when it changes (no keys).
	const [pickedTheme, pickTheme] = useStoredChoice(look.theme);
	const [pickedFont, pickFont] = useStoredChoice(look.font);
	const [rows, setRows] = useStoredRows(look.sections, sectionKeys);

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

									<SectionsField
										rows={rows}
										setRows={setRows}
										errors={errors}
									/>
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
 * The sections list (TAT-126): one row for each section with its words, a
 * "Show on your page" box (the form's row says "Always shown" instead) and
 * two buttons that move it a place earlier or later. Each shown row sends a
 * hidden `sections[]`, in the rows' order, which is how the server learns the
 * order and what is hidden. A moved row's node moves in the DOM and a moved
 * node loses focus, so the pressed button gets it back (`focusAfterMove`:
 * its other button when the move left the pressed one disabled at an end).
 * The error is the list's own, else the first one on an item.
 */
function SectionsField({
	rows,
	setRows,
	errors,
}: {
	rows: SectionRow[];
	setRows: (rows: SectionRow[]) => void;
	errors: Record<string, string>;
}) {
	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const refocus = useRef<{ key: SectionKey; direction: MoveDirection } | null>(
		null,
	);
	const error = sectionsError(errors);

	// After the rows have moved on screen, not before: the node is the moved one.
	useEffect(() => {
		const pending = refocus.current;
		if (!pending) return;
		refocus.current = null;
		const direction = focusAfterMove(
			rows.findIndex((row) => row.key === pending.key),
			rows.length,
			pending.direction,
		);
		buttons.current.get(`${pending.key}-${direction}`)?.focus();
	}, [rows]);

	function move(index: number, direction: MoveDirection) {
		refocus.current = { key: rows[index].key, direction };
		setRows(moveRow(rows, index, direction));
	}

	return (
		<FieldSet
			data-invalid={!!error}
			aria-describedby={
				error ? "sections-help sections-error" : "sections-help"
			}
		>
			<FieldLegend variant="label">Sections</FieldLegend>
			<FieldDescription id="sections-help">{SECTIONS_INTRO}</FieldDescription>
			<ol className="flex flex-col gap-3">
				{rows.map((row, index) => {
					const words = SECTION_WORDS[row.key];
					return (
						<li
							key={row.key}
							className="flex flex-col gap-2 rounded-lg border p-3"
						>
							<div className="flex items-start justify-between gap-3">
								<div className="flex min-w-0 flex-col gap-1">
									<p
										id={`section-${row.key}-title`}
										className="text-sm leading-snug font-medium"
									>
										{words.title}
									</p>
									<p className="text-sm text-muted-foreground">
										{words.description}
									</p>
								</div>
								<div className="flex shrink-0 gap-1">
									{(["up", "down"] as const).map((direction) => (
										<Button
											key={direction}
											ref={(node) => {
												const id = `${row.key}-${direction}`;
												if (node) buttons.current.set(id, node);
												else buttons.current.delete(id);
											}}
											type="button"
											variant="outline"
											size="icon"
											aria-label={moveSectionLabel(words.title, direction)}
											disabled={!canMove(index, rows.length, direction)}
											onClick={() => move(index, direction)}
										>
											{direction === "up" ? (
												<ArrowUp aria-hidden="true" />
											) : (
												<ArrowDown aria-hidden="true" />
											)}
										</Button>
									))}
								</div>
							</div>
							{row.key === REQUIRED_SECTION ? (
								<p className="flex min-h-11 items-center text-sm text-muted-foreground">
									Always shown
								</p>
							) : (
								<Field
									orientation="horizontal"
									className="min-h-11 items-center"
								>
									<Checkbox
										id={`section-${row.key}-shown`}
										checked={row.shown}
										onCheckedChange={(checked) =>
											setRows(toggleRow(rows, index, checked === true))
										}
										aria-labelledby={`section-${row.key}-shown-label section-${row.key}-title`}
									/>
									<FieldLabel
										id={`section-${row.key}-shown-label`}
										htmlFor={`section-${row.key}-shown`}
										className="font-normal"
									>
										Show on your page
									</FieldLabel>
								</Field>
							)}
						</li>
					);
				})}
			</ol>
			{sentSections(rows).map((key) => (
				<input key={key} type="hidden" name="sections[]" value={key} />
			))}
			{error && <FieldError id="sections-error">{error}</FieldError>}
		</FieldSet>
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
