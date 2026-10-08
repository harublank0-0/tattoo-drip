import { Form, Link } from "@adonisjs/inertia/react";
import { useState } from "react";
import {
	fieldLabel,
	kindCopy,
	type PaymentMethodProps,
} from "~/components/payment_methods";
import Section from "~/components/section";
import { Button, buttonVariants } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type Errors = Partial<Record<string, string>>;

/**
 * Adds a payment method (`method` is null) or edits one. The kind is
 * picked when adding and fixed after that.
 */
export default function PaymentMethodForm({
	kinds,
	method,
}: {
	kinds: string[];
	method: PaymentMethodProps | null;
}) {
	const tenant = useTenant();

	if (method) {
		return (
			<Section title="Edit payment method">
				<Form
					route="tenant.settings.payments.update"
					routeParams={{ tenant: tenant.slug, id: method.id }}
				>
					{({ errors, processing }) => (
						<MethodFields
							kinds={kinds}
							method={method}
							errors={errors}
							processing={processing}
							tenantSlug={tenant.slug}
						/>
					)}
				</Form>
			</Section>
		);
	}

	return (
		<Section title="Add a payment method">
			<Form
				route="tenant.settings.payments.store"
				routeParams={{ tenant: tenant.slug }}
			>
				{({ errors, processing }) => (
					<MethodFields
						kinds={kinds}
						method={null}
						errors={errors}
						processing={processing}
						tenantSlug={tenant.slug}
					/>
				)}
			</Form>
		</Section>
	);
}

function MethodFields({
	kinds,
	method,
	errors,
	processing,
	tenantSlug,
}: {
	kinds: string[];
	method: PaymentMethodProps | null;
	errors: Errors;
	processing: boolean;
	tenantSlug: string;
}) {
	const [kind, setKind] = useState(method?.kind ?? kinds[0]);
	const [label, setLabel] = useState(method?.label ?? kindCopy(kinds[0]).name);
	// The label follows the kind until the owner edits it.
	const [labelTouched, setLabelTouched] = useState(method !== null);
	const copy = kindCopy(kind);

	return (
		<FieldGroup>
			{method ? (
				<Field>
					<FieldLabel>Kind</FieldLabel>
					<p className="text-sm">{copy.name}</p>
					<FieldDescription>
						To change the kind, delete this method and add a new one.
					</FieldDescription>
				</Field>
			) : (
				<FieldSet data-invalid={!!errors.kind}>
					<FieldLegend variant="label">Kind</FieldLegend>
					<RadioGroup
						name="kind"
						value={kind}
						onValueChange={(value) => {
							setKind(value);
							if (!labelTouched) setLabel(kindCopy(value).name);
						}}
					>
						{kinds.map((value) => (
							<FieldLabel key={value} htmlFor={`kind-${value}`}>
								<Field orientation="horizontal">
									<FieldContent>
										<FieldTitle>{kindCopy(value).name}</FieldTitle>
										<FieldDescription>
											{kindCopy(value).description}
										</FieldDescription>
									</FieldContent>
									<RadioGroupItem value={value} id={`kind-${value}`} />
								</Field>
							</FieldLabel>
						))}
					</RadioGroup>
					{errors.kind && <FieldError>{errors.kind}</FieldError>}
				</FieldSet>
			)}

			<Field data-invalid={!!errors.label}>
				<FieldLabel htmlFor="label">Label</FieldLabel>
				<Input
					id="label"
					name="label"
					maxLength={80}
					value={label}
					onChange={(event) => {
						setLabelTouched(true);
						setLabel(event.target.value);
					}}
					aria-invalid={!!errors.label}
				/>
				<FieldDescription>
					What clients see, e.g. &quot;Fonepay (Nabil Bank)&quot;.
				</FieldDescription>
				{errors.label && <FieldError>{errors.label}</FieldError>}
			</Field>

			{copy.fields.map((field) => (
				<Field key={`${kind}-${field}`} data-invalid={!!errors[field]}>
					<FieldLabel htmlFor={field}>{fieldLabel(kind, field)}</FieldLabel>
					<Input
						id={field}
						name={field}
						defaultValue={method?.[field] ?? ""}
						aria-invalid={!!errors[field]}
					/>
					{errors[field] && <FieldError>{errors[field]}</FieldError>}
				</Field>
			))}

			{copy.qr !== "none" && (
				<Field data-invalid={!!errors.qr}>
					<FieldLabel htmlFor="qr">
						QR code{copy.qr === "optional" ? " (optional)" : ""}
					</FieldLabel>
					{method?.qrUrl && (
						<div className="flex flex-wrap items-center gap-4">
							<img
								src={method.qrUrl}
								alt="Current QR code"
								className="size-24 rounded-md border bg-white object-contain"
							/>
							{copy.qr === "optional" && (
								<Field orientation="horizontal" className="w-auto">
									<Checkbox id="removeQr" name="removeQr" />
									<FieldLabel htmlFor="removeQr" className="font-normal">
										Remove this QR code
									</FieldLabel>
								</Field>
							)}
						</div>
					)}
					<Input
						id="qr"
						name="qr"
						type="file"
						accept="image/jpeg,image/png,image/webp"
						aria-invalid={!!errors.qr}
					/>
					<FieldDescription>
						JPEG, PNG or WebP, up to 10 MB.
						{method?.qrUrl ? " Choose a file to replace the current one." : ""}
					</FieldDescription>
					{errors.qr && <FieldError>{errors.qr}</FieldError>}
				</Field>
			)}

			{copy.depositPage && (
				<Field orientation="horizontal">
					<Checkbox
						id="showOnDepositPage"
						name="showOnDepositPage"
						defaultChecked={method?.showOnDepositPage ?? true}
					/>
					<FieldContent>
						<FieldLabel htmlFor="showOnDepositPage">
							Show on the deposit page
						</FieldLabel>
						<FieldDescription>
							Clients can pay their deposit this way.
						</FieldDescription>
						{errors.showOnDepositPage && (
							<FieldError>{errors.showOnDepositPage}</FieldError>
						)}
					</FieldContent>
				</Field>
			)}

			<div className="flex gap-2">
				<Button type="submit" disabled={processing}>
					{processing ? "Saving…" : method ? "Save" : "Add payment method"}
				</Button>
				<Link
					route="tenant.settings.payments"
					routeParams={{ tenant: tenantSlug }}
					className={buttonVariants({ variant: "ghost" })}
				>
					Cancel
				</Link>
			</div>
		</FieldGroup>
	);
}

PaymentMethodForm.layout = [AppLayout, SettingsLayout];
