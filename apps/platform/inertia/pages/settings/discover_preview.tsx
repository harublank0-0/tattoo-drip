import { Link } from "@adonisjs/inertia/react";
import { cn } from "cn";
import { ArrowLeft, ExternalLink, Eye } from "lucide-react";
import {
	BOOK_LABEL,
	type BusinessType,
	type DiscoverStatus,
	discoverAddressLine,
	locationLine,
	NO_CITY,
	NO_COVER,
	NO_LOGO,
	NO_PREVIEW_ARTISTS,
	NO_PREVIEW_PHOTOS,
	noIntro,
	noStyles,
	PREVIEW_BACK,
	PREVIEW_BANNER,
	PREVIEW_PHOTO_LIMIT,
	pageLinkLabel,
	previewStatusLine,
	statusTone,
	TONE_CLASS,
	workHeading,
} from "~/components/discover";
import { LOGO_TILE_CLASS } from "~/components/page_look";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type ShownImage = {
	url: string;
	width: number;
	height: number;
	variants: { url: string; width: number }[];
};
type Style = { slug: string; name: string };
type Preview = {
	type: BusinessType;
	name: string;
	slug: string;
	intro: string | null;
	location: { name: string; region: string | null; countryCode: string } | null;
	logo: (ShownImage & { tile: "light" | "dark" }) | null;
	cover: ShownImage | null;
	styles: Style[];
	artists: {
		id: string;
		name: string;
		slug: string;
		styles: Style[];
		photo: ShownImage | null;
	}[];
	tattoos: { id: string; alt: string | null; image: ShownImage }[];
	storefrontUrl: string;
	bookingUrl: string;
	discoverUrl: string | null;
};

/** Every copy for `srcset`, the stored image last. */
function srcSet(image: ShownImage): string {
	return [
		...image.variants.map(({ url, width }) => `${url} ${width}w`),
		`${image.url} ${image.width}w`,
	].join(", ");
}

/** A quiet stand-in where the listing has nothing yet, saying what to add. */
function Missing({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<p
			className={cn(
				"rounded-md border border-dashed p-3 text-sm text-muted-foreground",
				className,
			)}
		>
			{children}
		</p>
	);
}

/**
 * Settings, Discover preview (Discover D04): what Discover would show for
 * the business, listed or not, from the server's preview (Discover's own
 * rules: shown artists, published photos not taken down). Clearly marked
 * as a preview: Discover isn't online yet, and nothing here says it is.
 */
