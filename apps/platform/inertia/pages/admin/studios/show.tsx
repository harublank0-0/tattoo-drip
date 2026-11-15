import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import AdminNav from "~/components/admin_nav";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import AppLayout from "~/layouts/app";

type Takedown = { atText: string; note: string | null };

type Item = {
	kind: "review" | "reply" | "post";
	id: string;
	atText: string;
	shownName: string;
	rating: number | null;
	excerpt: string;
	takedown: (Takedown & { reason: string }) | null;
};

type Props = {
	studio: { slug: string; name: string };
	discover: {
		status: string;
		optedIn: boolean;
		publiclyVisible: boolean;
		takedown: Takedown | null;
	};
	photos: {
		id: string;
		artistName: string;
		thumbnailUrl: string;
		takedown: Takedown | null;
	}[];
	takenDown: Item[];
	live: Item[];
	reports: {
		reviewId: string;
		reportedText: string;
		reason: string;
		note: string | null;
		rating: number | null;
		shownName: string;
		body: string;
	}[];
	takedownReasons: string[];
};

/**
 * One studio's moderation state for TattooDrip staff, read-only for now.
 * Everything studio- or client-typed is plain text.
 */
export default function AdminStudio({
	studio,
	discover,
	photos,
	takenDown,
	live,
	reports,
}: Props) {
	return (
		<Page
			title={studio.name}
			description={studio.slug}
			actions={<AdminNav current="studios" />}
		>
			<Section title="Discover listing">
				<p className="flex flex-wrap items-center gap-2 text-sm">
					<Badge variant="outline">{discover.status}</Badge>
					<span>{discover.optedIn ? "Opted in" : "Not opted in"}</span>
					<span>
						{discover.publiclyVisible ? "Publicly visible" : "Not public"}
					</span>
				</p>
				{discover.takedown && (
					<p className="text-sm">
						Taken down {discover.takedown.atText}
						{discover.takedown.note ? `: ${discover.takedown.note}` : ""}
					</p>
				)}
			</Section>

			<Section title="Photos">
				{photos.length === 0 ? (
					<p className="text-sm text-muted-foreground">No work photos.</p>
				) : (
					<ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{photos.map((photo) => (
							<li key={photo.id} className="flex flex-col gap-1 text-sm">
								<img
									src={photo.thumbnailUrl}
									alt={`Work by ${photo.artistName}`}
									className="aspect-square w-full rounded-md object-cover"
								/>
								<span>{photo.artistName}</span>
								{photo.takedown && (
									<span className="text-muted-foreground">
										Taken down {photo.takedown.atText}
										{photo.takedown.note ? `: ${photo.takedown.note}` : ""}
									</span>
								)}
							</li>
						))}
					</ul>
				)}
			</Section>

			<Section title="Reviews and Fresh ink">
				<ItemList title="Taken down" items={takenDown} />
				<ItemList title="Live" items={live} />
				{live.length >= 20 && (
					<Link
						href={`${urlFor("admin.studios.show", { slug: studio.slug })}?more=1`}
						className="text-sm underline underline-offset-4"
					>
						Show more
					</Link>
				)}
			</Section>

			<Section title="Open reports">
				{reports.length === 0 ? (
					<p className="text-sm text-muted-foreground">No open reports.</p>
				) : (
					<ul className="divide-y">
						{reports.map((report) => (
							<li
								key={report.reviewId}
								className="flex flex-col gap-1 py-3 text-sm"
							>
								<span className="font-medium">
									{report.shownName}
									{report.rating !== null ? `, ${report.rating}/5` : ""}
								</span>
								<span>{report.body}</span>
								<span className="text-muted-foreground">
									Reported {report.reportedText} for {report.reason}
									{report.note ? `: ${report.note}` : ""}
								</span>
							</li>
						))}
					</ul>
				)}
			</Section>
		</Page>
	);
}

function ItemList({ title, items }: { title: string; items: Item[] }) {
	return (
		<div className="flex flex-col gap-2">
			<h3 className="text-sm font-medium">{title}</h3>
			{items.length === 0 ? (
				<p className="text-sm text-muted-foreground">None.</p>
			) : (
				<ul className="divide-y">
					{items.map((item) => (
						<li
							key={`${item.kind}-${item.id}`}
							className="flex flex-col gap-1 py-3 text-sm"
						>
							<span className="flex flex-wrap items-center gap-2">
								<Badge variant="outline">{item.kind}</Badge>
								<span className="font-medium">{item.shownName}</span>
								{item.rating !== null && <span>{item.rating}/5</span>}
								<span className="text-muted-foreground">{item.atText}</span>
							</span>
							<span>{item.excerpt}</span>
							{item.takedown && (
								<span className="text-muted-foreground">
									Taken down {item.takedown.atText} ({item.takedown.reason})
									{item.takedown.note ? `: ${item.takedown.note}` : ""}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

AdminStudio.layout = [AppLayout];
