import { router } from "@inertiajs/react";
import { useState } from "react";
import { urlFor } from "~/client";
import AdminNav from "~/components/admin_nav";
import Page from "~/components/page";
import { PilotTiles } from "~/components/pilot_metrics_card";
import Section from "~/components/section";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import AppLayout from "~/layouts/app";

type Tiles = { label: string; value: string; detail: string }[];

type Props = {
	days: number;
	fromText: string;
	toText: string;
	studios: { slug: string; name: string; tiles: Tiles }[];
	total: { count: number; tiles: Tiles };
};

/** What `metrics:pilot` prints: every live studio's pilot numbers, then all together. */
export default function AdminMetrics({
	days,
	fromText,
	toText,
	studios,
	total,
}: Props) {
	const [value, setValue] = useState(String(days));
	return (
		<Page
			title="Pilot metrics"
			description={`The last ${days} days: ${fromText} to ${toText}.`}
			actions={<AdminNav current="metrics" />}
		>
			<Section>
				<form
					className="flex flex-wrap items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						router.get(urlFor("admin.metrics"), { days: value });
					}}
				>
					<label htmlFor="metrics-days" className="flex flex-col gap-1 text-sm">
						Days to count
						<Input
							id="metrics-days"
							type="number"
							min={1}
							max={3650}
							step={1}
							value={value}
							onChange={(event) => setValue(event.target.value)}
							className="w-32"
						/>
					</label>
					<Button type="submit" className="h-11 lg:h-9">
						Show
					</Button>
				</form>
			</Section>
			<Section title={`All studios (${total.count})`}>
				<PilotTiles tiles={total.tiles} />
			</Section>
			{studios.map((studio) => (
				<Section key={studio.slug} title={`${studio.name} (${studio.slug})`}>
					<PilotTiles tiles={studio.tiles} />
				</Section>
			))}
			{studios.length === 0 && (
				<p className="text-sm text-muted-foreground">No studios yet.</p>
			)}
		</Page>
	);
}

AdminMetrics.layout = [AppLayout];
