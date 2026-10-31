import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { useEffect, useRef } from "react";
import { urlFor } from "~/client";
import {
	LOGO_FILE_HELP,
	LOGO_INTRO,
	LOGO_TILE_CLASS,
	type LogoProps,
	type LogoTile,
	logoButton,
	NO_LOGO,
	REMOVE_LOGO_QUESTION,
	takesFocusBack,
	tileButton,
	tileLine,
} from "~/components/page_look";
import { PHOTO_ACCEPT } from "~/components/photos";
import Section from "~/components/section";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";

/**
 * The studio's logo (TAT-56), on Settings, Page look, in its own form like
 * the cover: a preview on the tile clients see it on (TAT-123: the light one,
 * `bg-logo-plate`, or the dark one, `bg-logo-plate-dark`, which the server
 * picked at upload for a light logo; each is the same in both colour schemes
 * on purpose), a line saying which tile it sits on with one button to switch
 * it, an upload that replaces it and a remove. One file per upload; the server
 * stores it and answers a refused file as a field error. Removing asks with
 * the browser's dialog, like the cover (the Settings follow-up replaces both).
 */
export default function LogoForm({ logo }: { logo: LogoProps | null }) {
	const tenant = useTenant();
	const remove = () => {
		if (window.confirm(REMOVE_LOGO_QUESTION)) {
			router.delete(
				urlFor("tenant.settings.logo.destroy", { tenant: tenant.slug }),
				{ preserveScroll: true },
			);
		}
	};

	return (
		<div className="mt-8 border-t pt-6">
			<Section title="Logo" description={LOGO_INTRO}>
				<div className="flex flex-col gap-4">
					{logo ? (
						<>
							<div
								className={`inline-flex self-start rounded-md border p-1 ${LOGO_TILE_CLASS[logo.tile]}`}
							>
								<img
									src={logo.previewUrl}
									width={logo.width}
									height={logo.height}
									alt="Your current logo"
									className="h-16 w-auto max-w-48 object-contain"
								/>
							</div>
							<p className="text-sm text-muted-foreground">
								{tileLine(logo.tile)}
							</p>
							<TileForm tile={logo.tile} />
						</>
					) : (
						<p className="text-sm text-muted-foreground">{NO_LOGO}</p>
					)}

					<Form
						route="tenant.settings.logo.update"
						routeParams={{ tenant: tenant.slug }}
						options={{ preserveScroll: true, preserveState: "errors" }}
						resetOnSuccess
					>
						{({ errors, processing, progress }) => (
							<Field data-invalid={!!errors.logo}>
								<FieldLabel htmlFor="logo">Choose an image</FieldLabel>
								<Input
									id="logo"
									name="logo"
									type="file"
									accept={PHOTO_ACCEPT}
									required
									aria-invalid={!!errors.logo}
								/>
								<FieldDescription>{LOGO_FILE_HELP}</FieldDescription>
								{errors.logo && <FieldError>{errors.logo}</FieldError>}
								<Button
									type="submit"
									className="self-start"
									disabled={processing}
								>
									{logoButton(logo !== null, processing, progress?.percentage)}
								</Button>
							</Field>
						)}
					</Form>

					{logo && (
						<Button
							type="button"
							variant="outline"
							className="self-start"
							onClick={remove}
						>
							Remove logo
						</Button>
					)}
				</div>
			</Section>
		</div>
	);
}

/**
 * The tile switch: one button that puts the logo on the other tile. It is
 * disabled with "Saving…" while it saves, and when the save ends, if it had
 * focus when the save started and nothing else has focus now, it takes focus
 * back (a disabled focused button drops its focus to the page: takesFocusBack,
 * the Page look Save button's rule). The props change on success, so the line,
 * the preview and the button's words follow without a remount.
 */
function TileForm({ tile }: { tile: LogoTile }) {
	const tenant = useTenant();
	const offered: LogoTile = tile === "dark" ? "light" : "dark";

	return (
		<Form
			route="tenant.settings.logo.tile.update"
			routeParams={{ tenant: tenant.slug }}
			options={{ preserveScroll: true }}
			className="flex flex-col gap-2"
		>
			{({ errors, processing }) => (
				<>
					<input type="hidden" name="tile" value={offered} />
					<TileButton offered={offered} processing={processing} />
					{errors.tile && <FieldError>{errors.tile}</FieldError>}
				</>
			)}
		</Form>
	);
}

function TileButton({
	offered,
	processing,
}: {
	offered: LogoTile;
	processing: boolean;
}) {
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
			variant="outline"
			className="self-start"
			disabled={processing}
			onFocus={() => {
				hadFocus.current = true;
			}}
			onBlur={() => {
				hadFocus.current = false;
			}}
		>
			{tileButton(offered, processing)}
		</Button>
	);
}
