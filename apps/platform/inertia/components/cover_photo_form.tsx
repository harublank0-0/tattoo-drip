import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { urlFor } from "~/client";
import {
	COVER_INTRO,
	COVER_PREVIEW_NOTE,
	type CoverProps,
	coverButton,
	NO_COVER,
	PHOTO_ACCEPT,
	REMOVE_COVER_QUESTION,
} from "~/components/photos";
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
 * The studio's cover photo (TAT-116), on Settings, Profile, in its own form
 * like the page link: a preview of how a phone shows it (4:3), an upload that
 * replaces it and a remove. One file per upload; the server stores it and
 * answers a refused file as a field error.
 */
export default function CoverPhotoForm({
	cover,
}: {
	cover: CoverProps | null;
}) {
	const tenant = useTenant();
	const remove = () => {
		if (window.confirm(REMOVE_COVER_QUESTION)) {
			router.delete(
				urlFor("tenant.settings.cover.destroy", { tenant: tenant.slug }),
				{ preserveScroll: true },
			);
		}
	};

	return (
		<div
			id="cover-photo"
			className="mt-8 border-t pt-6 scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] lg:scroll-mt-0"
		>
			<Section title="Cover photo" description={COVER_INTRO}>
				<div className="flex flex-col gap-4">
					{cover ? (
						<div className="flex flex-col gap-2">
							<img
								src={cover.previewUrl}
								width={cover.width}
								height={cover.height}
								alt="Your current cover"
								className="aspect-[4/3] w-full max-w-md rounded-md border object-cover"
							/>
							<p className="text-sm text-muted-foreground">
								{COVER_PREVIEW_NOTE}
							</p>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">{NO_COVER}</p>
					)}

					<Form
						route="tenant.settings.cover.update"
						routeParams={{ tenant: tenant.slug }}
						options={{ preserveScroll: true, preserveState: "errors" }}
						resetOnSuccess
					>
						{({ errors, processing, progress }) => (
							<Field data-invalid={!!errors.cover}>
								<FieldLabel htmlFor="cover">Choose a photo</FieldLabel>
								<Input
									id="cover"
									name="cover"
									type="file"
									accept={PHOTO_ACCEPT}
									required
									aria-invalid={!!errors.cover}
								/>
								<FieldDescription>
									JPEG, PNG or WebP, up to 10 MB.
								</FieldDescription>
								{errors.cover && <FieldError>{errors.cover}</FieldError>}
								<Button
									type="submit"
									className="self-start"
									disabled={processing}
								>
									{coverButton(
										cover !== null,
										processing,
										progress?.percentage,
									)}
								</Button>
							</Field>
						)}
					</Form>

					{cover && (
						<Button
							type="button"
							variant="outline"
							className="self-start"
							onClick={remove}
						>
							Remove cover
						</Button>
					)}
				</div>
			</Section>
		</div>
	);
}
