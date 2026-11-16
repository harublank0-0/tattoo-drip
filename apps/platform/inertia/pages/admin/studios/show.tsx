import { Form } from "@adonisjs/inertia/react";
import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import {
	KeepItUp,
	LiftItemTakedown,
	type ReasonOption,
	ReviewTakedownForm,
} from "~/components/admin_moderation";
import AdminNav from "~/components/admin_nav";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import AppLayout from "~/layouts/app";

type Takedown = { atText: string; note: string | null };

type Item = {
	kind: "review" | "reply" | "post";
	kindLabel: string;
	id: string;
	atText: string;
	shownName: string;
	rating: number | null;
	excerpt: string;
	takedown: (Takedown & { reasonLabel: string }) | null;
};

/** One pilot grant as the Package section lists it (dates in UTC). */
type GrantRow = {
	packageName: string;
	untilText: string;
	note: string;
	grantedBy: string | null;
	grantedText: string;
};

type Props = {
	studio: { slug: string; name: string };
	pilot: {
		/** The package and its state, in the Billing page's words. */
		stateText: string;
		running: GrantRow | null;
		/** Ended grants, newest first. */
		past: GrantRow[];
		packages: { value: string; label: string }[];
	};
	discover: {
		statusLabel: string;
		optedIn: boolean;
		publiclyVisible: boolean;
		takedown: Takedown | null;
	};
	photos: {
		id: string;
		artistName: string;
		kind: "photo" | "video";
		/** Null while a video has no poster; `placeholder` says why. */
		thumbnailUrl: string | null;
		placeholder: string | null;
		takedown: Takedown | null;
	}[];
	takenDown: Item[];
	live: Item[];
	/** More live items exist than are listed. */
	hasMore: boolean;
	/** The ?more=1 view cut the list. */
	truncated: boolean;
	reports: {
		reviewId: string;
		reportedText: string;
		reason: string;
		reasonLabel: string;
		note: string | null;
		rating: number | null;
		shownName: string;
		body: string;
	}[];
	takedownReasons: ReasonOption[];
};

/**
 * One studio's moderation state for TattooDrip staff, with the Discover
 * takedown actions.
 * Everything studio- or client-typed is plain text.
 */
