import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import type { ComponentProps, ReactNode } from "react";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";

/*
 * TanStack Form composition for the storefront's forms. Build a form with
 * `useAppForm` and render fields with `<form.AppField name="…">`, whose
 * `field` exposes the components below (`field.TextField`, …). Each one
 * follows shadcn's TanStack Form pattern: `Field` + `FieldLabel` +
 * `FieldError`, with `aria-invalid` and `aria-describedby` wired up.
 */

const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

type FieldShellProps = {
	label: ReactNode;
	description?: ReactNode;
};

/** Props for the bound control: ids, ARIA state and blur tracking. */
function useControlProps(hasDescription: boolean) {
	const field = useFieldContext<unknown>();
	const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
	const describedBy = [
		hasDescription && `${field.name}-description`,
		isInvalid && `${field.name}-error`,
	]
		.filter(Boolean)
		.join(" ");

	return {
		isInvalid,
		props: {
			id: field.name,
			onBlur: field.handleBlur,
			"aria-invalid": isInvalid,
			"aria-describedby": describedBy || undefined,
		},
	};
}

function FieldShell({
	label,
	description,
	isInvalid,
	children,
}: FieldShellProps & { isInvalid: boolean; children: ReactNode }) {
	const field = useFieldContext<unknown>();
	const errors = field.state.meta.errors.map((error) =>
		typeof error === "string" ? { message: error } : error,
	);

	return (
		<Field data-invalid={isInvalid}>
			<FieldLabel htmlFor={field.name}>{label}</FieldLabel>
			{children}
			{description && (
				<FieldDescription id={`${field.name}-description`}>
					{description}
				</FieldDescription>
			)}
			{isInvalid && <FieldError id={`${field.name}-error`} errors={errors} />}
		</Field>
	);
}

type TextFieldProps = FieldShellProps &
	Omit<
		ComponentProps<typeof Input>,
		"id" | "name" | "value" | "onChange" | "onBlur"
	>;

function TextField({ label, description, ...props }: TextFieldProps) {
	const field = useFieldContext<string | undefined>();
	const control = useControlProps(Boolean(description));

	return (
		<FieldShell
			label={label}
			description={description}
			isInvalid={control.isInvalid}
		>
			<Input
				{...props}
				{...control.props}
				name={field.name}
				value={field.state.value ?? ""}
				onChange={(event) => field.handleChange(event.target.value)}
			/>
		</FieldShell>
	);
}

type TextareaFieldProps = FieldShellProps &
	Omit<
		ComponentProps<typeof Textarea>,
		"id" | "name" | "value" | "onChange" | "onBlur"
	>;

function TextareaField({ label, description, ...props }: TextareaFieldProps) {
	const field = useFieldContext<string | undefined>();
	const control = useControlProps(Boolean(description));

	return (
		<FieldShell
			label={label}
			description={description}
			isInvalid={control.isInvalid}
		>
			<Textarea
				{...props}
				{...control.props}
				name={field.name}
				value={field.state.value ?? ""}
				onChange={(event) => field.handleChange(event.target.value)}
			/>
		</FieldShell>
	);
}

type SelectFieldProps = FieldShellProps & {
	options: readonly { value: string; label: string }[];
	placeholder?: string;
	disabled?: boolean;
};

/** An empty value shows the placeholder; Radix doesn't allow empty items. */
function SelectField({
	label,
	description,
	options,
	placeholder,
	disabled,
}: SelectFieldProps) {
	const field = useFieldContext<string | undefined>();
	const control = useControlProps(Boolean(description));

	return (
		<FieldShell
			label={label}
			description={description}
			isInvalid={control.isInvalid}
		>
			<Select
				name={field.name}
				value={field.state.value ?? ""}
				onValueChange={field.handleChange}
				disabled={disabled}
			>
				<SelectTrigger {...control.props}>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					{options
						.filter((option) => option.value !== "")
						.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
				</SelectContent>
			</Select>
		</FieldShell>
	);
}

const { useAppForm, withForm } = createFormHook({
	fieldContext,
	formContext,
	fieldComponents: { TextField, TextareaField, SelectField },
	formComponents: {},
});

export { useAppForm, withForm };
