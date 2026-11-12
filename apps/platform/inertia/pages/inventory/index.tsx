import { Form } from "@adonisjs/inertia/react";
import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import { ExpiryBadge } from "~/components/inventory/expiry_badge";
import {
	type InventoryItem,
	ItemFields,
	stockAmount,
} from "~/components/inventory/item_fields";
import InventoryPagination from "~/components/inventory/pagination";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

export default function InventoryIndex({
	items,
	status,
	search,
	page,
	lastPage,
	units,
	canManage,
	expiryWindowDays,
}: {
	items: InventoryItem[];
	expiryWindowDays: number;
	status: "active" | "low" | "expiring" | "archived";
	search: string;
	page: number;
	lastPage: number;
	units: string[];
	canManage: boolean;
}) {
	const { slug } = useTenant();
	const params = { tenant: slug };
	const index = urlFor("tenant.inventory.index", params);
	const pageHref = (next: number) =>
		`${index}?${new URLSearchParams({ status, q: search, page: String(next) })}`;

	return (
		<Page
			title="Inventory"
			description="Track supplies, stock levels and what gets used."
			actions={
				canManage && (
					<div className="flex flex-wrap gap-2">
						<a className={buttonVariants()} href="#add-item">
							Add item
						</a>
						<a
							className={buttonVariants({ variant: "outline" })}
							href="#inventory-csv"
						>
							CSV tools
						</a>
					</div>
				)
			}
		>
			<Section title="Stock items">
				<form
					method="get"
					action={index}
					className="mb-4 flex flex-wrap items-end gap-2"
				>
					<label
						htmlFor="inventory-search"
						className="flex min-w-40 flex-1 flex-col gap-2 text-sm font-medium"
					>
						Search items
						<Input
							id="inventory-search"
							type="search"
							name="q"
							placeholder="Name, SKU or category"
							defaultValue={search}
							maxLength={120}
						/>
					</label>
					<label className="flex flex-col gap-2 text-sm font-medium">
						Status
						<select
							name="status"
							defaultValue={status}
							className="h-11 rounded-md border bg-background px-3 text-sm"
						>
							<option value="active">Active</option>
							<option value="low">Low stock</option>
							<option value="expiring">
								Expired or expiring ({expiryWindowDays} days)
							</option>
							<option value="archived">Archived</option>
						</select>
					</label>
					<Button type="submit" variant="outline">
						Filter
					</Button>
				</form>
				{items.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">
						No items match this view.
					</p>
				) : (
					<ul className="divide-y">
						{items.map((item) => (
							<li key={item.id}>
								<Link
									href={urlFor("tenant.inventory.show", {
										...params,
										id: item.id,
									})}
									className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-sm py-3 hover:bg-muted/50"
								>
									<span className="min-w-0 wrap-anywhere">
										<span className="block font-medium">{item.name}</span>
										{(item.category || item.sku) && (
											<span className="block text-sm text-muted-foreground">
												{[item.category, item.sku].filter(Boolean).join(" · ")}
											</span>
										)}
									</span>
									<span className="flex flex-wrap items-center gap-2 text-sm tabular-nums">
										{item.tracking === "lot" && (
											<Badge variant="secondary">Lots</Badge>
										)}
										<ExpiryBadge expiry={item.expiry} item />
										{!item.archived &&
											item.reorderThreshold !== null &&
											item.quantity <= item.reorderThreshold && (
												<Badge variant="outline">Low stock</Badge>
											)}
										{stockAmount(item.quantity)} {item.unit}
									</span>
								</Link>
							</li>
						))}
					</ul>
				)}
				<InventoryPagination page={page} lastPage={lastPage} href={pageHref} />
			</Section>

			{canManage && (
				<>
					<Section id="add-item" title="Add an item">
						<Form route="tenant.inventory.store" routeParams={params}>
							{({ errors, processing }) => (
								<ItemFields
									units={units}
									errors={errors}
									processing={processing}
								/>
							)}
						</Form>
					</Section>
					<Section
						id="inventory-csv"
						title="Import and export CSV"
						description="Import up to 500 new items with their opening stock. Existing items are checked by SKU, or by name if the SKU is blank."
					>
						<div className="flex flex-col gap-4">
							<div>
								<a
									className={buttonVariants({ variant: "outline" })}
									href={urlFor("tenant.inventory.export", params)}
								>
									Download active inventory CSV
								</a>
							</div>
							<p className="text-sm text-muted-foreground">
								Columns: name, sku, category, unit, quantity, reorder_threshold.
								Use piece, box, roll, ml, or g for unit. Leave quantity blank to
								start at zero.
							</p>
							<p className="text-sm text-muted-foreground">
								CSV has no lot or expiry columns: imported items use standard
								tracking, and a lot-tracked item exports its total stock only.
								Record lots and their expiry dates on the item's page.
							</p>
							<Form
								route="tenant.inventory.import"
								routeParams={params}
								resetOnSuccess
							>
								{({ processing }) => (
									<div className="flex flex-wrap items-end gap-2">
										<label
											htmlFor="inventory-csv-file"
											className="flex min-w-0 flex-col gap-2 text-sm font-medium"
										>
											CSV file
											<Input
												id="inventory-csv-file"
												type="file"
												name="csv"
												accept=".csv,text/csv"
												required
											/>
										</label>
										<Button type="submit" disabled={processing}>
											Import CSV
										</Button>
									</div>
								)}
							</Form>
						</div>
					</Section>
				</>
			)}
		</Page>
	);
}

InventoryIndex.layout = [AppLayout];
