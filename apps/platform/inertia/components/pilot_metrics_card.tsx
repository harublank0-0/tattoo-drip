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
 * last in Today's side column (TAT-107, Studio OS): a section with a list
 * of label, value and detail, split by hairlines; text tokens only, no chart.
 */
export default function PilotMetricsCard({
	metrics,
}: {
	metrics: PilotCardProps;
}) {
	return (
		<section aria-labelledby="today-pilot" className="flex flex-col gap-3">
			<h2
				id="today-pilot"
				className="flex min-h-8 items-center text-base leading-snug font-semibold"
			>
				{metrics.title}
			</h2>
			<dl className="flex flex-col divide-y border-y">
				{metrics.tiles.map((tile) => (
					<div
						key={tile.label}
						className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 py-3"
					>
						<dt className="text-sm">{tile.label}</dt>
						<dd className="text-right text-sm font-semibold tabular-nums">
							{tile.value}
						</dd>
						<dd className="col-span-2 text-xs text-muted-foreground">
							{tile.detail}
						</dd>
					</div>
				))}
			</dl>
			{metrics.note && (
				<p className="text-xs text-muted-foreground">{metrics.note}</p>
			)}
		</section>
	);
}
