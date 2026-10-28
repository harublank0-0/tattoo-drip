import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { urlFor } from "~/client";
import {
	LOGO_FILE_HELP,
	LOGO_INTRO,
	type LogoProps,
	logoButton,
	NO_LOGO,
	REMOVE_LOGO_QUESTION,
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
 * the cover: a preview on the light tile clients see it on (`bg-logo-plate`
 * is light in both schemes on purpose), an upload that replaces it and a
 * remove. One file per upload; the server stores it and answers a refused
 * file as a field error. Removing asks with the browser's dialog, like the
 * cover (the Settings follow-up replaces both).
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
						<div className="inline-flex self-start rounded-md border bg-logo-plate p-1">
							<img
								src={logo.previewUrl}
								width={logo.width}
								height={logo.height}
								alt="Your current logo"
								className="h-16 w-auto max-w-48 object-contain"
							/>
						</div>
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