export default function DiscoverPreview({
	status,
	preview,
}: {
	status: { key: DiscoverStatus; label: string };
	preview: Preview;
}) {
	const tenant = useTenant();
	const type = preview.type;
	const tone = statusTone(status.key);
	const place = locationLine(preview.location);
	const photos = preview.tattoos.slice(0, PREVIEW_PHOTO_LIMIT);

	return (
		<div className="flex flex-col gap-6">
			<Link
				route="tenant.settings.discover"
				routeParams={{ tenant: tenant.slug }}
				className="-my-3 flex min-h-11 items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft aria-hidden="true" className="size-4" />
				{PREVIEW_BACK}
			</Link>

			<div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
				<p className="flex items-start gap-2 text-sm">
					<Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
					{PREVIEW_BANNER}
				</p>
				<Badge
					variant={tone === "danger" ? "destructive" : "ghost"}
					className={cn(
						"shrink-0",
						tone !== "danger" && [
							"ring-1 ring-current/20 ring-inset",
							TONE_CLASS[tone],
						],
					)}
				>
					{previewStatusLine(status.label)}
				</Badge>
			</div>

			<article
				aria-label={`Preview of ${preview.name}`}
				className="@container overflow-hidden rounded-lg border"
			>
				{preview.cover ? (
					<img
						src={preview.cover.url}
						srcSet={srcSet(preview.cover)}
						sizes="(min-width: 1024px) 48rem, 100vw"
						width={preview.cover.width}
						height={preview.cover.height}
						alt=""
						className="aspect-[3/1] w-full bg-muted object-cover"
					/>
				) : (
					<div className="flex aspect-[3/1] w-full items-center justify-center bg-muted p-4 text-center text-sm text-muted-foreground">
						{NO_COVER}
					</div>
				)}

				<div className="flex flex-col gap-6 p-4 sm:p-6">
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-3">
							{preview.logo ? (
								<div
									className={cn(
										"flex size-16 shrink-0 items-center justify-center rounded-md border p-1",
										LOGO_TILE_CLASS[preview.logo.tile],
									)}
								>
									<img
										src={preview.logo.url}
										width={preview.logo.width}
										height={preview.logo.height}
										alt={`${preview.name} logo`}
										className="max-h-full max-w-full object-contain"
									/>
								</div>
							) : (
								<div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-dashed p-1 text-center text-xs text-muted-foreground">
									{NO_LOGO}
								</div>
							)}
							<div className="flex min-w-0 flex-col gap-0.5">
								<h2
									className="text-xl leading-snug font-semibold wrap-anywhere"
									dir="auto"
								>
									{preview.name}
								</h2>
								{place ? (
									<p className="text-sm text-muted-foreground">{place}</p>
								) : (
									<p className="text-sm text-muted-foreground italic">
										{NO_CITY}
									</p>
								)}
							</div>
						</div>

						{preview.intro ? (
							<p
								className="text-sm whitespace-pre-line wrap-anywhere"
								dir="auto"
							>
								{preview.intro}
							</p>
						) : (
							<Missing>{noIntro(type)}</Missing>
						)}

						{preview.styles.length > 0 ? (
							<ul className="flex flex-wrap gap-1.5" aria-label="Styles">
								{preview.styles.map((style) => (
									<li key={style.slug}>
										<Badge variant="outline">{style.name}</Badge>
									</li>
								))}
							</ul>
						) : (
							<Missing>{noStyles(type)}</Missing>
						)}

						<div className="flex flex-wrap gap-2">
							<a
								href={preview.bookingUrl}
								target="_blank"
								rel="noreferrer"
								className={buttonVariants()}
							>
								{BOOK_LABEL}
								<ExternalLink aria-hidden="true" data-icon="inline-end" />
								<span className="sr-only">(opens in a new tab)</span>
							</a>
							<a
								href={preview.storefrontUrl}
								target="_blank"
								rel="noreferrer"
								className={buttonVariants({ variant: "outline" })}
							>
								{pageLinkLabel(type)}
								<ExternalLink aria-hidden="true" data-icon="inline-end" />
								<span className="sr-only">(opens in a new tab)</span>
							</a>
						</div>
					</div>

					{type === "studio" && (
						<section className="flex flex-col gap-3">
							<h3 className="text-sm font-semibold">Artists</h3>
							{preview.artists.length > 0 ? (
								<ul className="grid grid-cols-1 gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
									{preview.artists.map((artist) => (
										<li
											key={artist.id}
											className="flex min-w-0 items-center gap-3 rounded-md border p-2"
										>
											{artist.photo ? (
												<img
													src={artist.photo.url}
													srcSet={srcSet(artist.photo)}
													sizes="3rem"
													width={artist.photo.width}
													height={artist.photo.height}
													loading="lazy"
													alt=""
													className="size-12 shrink-0 rounded-full bg-muted object-cover"
												/>
											) : (
												<span
													aria-hidden="true"
													className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
												>
													{artist.name.trim().charAt(0).toUpperCase()}
												</span>
											)}
											<div className="flex min-w-0 flex-col">
												<span
													className="text-sm font-medium wrap-anywhere"
													dir="auto"
												>
													{artist.name}
												</span>
												{artist.styles.length > 0 && (
													<span className="text-xs text-muted-foreground">
														{artist.styles.map(({ name }) => name).join(", ")}
													</span>
												)}
											</div>
										</li>
									))}
								</ul>
							) : (
								<Missing>{NO_PREVIEW_ARTISTS}</Missing>
							)}
						</section>
					)}

					<section className="flex flex-col gap-3">
						<h3 className="text-sm font-semibold">
							Work
							{photos.length > 0 && (
								<span className="ml-2 font-normal text-muted-foreground tabular-nums">
									{workHeading(photos.length)}
								</span>
							)}
						</h3>
						{photos.length > 0 ? (
							<ul className="grid grid-cols-2 gap-2 @md:grid-cols-3 @2xl:grid-cols-4">
								{photos.map((photo) => (
									<li key={photo.id}>
										<img
											src={photo.image.url}
											srcSet={srcSet(photo.image)}
											sizes="(min-width: 1024px) 12rem, 50vw"
											width={photo.image.width}
											height={photo.image.height}
											loading="lazy"
											alt={photo.alt ?? "Tattoo"}
											className="aspect-square w-full rounded-md bg-muted object-cover"
										/>
									</li>
								))}
							</ul>
						) : (
							<Missing>{NO_PREVIEW_PHOTOS}</Missing>
						)}
					</section>
				</div>
			</article>

			<p className="text-sm text-muted-foreground wrap-anywhere">
				{discoverAddressLine(preview.discoverUrl)}
			</p>
		</div>
	);
}

DiscoverPreview.layout = [AppLayout, SettingsLayout];