export default function AdminStudio({
	studio,
	pilot,
	discover,
	photos,
	takenDown,
	live,
	hasMore,
	truncated,
	reports,
	takedownReasons,
}: Props) {
	return (
		<Page
			title={studio.name}
			description={studio.slug}
			actions={<AdminNav current="studios" />}
		>
			<Section title="Package">
				<p className="text-sm">
					<Badge variant="outline">{pilot.stateText}</Badge>
				</p>
				{pilot.running ? (
					<div className="flex flex-col gap-2 text-sm">
						<GrantLine grant={pilot.running} />
						<Form
							route="admin.studios.pilot.end"
							routeParams={{ slug: studio.slug }}
						>
							{({ processing }) => (
								<Button
									type="submit"
									variant="outline"
									className="h-11"
									disabled={processing}
								>
									{processing ? "Saving…" : "End grant now"}
								</Button>
							)}
						</Form>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						No pilot grant running.
					</p>
				)}
				<PilotGrantForm slug={studio.slug} packages={pilot.packages} />
				{pilot.past.length > 0 && (
					<div className="flex flex-col gap-2">
						<h3 className="text-sm font-medium">Past grants</h3>
						<ul className="divide-y text-sm">
							{pilot.past.map((grant) => (
								<li key={grant.grantedText} className="py-2">
									<GrantLine grant={grant} />
								</li>
							))}
						</ul>
					</div>
				)}
			</Section>

			<Section title="Discover listing">
				<p className="flex flex-wrap items-center gap-2 text-sm">
					<Badge variant="outline">{discover.statusLabel}</Badge>
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
				{discover.takedown ? (
					<LiftTakedown target={{ slug: studio.slug }} />
				) : (
					<TakedownForm target={{ slug: studio.slug }} />
				)}
			</Section>

			<Section title="Photos">
				{photos.length === 0 ? (
					<p className="text-sm text-muted-foreground">No work photos.</p>
				) : (
					<ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{photos.map((photo) => (
							<li key={photo.id} className="flex flex-col gap-1 text-sm">
								{photo.thumbnailUrl ? (
									<img
										src={photo.thumbnailUrl}
										alt={`${photo.kind === "video" ? "Video" : "Work"} by ${photo.artistName}`}
										loading="lazy"
										className="aspect-square w-full rounded-md object-cover"
									/>
								) : (
									<div className="flex aspect-square w-full items-center justify-center rounded-md bg-muted text-muted-foreground">
										{photo.placeholder}
									</div>
								)}
								<span>{photo.artistName}</span>
								{photo.takedown && (
									<span className="text-muted-foreground">
										Taken down {photo.takedown.atText}
										{photo.takedown.note ? `: ${photo.takedown.note}` : ""}
									</span>
								)}
								{photo.takedown ? (
									<LiftTakedown
										target={{ slug: studio.slug, photo: photo.id }}
									/>
								) : (
									<TakedownForm
										target={{ slug: studio.slug, photo: photo.id }}
									/>
								)}
							</li>
						))}
					</ul>
				)}
			</Section>

			<Section title="Reviews and Fresh ink">
				<ItemList
					title="Taken down"
					items={takenDown}
					reasons={takedownReasons}
				/>
				<ItemList title="Live" items={live} reasons={takedownReasons} />
				{hasMore && (
					<Link
						href={`${urlFor("admin.studios.show", { slug: studio.slug })}?more=1`}
						className="text-sm underline underline-offset-4"
					>
						Show more
					</Link>
				)}
				{truncated && (
					<p className="text-sm text-muted-foreground">
						Showing the 200 most recent.
					</p>
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
									Reported {report.reportedText} for {report.reasonLabel}
									{report.note ? `: ${report.note}` : ""}
								</span>
								<ReviewTakedownForm
									kind="review"
									id={report.reviewId}
									idPrefix={`report-${report.reviewId}`}
									reasons={takedownReasons}
									defaultReason={report.reason}
								/>
								<KeepItUp reviewId={report.reviewId} />
							</li>
						))}
					</ul>
				)}
			</Section>
		</Page>
	);
}

/** A grant's package, end, note and who gave it; the note is plain text. */
function GrantLine({ grant }: { grant: GrantRow }) {
	return (
		<span className="flex flex-col gap-1">
			<span className="font-medium">
				{grant.packageName} until {grant.untilText} (00:00 UTC)
			</span>
			<span>{grant.note}</span>
			<span className="text-muted-foreground">
				Granted {grant.grantedBy ? `by ${grant.grantedBy} ` : ""}on{" "}
				{grant.grantedText}
			</span>
		</span>
	);
}

