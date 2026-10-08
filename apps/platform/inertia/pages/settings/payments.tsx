import { Form, Link } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import {
	ArrowDown,
	ArrowUp,
	Banknote,
	Pencil,
	Plus,
	Trash2,
	Wallet,
} from "lucide-react";
import { urlFor } from "~/client";
import {
	kindCopy,
	type PaymentMethodProps,
} from "~/components/payment_methods";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

export default function Payments({
	deposits,
	methods,
}: {
	deposits: {
		defaultDepositPercent: number | null;
		depositPolicy: string | null;
	};
	methods: PaymentMethodProps[];
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };

	return (
		<>
			<Section
				title="Deposits"
				description="Shown to clients on the deposit page."
			>
				<Form route="tenant.settings.deposits.update" routeParams={params}>
					{({ errors, processing }) => (
						<FieldGroup>
							<Field data-invalid={!!errors.defaultDepositPercent}>
								<FieldLabel htmlFor="defaultDepositPercent">
									Default deposit
								</FieldLabel>
								<div className="flex items-center gap-2">
									<Input
										id="defaultDepositPercent"
										name="defaultDepositPercent"
										type="number"
										inputMode="numeric"
										min={0}
										max={100}
										step={1}
										className="w-24"
										defaultValue={deposits.defaultDepositPercent ?? ""}
										aria-invalid={!!errors.defaultDepositPercent}
									/>
									<span className="text-sm text-muted-foreground">
										% of the quote
									</span>
								</div>
								<FieldDescription>
									Leave empty to set the deposit on each quote.
								</FieldDescription>
								{errors.defaultDepositPercent && (
									<FieldError>{errors.defaultDepositPercent}</FieldError>
								)}
							</Field>

							<Field data-invalid={!!errors.depositPolicy}>
								<FieldLabel htmlFor="depositPolicy">Deposit policy</FieldLabel>
								<Textarea
									id="depositPolicy"
									name="depositPolicy"
									rows={4}
									maxLength={2000}
									defaultValue={deposits.depositPolicy ?? ""}
									placeholder="Deposits hold your date and come off the final price."
									aria-invalid={!!errors.depositPolicy}
								/>
								{errors.depositPolicy && (
									<FieldError>{errors.depositPolicy}</FieldError>
								)}
							</Field>

							<div>
								<Button type="submit" disabled={processing}>
									{processing ? "Saving…" : "Save deposit settings"}
								</Button>
							</div>
						</FieldGroup>
					)}
				</Form>
			</Section>

			<Section
				title="Payment methods"
				description="How clients pay you. The deposit page lists the marked ones in this order."
			>
				{methods.length === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Wallet />
							</EmptyMedia>
							<EmptyTitle>No payment methods yet</EmptyTitle>
							<EmptyDescription>
								Add your Fonepay, eSewa or Khalti QR code, or your bank details,
								so clients can pay their deposit.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Link
								route="tenant.settings.payments.create"
								routeParams={params}
								className={buttonVariants()}
							>
								<Plus data-icon="inline-start" />
								Add a payment method
							</Link>
						</EmptyContent>
					</Empty>
				) : (
					<div className="flex flex-col gap-3">
						{methods.map((method, index) => (
							<MethodRow
								key={method.id}
								method={method}
								tenantSlug={tenant.slug}
								first={index === 0}
								last={index === methods.length - 1}
							/>
						))}
						<div>
							<Link
								route="tenant.settings.payments.create"
								routeParams={params}
								className={buttonVariants({ variant: "outline" })}
							>
								<Plus data-icon="inline-start" />
								Add a payment method
							</Link>
						</div>
					</div>
				)}
			</Section>
		</>
	);
}

function MethodRow({
	method,
	tenantSlug,
	first,
	last,
}: {
	method: PaymentMethodProps;
	tenantSlug: string;
	first: boolean;
	last: boolean;
}) {
	const params = { tenant: tenantSlug, id: method.id };
	const details = [method.bankName, method.accountName, method.accountNumber]
		.filter(Boolean)
		.join(" · ");

	const move = (direction: "up" | "down") =>
		router.post(
			urlFor("tenant.settings.payments.move", params),
			{ direction },
			{ preserveScroll: true },
		);
	const remove = () => {
		if (
			window.confirm(`Delete "${method.label}"? Clients won't see it any more.`)
		) {
			router.delete(urlFor("tenant.settings.payments.destroy", params), {
				preserveScroll: true,
			});
		}
	};

	return (
		<div className="flex flex-wrap items-center gap-4 rounded-lg border p-3">
			{method.qrUrl ? (
				<img
					src={method.qrUrl}
					alt={`${method.label} QR code`}
					className="size-16 rounded-md border bg-white object-contain"
				/>
			) : (
				<div className="flex size-16 items-center justify-center rounded-md border bg-muted text-muted-foreground">
					<Banknote />
				</div>
			)}
			{/* min-w-40: on narrow screens the actions wrap below instead. */}
			<div className="flex min-w-40 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-medium">{method.label}</span>
					<Badge variant="secondary">{kindCopy(method.kind).name}</Badge>
					{method.showOnDepositPage && (
						<Badge variant="outline">On deposit page</Badge>
					)}
				</div>
				{details && (
					<p className="truncate text-sm text-muted-foreground">{details}</p>
				)}
			</div>
			<div className="ml-auto flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon"
					aria-label={`Move ${method.label} up`}
					disabled={first}
					onClick={() => move("up")}
				>
					<ArrowUp />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					aria-label={`Move ${method.label} down`}
					disabled={last}
					onClick={() => move("down")}
				>
					<ArrowDown />
				</Button>
				<Link
					route="tenant.settings.payments.edit"
					routeParams={params}
					aria-label={`Edit ${method.label}`}
					className={buttonVariants({ variant: "ghost", size: "icon" })}
				>
					<Pencil />
				</Link>
				<Button
					variant="ghost"
					size="icon"
					aria-label={`Delete ${method.label}`}
					onClick={remove}
				>
					<Trash2 />
				</Button>
			</div>
		</div>
	);
}

Payments.layout = [AppLayout, SettingsLayout];
