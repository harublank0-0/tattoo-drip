import { Link } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { Pencil, Plus, Trash2, User, Users } from "lucide-react";
import { urlFor } from "~/client";
import type { ArtistRowProps } from "~/components/artists";
import CopyLinkButton from "~/components/copy_link_button";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

export default function Artists({ artists }: { artists: ArtistRowProps[] }) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };
	const add = (
		<Link
			route="tenant.artists.create"
			routeParams={params}
			className={buttonVariants()}
		>
			<Plus data-icon="inline-start" />
			Add an artist
		</Link>
	);

	return (
		<Section
			title="Artists"
			description="The artists clients can book. A hidden artist doesn't show anywhere public."
		>
			{artists.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Users />
						</EmptyMedia>
						<EmptyTitle>No artists yet</EmptyTitle>
						<EmptyDescription>
							Add the artists who work here, each with their own photo, bio and
							link.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>{add}</EmptyContent>
				</Empty>
			) : (
				<div className="flex flex-col gap-3">
					<div>{add}</div>
					{artists.map((artist) => (
						<ArtistRow
							key={artist.id}
							artist={artist}
							tenantSlug={tenant.slug}
						/>
					))}
				</div>
			)}
		</Section>
	);
}

function ArtistRow({
	artist,
	tenantSlug,
}: {
	artist: ArtistRowProps;
	tenantSlug: string;
}) {
	const params = { tenant: tenantSlug, id: artist.id };

	const remove = () => {
		if (
			window.confirm(
				`Delete "${artist.name}"? Their link stops working and clients won't see them.`,
			)
		) {
			router.delete(urlFor("tenant.artists.destroy", params), {
				preserveScroll: true,
			});
		}
	};

	return (
		<div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-3">
			{artist.photoUrl ? (
				<img
					src={artist.photoUrl}
					alt={artist.name}
					loading="lazy"
					decoding="async"
					className="size-16 rounded-md border object-cover"
				/>
			) : (
				<div className="flex size-16 items-center justify-center rounded-md border bg-muted text-muted-foreground">
					<User />
				</div>
			)}
			{/* min-w-40: on narrow screens the actions wrap below instead. */}
			<div className="flex min-w-40 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-medium">{artist.name}</span>
					{artist.isMine && <Badge>You</Badge>}
					{!artist.visible && <Badge variant="secondary">Hidden</Badge>}
					{!artist.acceptingInquiries && (
						<Badge variant="outline">Not accepting inquiries</Badge>
					)}
				</div>
			</div>
			<div className="ml-auto flex items-center gap-1">
				<Link
					route="tenant.artists.edit"
					routeParams={params}
					aria-label={`Edit ${artist.name}`}
					className={buttonVariants({ variant: "ghost", size: "icon" })}
				>
					<Pencil />
				</Link>
				<Button
					variant="ghost"
					size="icon"
					aria-label={`Delete ${artist.name}`}
					onClick={remove}
				>
					<Trash2 />
				</Button>
			</div>
			{/* The artist's own page (TAT-101): shown as text to select, with Copy. */}
			<div className="flex w-full flex-wrap items-center gap-2">
				{artist.pageUrl ? (
					<>
						<p className="min-w-0 flex-1 text-sm break-all text-muted-foreground select-all">
							{artist.pageUrl}
						</p>
						<CopyLinkButton
							text={artist.pageUrl}
							variant="outline"
							className="h-11"
						/>
					</>
				) : (
					<p className="text-sm text-muted-foreground">
						Hidden: this artist has no public page.
					</p>
				)}
			</div>
		</div>
	);
}

Artists.layout = [AppLayout, SettingsLayout];
