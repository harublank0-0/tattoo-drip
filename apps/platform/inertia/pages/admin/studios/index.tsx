import { Link } from "@inertiajs/react";
import { useState } from "react";
import { urlFor } from "~/client";
import AdminNav from "~/components/admin_nav";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import AppLayout from "~/layouts/app";

type Props = {
	studios: {
		slug: string;
		name: string;
		type: "studio" | "independent";
		discoverStatus: string;
		takenDown: boolean;
		openReports: number;
	}[];
};

/** Every live studio, for TattooDrip staff: find one, open its moderation page. */
export default function AdminStudios({ studios }: Props) {
	const [filter, setFilter] = useState("");
	const needle = filter.trim().toLowerCase();
	const shown = studios.filter(
		(studio) =>
			!needle ||
			studio.name.toLowerCase().includes(needle) ||
			studio.slug.toLowerCase().includes(needle),
	);
	return (
		<Page
			title="Studios"
			description="Every live studio, oldest first."
			actions={<AdminNav current="studios" />}
		>
			<Section>
				<Input
					type="search"
					aria-label="Filter studios"
					placeholder="Filter by name or link"
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					className="max-w-sm"
				/>
				{shown.length === 0 ? (
					<p className="text-sm text-muted-foreground">No studio matches.</p>
				) : (
					<ul className="divide-y">
						{shown.map((studio) => (
							<li
								key={studio.slug}
								className="flex flex-wrap items-center gap-2 py-3 text-sm"
							>
								<Link
									href={urlFor("admin.studios.show", { slug: studio.slug })}
									className="font-medium underline-offset-4 hover:underline"
								>
									{studio.name}
								</Link>
								<span className="text-muted-foreground">{studio.slug}</span>
								<Badge variant="outline">{studio.type}</Badge>
								<Badge variant="outline">
									Discover: {studio.discoverStatus}
								</Badge>
								{studio.takenDown && (
									<Badge variant="outline">Taken down</Badge>
								)}
								{studio.openReports > 0 && (
									<Badge variant="secondary">
										{studio.openReports} open{" "}
										{studio.openReports === 1 ? "report" : "reports"}
									</Badge>
								)}
							</li>
						))}
					</ul>
				)}
			</Section>
		</Page>
	);
}

AdminStudios.layout = [AppLayout];
