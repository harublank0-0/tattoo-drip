import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "./field.tsx";
import { Input } from "./input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./select.tsx";
import { Textarea } from "./textarea.tsx";

/*
 * TanStack Form composition for the storefront's forms. Build a form with
 * `useAppForm` and render fields with `<form.AppField name="…">`, whose
 * `field` exposes the components below (`field.TextField`, …). Each one
 * follows shadcn's TanStack Form pattern: `Field` + `FieldLabel` +
 * `FieldError`, with `aria-invalid` and `aria-describedby` wired up.
 *
 * Sized for phones (TAT-57): controls 3rem tall with 1.0625rem text (iOS
 * zooms into smaller text), labels 1rem semibold. A field's error is tied
 * to its control by aria-describedby and not announced on its own: the
 * form shows and focuses an error summary instead. Imports are relative
 * with extensions, so node tests can load this file.
 */

const CONTROL_TEXT = "text-[1.0625rem] md:text-[1.0625rem]";
const LABEL = "text-base leading-snug font-semibold";
const HINT = "text-[0.9375rem]";
/**
 * FieldError defaults to role="alert", which would announce every field's
 * error as it appears; the form's error summary speaks instead. A spread,
 * because Biome rejects a literal `role={undefined}`.
 */
const QUIET = { role: undefined } as const;

const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

type FieldShellProps = {
	label: ReactNode;
	description?: ReactNode;
};

/** The field's first error messages, whatever shape the validator gave them. */
function useFieldErrors() {
	const field = useFieldContext<unknown>();
	return field.state.meta.errors.map((error) =>
		typeof error === "string" ? { message: error } : error,
	);
}

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
	const errors = useFieldErrors();

	return (
		<Field data-invalid={isInvalid}>
			<FieldLabel htmlFor={field.name} className={LABEL}>
				{label}
			</FieldLabel>
			{children}
			{description && (
				<FieldDescription id={`${field.name}-description`} className={HINT}>
					{description}
				</FieldDescription>
			)}
			{isInvalid && (
				<FieldError
					{...QUIET}
					id={`${field.name}-error`}
					errors={errors}
					className={HINT}
				/>
			)}
		</Field>
	);
}

type TextFieldProps = FieldShellProps &
	Omit<
		ComponentProps<typeof Input>,
		"id" | "name" | "value" | "onChange" | "onBlur"
	>;

function TextField({
	label,
	description,
	className,
	...props
}: TextFieldProps) {
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
				className={cn("h-12 px-3.5", CONTROL_TEXT, className)}
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

function TextareaField({
	label,
	description,
	className,
	...props
}: TextareaFieldProps) {
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
				className={cn("min-h-32 px-3.5 py-2.5", CONTROL_TEXT, className)}
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
				<SelectTrigger {...control.props} className={cn("h-12", CONTROL_TEXT)}>
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

type ChoiceFieldProps = {
	legend: ReactNode;
	description?: ReactNode;
	options: readonly { value: string; label: ReactNode }[];
	required?: boolean;
	disabled?: boolean;
};

/**
 * One choice among a few, as native radios: one tap each, visible without
 * opening anything, and the radio itself stays visible (violet accent), so
 * the choice shows even where `:has()` styling doesn't.
 */
function ChoiceField({
	legend,
	description,
	options,
	required,
	disabled,
}: ChoiceFieldProps) {
	const field = useFieldContext<string>();
	const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
	const errors = useFieldErrors();
	const describedBy = [
		description && `${field.name}-description`,
		isInvalid && `${field.name}-error`,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<FieldSet
			id={field.name}
			data-invalid={isInvalid}
			aria-describedby={describedBy || undefined}
			className="gap-3"
		>
			{/* variant "legend" is the 1rem one; "label" would pin it to 0.875rem. */}
			<FieldLegend variant="legend" className={cn("mb-0", LABEL)}>
				{legend}
			</FieldLegend>
			{description && (
				<FieldDescription id={`${field.name}-description`} className={HINT}>
					{description}
				</FieldDescription>
			)}
			<div className="flex flex-wrap gap-2">
				{options.map((option, index) => (
					<label
						key={option.value}
						className={cn(
							"inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border border-input px-3.5 py-2",
							CONTROL_TEXT,
							"has-checked:border-primary has-checked:bg-secondary has-disabled:cursor-not-allowed has-disabled:opacity-50",
						)}
					>
						<input
							type="radio"
							id={`${field.name}-${index}`}
							name={field.name}
							value={option.value}
							checked={field.state.value === option.value}
							onChange={() => field.handleChange(option.value)}
							onBlur={field.handleBlur}
							required={required}
							disabled={disabled}
							aria-invalid={isInvalid || undefined}
							className="size-4 shrink-0 accent-primary"
						/>
						<span dir="auto">{option.label}</span>
					</label>
				))}
			</div>
			{isInvalid && (
				<FieldError
					{...QUIET}
					id={`${field.name}-error`}
					errors={errors}
					className={HINT}
				/>
			)}
		</FieldSet>
	);
}

const { useAppForm, withForm } = createFormHook({
	fieldContext,
	formContext,
	fieldComponents: { TextField, TextareaField, SelectField, ChoiceField },
	formComponents: {},
});

export { useAppForm, withForm };
