import { revalidateLogic } from "@tanstack/react-form";
import { AlertCircle, CheckCircle, Loader2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { useAppForm } from "#/components/ui/form";

import {
	type BookingFormData,
	type BookingSchema,
	bookingSchema,
	styleOptions,
} from "./types";

interface BookingFormProps {
	initialData?: Partial<BookingFormData>;
	onSubmit?: (data: BookingFormData) => Promise<void>;
	className?: string;
}

export function BookingForm({
	initialData,
	onSubmit,
	className,
}: BookingFormProps) {
	const [submitStatus, setSubmitStatus] = useState<
		"idle" | "submitting" | "success" | "error"
	>("idle");
	const [errorMessage, setErrorMessage] = useState<string>("");

	const defaultValues: BookingSchema = {
		name: "",
		email: "",
		tattooIdea: "",
		style: "",
		placement: "",
		size: "",
		preferredDates: "",
		budget: "",
		referenceLinks: "",
		website: "",
		source: "general",
		flashPieceId: "",
		flashPieceTitle: "",
		flashPiecePrice: 0,
		...initialData,
	};

	const form = useAppForm({
		defaultValues,
		// Validate on submit, then re-validate each change after the first attempt.
		validationLogic: revalidateLogic({
			mode: "submit",
			modeAfterSubmission: "change",
		}),
		validators: { onDynamic: bookingSchema },
		onSubmit: async ({ value, formApi }) => {
			if (value.website) {
				return;
			}

			setSubmitStatus("submitting");
			setErrorMessage("");

			try {
				if (onSubmit) {
					await onSubmit(value as BookingFormData);
				} else {
					await new Promise((resolve) => setTimeout(resolve, 1500));
				}
				setSubmitStatus("success");
				formApi.reset();
			} catch (error) {
				setSubmitStatus("error");
				setErrorMessage(
					error instanceof Error
						? error.message
						: "Something went wrong. Please try again.",
				);
			}
		},
	});

	const isFlashEnquiry = initialData?.source === "flash";
	const isSubmitting = submitStatus === "submitting";

	const handleCloseSuccess = () => {
		setSubmitStatus("idle");
	};

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				form.handleSubmit();
			}}
			className={className}
			noValidate
		>
			{isFlashEnquiry && initialData.flashPieceTitle && (
				<div className="mb-4 p-3 bg-accent/10 border border-accent/30 rounded-sm">
					<p className="text-xs tracking-wide text-accent font-medium">
						Enquiring about flash: {initialData.flashPieceTitle}
						{initialData.flashPiecePrice &&
							` — ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(initialData.flashPiecePrice)}`}
					</p>
				</div>
			)}

			<div className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<form.AppField name="name">
						{(field) => (
							<field.TextField
								label="Name *"
								placeholder="Your full name"
								disabled={isSubmitting}
							/>
						)}
					</form.AppField>
					<form.AppField name="email">
						{(field) => (
							<field.TextField
								label="Email *"
								type="email"
								placeholder="you@example.com"
								disabled={isSubmitting}
							/>
						)}
					</form.AppField>
				</div>

				<form.AppField name="tattooIdea">
					{(field) => (
						<field.TextareaField
							label="Tattoo idea *"
							description="Minimum 20 characters. Be as specific as you can."
							placeholder={
								isFlashEnquiry
									? `Interested in ${initialData.flashPieceTitle || "this flash piece"}...`
									: "Describe your idea, themes, references, meaning, etc."
							}
							rows={4}
							disabled={isSubmitting}
						/>
					)}
				</form.AppField>

				<div className="grid gap-4 sm:grid-cols-2">
					<form.AppField name="style">
						{(field) => (
							<field.SelectField
								label="Style"
								options={styleOptions}
								placeholder="Select a style (optional)"
								disabled={isSubmitting}
							/>
						)}
					</form.AppField>
					<form.AppField name="placement">
						{(field) => (
							<field.TextField
								label="Placement"
								placeholder="e.g., upper arm, forearm, back, thigh"
								disabled={isSubmitting}
							/>
						)}
					</form.AppField>
				</div>

				<div className="grid gap-4 sm:grid-cols-3">
					<form.AppField name="size">
						{(field) => (
							<field.TextField
								label="Approx. size"
								placeholder="e.g., 10x15 cm, palm-sized, half sleeve"
								disabled={isSubmitting}
							/>
						)}
					</form.AppField>
					<form.AppField name="preferredDates">
						{(field) => (
							<field.TextField
								label="Preferred dates"
								placeholder="e.g., October weekends, flexible"
								disabled={isSubmitting}
							/>
						)}
					</form.AppField>
					<form.AppField name="budget">
						{(field) => (
							<field.TextField
								label="Budget (USD)"
								placeholder="e.g., 200-400, or 'discuss'"
								disabled={isSubmitting}
							/>
						)}
					</form.AppField>
				</div>

				<form.AppField name="referenceLinks">
					{(field) => (
						<field.TextareaField
							label="Reference links"
							description="Optional. Helps us understand your vision."
							placeholder="Paste image URLs here (one per line) — Pinterest, Instagram, Google Drive, etc."
							rows={3}
							disabled={isSubmitting}
						/>
					)}
				</form.AppField>

				{/* Honeypot: hidden from people, filled in by bots. */}
				<form.Field name="website">
					{(field) => (
						<input
							type="text"
							id={field.name}
							name={field.name}
							value={field.state.value ?? ""}
							onChange={(event) => field.handleChange(event.target.value)}
							tabIndex={-1}
							autoComplete="off"
							aria-hidden="true"
							className="pointer-events-none absolute -left-[9999px] size-0 opacity-0"
						/>
					)}
				</form.Field>

				{submitStatus === "error" && (
					<div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 text-destructive text-sm">
						<AlertCircle className="size-4 shrink-0" />
						<span>{errorMessage}</span>
					</div>
				)}

				<Button
					type="submit"
					size="lg"
					className="w-full"
					disabled={isSubmitting || submitStatus === "success"}
				>
					{isSubmitting && (
						<>
							<Loader2 className="size-4 animate-spin mr-2" />
							Sending...
						</>
					)}
					{submitStatus === "success" && (
						<>
							<CheckCircle className="size-4 mr-2" />
							Sent successfully
						</>
					)}
					{!isSubmitting && submitStatus !== "success" && (
						<>
							Start a booking
							<X className="size-4 ml-2" aria-hidden="true" />
						</>
					)}
				</Button>

				{submitStatus === "success" && (
					<p className="text-center text-sm text-muted-foreground">
						We'll reply within 24 hours.
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={handleCloseSuccess}
							className="ml-2 text-xs"
						>
							Send another
						</Button>
					</p>
				)}

				<p className="text-center text-[10px] tracking-wide text-muted-foreground">
					No spam. Your details are only used to respond to this enquiry.
				</p>
			</div>
		</form>
	);
}
