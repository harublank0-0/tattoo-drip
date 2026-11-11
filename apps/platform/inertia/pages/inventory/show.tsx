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
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

type Movement = {
	id: string;
	kind: "receive" | "use" | "count";
	delta: number;
	balanceAfter: number;
	note: string | null;
	date: string;
};

const movementLabels = {
	receive: "Received",
	use: "Used",
	count: "Stock count",
};

export default function InventoryShow({
	item,
	history,
	page,
	lastPage,
	requestId,
}: {
	item: InventoryItem;
	history: Movement[];
	page: number;
	lastPage: number;
	requestId: string;
}) {
	const { slug } = useTenant();
	const params = { tenant: slug, id: item.id };
	const detail = urlFor("tenant.inventory.show", params);

	return (
		<Page
			title={item.name}
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
					{item.archived ? (
						<Badge variant="outline">Archived</Badge>
					) : (
						item.reorderThreshold !== null &&
						item.quantity <= item.reorderThreshold && (
							<Badge variant="outline">Low stock</Badge>
						)
					)}
				</p>
			}
		>
			{!item.archived && (
				<Section title="Record stock movement">
					<Form
						route="tenant.inventory.movement"
						routeParams={params}
						resetOnSuccess
					>
						{({ errors, processing }) => (
							<FieldGroup>
								<input type="hidden" name="requestId" value={requestId} />
								{errors.requestId && (
									<FieldError>{errors.requestId}</FieldError>
								)}
								<div className="grid gap-4 sm:grid-cols-2">
									<Field>
										<FieldLabel htmlFor="movement-kind">Movement</FieldLabel>
										<select
											id="movement-kind"
											name="kind"
											className="min-h-11 rounded-md border bg-background px-3 text-sm"
											aria-invalid={!!errors.kind}
										>
											<option value="receive">Receive stock</option>
											<option value="use">Use stock</option>
											<option value="count">Set counted stock</option>
										</select>
										{errors.kind && <FieldError>{errors.kind}</FieldError>}
									</Field>
									<Field>
										<FieldLabel htmlFor="movement-quantity">
											Quantity ({item.unit})
										</FieldLabel>
										<Input
											id="movement-quantity"
											name="quantity"
											type="number"
											min={0}
											max={2_000_000}
											step="0.001"
											inputMode="decimal"
											required
											aria-invalid={!!errors.quantity}
										/>
										{errors.quantity && (
											<FieldError>{errors.quantity}</FieldError>
										)}
									</Field>
								</div>
								<Field>
									<FieldLabel htmlFor="movement-note">
										Note (optional)
									</FieldLabel>
									<Input
										id="movement-note"
										name="note"
										maxLength={240}
										aria-invalid={!!errors.note}
									/>
									{errors.note && <FieldError>{errors.note}</FieldError>}
								</Field>
								<div>
									<Button type="submit" disabled={processing}>
										Record movement
									</Button>
								</div>
							</FieldGroup>
						)}
					</Form>
				</Section>
			)}

			<Section title="Movement history">
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
									<p className="font-medium">{movementLabels[movement.kind]}</p>
									<p className="text-muted-foreground">{movement.date}</p>
									{movement.note && <p className="mt-1">{movement.note}</p>}
								</div>
								<div className="text-right tabular-nums">
									<p className="font-medium">
										{movement.delta > 0 && "+"}
										{stockAmount(movement.delta)}
									</p>
									<p className="text-muted-foreground">
										{stockAmount(movement.balanceAfter)} {item.unit} after
									</p>
								</div>
							</li>
						))}
					</ul>
				)}
				<InventoryPagination
					page={page}
					lastPage={lastPage}
					href={(next) => `${detail}?page=${next}`}
				/>
			</Section>

			{!item.archived && (
				<>
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
							<Form route="tenant.inventory.archive" routeParams={params}>
								{({ processing }) => (
									<Button variant="outline" type="submit" disabled={processing}>
										Archive item
									</Button>
								)}
							</Form>
						)}
					</Section>
				</>
			)}
		</Page>
	);
}

InventoryShow.layout = [AppLayout];