/** Gives the studio a pilot grant; a running one ends when this starts. */
function PilotGrantForm({
	slug,
	packages,
}: {
	slug: string;
	packages: { value: string; label: string }[];
}) {
	return (
		<Form
			errorBag="pilot"
			route="admin.studios.pilot.grant"
			routeParams={{ slug }}
			className="flex flex-col gap-3"
		>
			{({ errors, processing }) => (
				<>
					<h3 className="text-sm font-medium">Give a pilot grant</h3>
					<label
						htmlFor="pilot-package"
						className="flex flex-col gap-2 text-sm font-medium"
					>
						Package
						<select
							id="pilot-package"
							name="package"
							required
							defaultValue={packages[0]?.value}
							className="min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm lg:min-h-9"
							aria-invalid={!!errors.package}
						>
							{packages.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					{errors.package && (
						<p className="text-sm text-destructive">{errors.package}</p>
					)}
					<label
						htmlFor="pilot-until"
						className="flex flex-col gap-2 text-sm font-medium"
					>
						Until (ends at 00:00 UTC that day)
						<Input
							id="pilot-until"
							type="date"
							name="until"
							required
							className="h-11"
							aria-invalid={!!errors.until}
						/>
					</label>
					{errors.until && (
						<p className="text-sm text-destructive">{errors.until}</p>
					)}
					<label
						htmlFor="pilot-note"
						className="flex flex-col gap-2 text-sm font-medium"
					>
						Note (kept for operators)
						<Input
							id="pilot-note"
							name="note"
							required
							maxLength={500}
							className="h-11"
							aria-invalid={!!errors.note}
						/>
					</label>
					{errors.note && (
						<p className="text-sm text-destructive">{errors.note}</p>
					)}
					<Button type="submit" className="h-11" disabled={processing}>
						{processing ? "Saving…" : "Grant"}
					</Button>
				</>
			)}
		</Form>
	);
}

/** The listing (no photo) or one photo of a studio. */
type Target = { slug: string; photo?: string };

/** Takes the listing or one photo off Discover; the reason is for operators only. */
function TakedownForm({ target }: { target: Target }) {
	const idPrefix = target.photo ? `photo-${target.photo}` : "listing";
	const fields = ({
		errors,
		processing,
	}: {
		errors: Record<string, string>;
		processing: boolean;
	}) => (
		<>
			<label htmlFor={`${idPrefix}-reason`} className="sr-only">
				Reason for taking it off Discover
			</label>
			<Input
				id={`${idPrefix}-reason`}
				name="reason"
				required
				maxLength={500}
				placeholder="Reason (kept for operators)"
				className="h-11"
				aria-invalid={!!errors.reason}
			/>
			{errors.reason && (
				<p className="text-sm text-destructive">{errors.reason}</p>
			)}
			<Button
				type="submit"
				variant="outline"
				className="h-11"
				disabled={processing}
			>
				{processing ? "Saving…" : "Take off Discover"}
			</Button>
		</>
	);
	const className = "flex flex-col gap-2";
	// Each form names its own error bag, so a refused reason shows only under it.
	return target.photo ? (
		<Form
			errorBag={idPrefix}
			route="admin.studios.photos.suspend"
			routeParams={{ slug: target.slug, photo: target.photo }}
			className={className}
		>
			{fields}
		</Form>
	) : (
		<Form
			errorBag={idPrefix}
			route="admin.studios.discover.suspend"
			routeParams={{ slug: target.slug }}
			className={className}
		>
			{fields}
		</Form>
	);
}

function LiftTakedown({ target }: { target: Target }) {
	const button = ({ processing }: { processing: boolean }) => (
		<Button type="submit" className="h-11" disabled={processing}>
			{processing ? "Saving…" : "Lift takedown"}
		</Button>
	);
	return target.photo ? (
		<Form
			route="admin.studios.photos.restore"
			routeParams={{ slug: target.slug, photo: target.photo }}
		>
			{button}
		</Form>
	) : (
		<Form
			route="admin.studios.discover.restore"
			routeParams={{ slug: target.slug }}
		>
			{button}
		</Form>
	);
}

function ItemList({
	title,
	items,
	reasons,
}: {
	title: string;
	items: Item[];
	reasons: ReasonOption[];
}) {
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
								<Badge variant="outline">{item.kindLabel}</Badge>
								<span className="font-medium">{item.shownName}</span>
								{item.rating !== null && <span>{item.rating}/5</span>}
								<span className="text-muted-foreground">{item.atText}</span>
							</span>
							<span>{item.excerpt}</span>
							{item.takedown && (
								<span className="text-muted-foreground">
									Taken down {item.takedown.atText} ({item.takedown.reasonLabel}
									){item.takedown.note ? `: ${item.takedown.note}` : ""}
								</span>
							)}
							{item.takedown ? (
								<LiftItemTakedown kind={item.kind} id={item.id} />
							) : (
								<ReviewTakedownForm
									kind={item.kind}
									id={item.id}
									idPrefix={`item-${item.kind}-${item.id}`}
									reasons={reasons}
								/>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

AdminStudio.layout = [AppLayout];
