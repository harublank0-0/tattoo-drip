import { Form } from "@adonisjs/inertia/react";
import { Link, router } from "@inertiajs/react";
import { useRef } from "react";
import { urlFor } from "~/client";
import InlineConfirm from "~/components/inline_confirm";
import { ExpiryBadge } from "~/components/inventory/expiry_badge";
import {
	type InventoryItem,
	ItemFields,
	stockAmount,
} from "~/components/inventory/item_fields";
import { LotExpiryForm } from "~/components/inventory/lot_expiry";
import { LotTracking } from "~/components/inventory/lot_tracking";
import { expiryText, type InventoryLot } from "~/components/inventory/lots";
import { MovementForm } from "~/components/inventory/movement_form";
import InventoryPagination from "~/components/inventory/pagination";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

type Movement = {
	actor: string;
	id: string;
	kind: "receive" | "use" | "count" | "assign" | "release";
	delta: number;
	balanceAfter: number;
	lot: {
		id: string;
		number: string;
		delta: number;
		balanceAfter: number;
	} | null;
	note: string | null;
	date: string;
};

const movementLabels = {
	receive: "Received",
	use: "Used",
	count: "Stock count",
	assign: "Put in a lot",
	release: "Taken out of a lot",
};

export default function InventoryShow({
	item,
	history,
	page,
	lastPage,
	requestId,
	canManage,
	lots,
	suggestedLotId,
	unassigned,
	lotsWithStock,
	expiryWindowDays,
	lotFilter,
}: {
	item: InventoryItem;
	history: Movement[];
	page: number;
	lastPage: number;
	requestId: string;
	canManage: boolean;
	lots: InventoryLot[];
	suggestedLotId: string | null;
	unassigned: number;
	lotsWithStock: number;
	expiryWindowDays: number;
	lotFilter: { id: string; number: string } | null;
}) {
	const { slug } = useTenant();
	const params = { tenant: slug, id: item.id };
	const detail = urlFor("tenant.inventory.show", params);
	const tracked = item.tracking === "lot";
	const historyHref = (next: number) =>
		`${detail}?${new URLSearchParams({
			...(lotFilter ? { lot: lotFilter.id } : {}),
			page: String(next),
		})}#history`;
	const heading = useRef<HTMLHeadingElement>(null);

	return (
		<Page
			title={item.name}
			titleRef={heading}
			actions={
				<Link
					href={urlFor("tenant.inventory.index", { tenant: slug })}
					className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
				>
					Back to inventory
				</Link>
			}
			details={
				<p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
					<span>
						{stockAmount(item.quantity)} {item.unit} on hand
					</span>
					{tracked && <Badge variant="secondary">Lot tracking</Badge>}
					{item.archived ? (
						<Badge variant="outline">Archived</Badge>
					) : (
						item.reorderThreshold !== null &&
						item.quantity <= item.reorderThreshold && (
							<Badge variant="outline">Low stock</Badge>
						)
					)}
					<ExpiryBadge expiry={item.expiry} item />
				</p>
			}
		>
			{!item.archived && (
				<Section
					title={canManage ? "Record stock movement" : "Record stock used"}
				>
					<MovementForm
						key={item.tracking}
						item={item}
						lots={lots}
						suggestedLotId={suggestedLotId}
						requestId={requestId}
						canManage={canManage}
						params={params}
					/>
				</Section>
			)}

			{(tracked || lots.length > 0) && (
				<Section
					id="lots"
					title={tracked ? "Lots" : "Lots being set up"}
					description={`Lots with stock, earliest expiry first. Lots expiring within ${expiryWindowDays} days are flagged, using the studio's time zone.`}
				>
					{lots.length === 0 ? (
						<p className="text-sm text-muted-foreground">No lot has stock.</p>
					) : (
						<ul className="divide-y">
							{lots.map((lot) => (
								<li
									key={lot.id}
									className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
								>
									<div className="min-w-0 wrap-anywhere">
										<p className="flex flex-wrap items-center gap-2 font-medium">
											Lot {lot.number}
											<ExpiryBadge expiry={lot.expiry} />
										</p>
										<p className="text-muted-foreground">{expiryText(lot)}</p>
									</div>
									<div className="flex flex-wrap items-center gap-3 tabular-nums">
										<span className="font-medium">
											{stockAmount(lot.quantity)} {item.unit}
										</span>
										<Link
											href={`${detail}?lot=${lot.id}#history`}
											className="inline-flex min-h-11 items-center underline underline-offset-4"
											aria-label={`History of lot ${lot.number}`}
										>
											History
										</Link>
									</div>
									{canManage && !item.archived && (
										<LotExpiryForm lot={lot} params={params} />
									)}
								</li>
							))}
						</ul>
					)}
					{lotsWithStock > lots.length && (
						<p className="mt-2 text-sm text-muted-foreground">
							Showing the {lots.length} earliest-expiring of {lotsWithStock}{" "}
							lots with stock. Use or count these first to see the rest.
						</p>
					)}
				</Section>
			)}

			<Section id="history" title="Movement history">
				{lotFilter && (
					<p className="mb-2 flex flex-wrap items-center gap-x-3 text-sm">
						<span className="wrap-anywhere">
							Showing lot {lotFilter.number} only.
						</span>
						<Link
							href={`${detail}#history`}
							className="inline-flex min-h-11 items-center underline underline-offset-4"
						>
							Show all movements
						</Link>
					</p>
				)}
				{history.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No stock movements yet.
					</p>
				) : (
					<ul className="divide-y">
						{history.map((movement) => (
							<li
								key={movement.id}
								className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"
							>
								<div className="min-w-0 wrap-anywhere">
									<p className="font-medium">
										{movementLabels[movement.kind]}
										{movement.lot && ` · Lot ${movement.lot.number}`}
									</p>
									<p className="text-muted-foreground">
										{movement.actor} · {movement.date}
									</p>
									{movement.note && <p className="mt-1">{movement.note}</p>}
								</div>
								<div className="text-right tabular-nums">
									<p className="font-medium">
										{(movement.lot?.delta ?? movement.delta) > 0 && "+"}
										{stockAmount(movement.lot?.delta ?? movement.delta)}
									</p>
									{movement.lot && (
										<p className="text-muted-foreground">
											Lot:{" "}
											{stockAmount(
												movement.lot.balanceAfter - movement.lot.delta,
											)}{" "}
											→ {stockAmount(movement.lot.balanceAfter)} {item.unit}
										</p>
									)}
									<p className="text-muted-foreground">
										{movement.lot && "Total: "}
										{stockAmount(movement.balanceAfter - movement.delta)} →{" "}
										{stockAmount(movement.balanceAfter)} {item.unit}
									</p>
								</div>
							</li>
						))}
					</ul>
				)}
				<InventoryPagination
					page={page}
					lastPage={lastPage}
					href={historyHref}
				/>
			</Section>

			{canManage && !item.archived && (
				<>
					<Section id="lot-tracking" title="Lot tracking">
						<LotTracking
							item={item}
							lots={lots}
							unassigned={unassigned}
							requestId={requestId}
							params={params}
						/>
					</Section>
					<Section title="Edit item">
						<Form route="tenant.inventory.update" routeParams={params}>
							{({ errors, processing }) => (
								<ItemFields
									item={item}
									errors={errors}
									processing={processing}
								/>
							)}
						</Form>
					</Section>
					<Section title="Archive item">
						{item.quantity > 0 ? (
							<p className="text-sm text-muted-foreground">
								Record or correct the remaining stock before archiving.
							</p>
						) : (
							<InlineConfirm
								label="Archive item"
								variant="outline"
								question="Archive this item? It leaves the stock list, and CSV imports will still treat its name and SKU as taken."
								confirmLabel="Archive item"
								keepLabel="Keep it"
								busyLabel="Archiving…"
								fallback={heading}
								onConfirm={(finished) =>
									router.delete(urlFor("tenant.inventory.archive", params), {
										onFinish: finished,
									})
								}
							/>
						)}
					</Section>
				</>
			)}
		</Page>
	);
}

InventoryShow.layout = [AppLayout];
