import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

/** The card's props: #modules/reports/pilot_metrics's PilotCard, worded by the server. */
export type PilotCardProps = {
	title: string;
	tiles: { label: string; value: string; detail: string }[];
	note: string | null;
};

/**
 * The studio's pilot numbers for the last 30 days (TAT-70): how much new
 * work comes through the intake link, how long an inquiry takes to become
 * a verified deposit, and how many clients miss their session. Owners only,
 * at the bottom of Today (TAT-107).
 */
export default function PilotMetricsCard({
	metrics,
}: {
	metrics: PilotCardProps;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{metrics.title}</h2>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<dl className="grid gap-4 sm:grid-cols-3">
					{metrics.tiles.map((tile) => (
						<div
							key={tile.label}
							className="flex flex-col gap-1 border-t pt-4 first:border-t-0 first:pt-0 sm:border-t-0 sm:pt-0"
						>
							<dt className="text-sm text-muted-foreground">{tile.label}</dt>
							<dd className="text-2xl font-semibold">{tile.value}</dd>
							<dd className="text-sm text-muted-foreground">{tile.detail}</dd>
						</div>
					))}
				</dl>
				{metrics.note && (
					<p className="text-sm text-muted-foreground">{metrics.note}</p>
				)}
			</CardContent>
		</Card>
	);
}
