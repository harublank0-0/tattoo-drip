import type * as React from "react";
import { cn } from "#/lib/utils";

/** A text field on Discover's tokens: 48px tall below `lg`, 44px from `lg`. */
export function Input({
	className,
	type = "text",
	...props
}: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"min-h-12 w-full min-w-0 rounded-[2px] border border-input bg-paper-raised px-4 text-base text-foreground placeholder:text-muted-foreground transition-colors lg:min-h-11",
				"aria-invalid:border-accent disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
