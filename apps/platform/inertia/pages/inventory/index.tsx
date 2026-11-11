import { Form } from "@adonisjs/inertia/react";
import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
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
}: {
	items: InventoryItem[];
	status: "active" | "low" | "archived";
	search: string;
	page: number;
	lastPage: number;
	units: string[];
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
				<a className={buttonVariants()} href="#add-item">
					Add item
				</a>
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

			<Section id="add-item" title="Add an item">
				<Form route="tenant.inventory.store" routeParams={params}>
					{({ errors, processing }) => (
						<ItemFields units={units} errors={errors} processing={processing} />
					)}
				</Form>
			</Section>
		</Page>
	);
}

InventoryIndex.layout = [AppLayout];
