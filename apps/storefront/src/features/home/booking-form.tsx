"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle, Loader2, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "#/components/ui/button";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "#/components/ui/form";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";

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

	const form = useForm<BookingSchema>({
		resolver: zodResolver(bookingSchema),
		defaultValues: {
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
		},
	});

	const isFlashEnquiry = initialData?.source === "flash";

	const handleSubmit = async (data: BookingSchema) => {
		if (data.website) {
			return;
		}

		setSubmitStatus("submitting");
		setErrorMessage("");

		try {
			if (onSubmit) {
				await onSubmit(data as BookingFormData);
			} else {
				await new Promise((resolve) => setTimeout(resolve, 1500));
			}
			setSubmitStatus("success");
			form.reset({
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
			});
		} catch (error) {
			setSubmitStatus("error");
			setErrorMessage(
				error instanceof Error
					? error.message
					: "Something went wrong. Please try again.",
			);
		}
	};

	const handleCloseSuccess = () => {
		setSubmitStatus("idle");
	};

	return (
		<Form {...form}>
			<form
				onSubmit={form.handleSubmit(handleSubmit)}
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
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name *</FormLabel>
									<FormControl>
										<Input
											placeholder="Your full name"
											{...field}
											disabled={submitStatus === "submitting"}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="email"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Email *</FormLabel>
									<FormControl>
										<Input
											type="email"
											placeholder="you@example.com"
											{...field}
											disabled={submitStatus === "submitting"}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					</div>

					<FormField
						control={form.control}
						name="tattooIdea"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Tattoo idea *</FormLabel>
								<FormControl>
									<Textarea
										placeholder={
											isFlashEnquiry
												? `Interested in ${initialData.flashPieceTitle || "this flash piece"}...`
												: "Describe your idea, themes, references, meaning, etc."
										}
										rows={4}
										{...field}
										disabled={submitStatus === "submitting"}
									/>
								</FormControl>
								<FormDescription>
									Minimum 20 characters. Be as specific as you can.
								</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>

					<div className="grid gap-4 sm:grid-cols-2">
						<FormField
							control={form.control}
							name="style"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Style</FormLabel>
									<Select
										onValueChange={field.onChange}
										defaultValue={field.value}
									>
										<FormControl>
											<SelectTrigger disabled={submitStatus === "submitting"}>
												<SelectValue placeholder="Select a style (optional)" />
											</SelectTrigger>
										</FormControl>
										<FormControl>
											<SelectContent>
												{styleOptions.map((option) => (
													<SelectItem key={option.value} value={option.value}>
														{option.label}
													</SelectItem>
												))}
											</SelectContent>
										</FormControl>
										<FormMessage />
									</Select>
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="placement"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Placement</FormLabel>
									<FormControl>
										<Input
											placeholder="e.g., upper arm, forearm, back, thigh"
											{...field}
											disabled={submitStatus === "submitting"}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					</div>

					<div className="grid gap-4 sm:grid-cols-3">
						<FormField
							control={form.control}
							name="size"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Approx. size</FormLabel>
									<FormControl>
										<Input
											placeholder="e.g., 10x15 cm, palm-sized, half sleeve"
											{...field}
											disabled={submitStatus === "submitting"}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="preferredDates"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Preferred dates</FormLabel>
									<FormControl>
										<Input
											placeholder="e.g., October weekends, flexible"
											{...field}
											disabled={submitStatus === "submitting"}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="budget"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Budget (USD)</FormLabel>
									<FormControl>
										<Input
											placeholder="e.g., 200-400, or 'discuss'"
											{...field}
											disabled={submitStatus === "submitting"}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					</div>

					<FormField
						control={form.control}
						name="referenceLinks"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Reference links</FormLabel>
								<FormControl>
									<Textarea
										placeholder="Paste image URLs here (one per line) — Pinterest, Instagram, Google Drive, etc."
										rows={3}
										{...field}
										disabled={submitStatus === "submitting"}
									/>
								</FormControl>
								<FormDescription>
									Optional. Helps us understand your vision.
								</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>

					<input
						type="text"
						id="website"
						tabIndex={-1}
						autoComplete="off"
						style={{
							position: "absolute",
							left: "-9999px",
							opacity: 0,
							pointerEvents: "none",
							height: 0,
							width: 0,
						}}
						{...form.register("website")}
					/>

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
						disabled={
							submitStatus === "submitting" || submitStatus === "success"
						}
					>
						{submitStatus === "submitting" && (
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
						{submitStatus !== "submitting" && submitStatus !== "success" && (
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
		</Form>
	);
}
