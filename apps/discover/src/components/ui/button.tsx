import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "#/lib/utils";

/**
 * Discover's buttons and button-styled links. Square-ish (2px radius), not
 * pills: the site is editorial, not app chrome. 44px tall below `lg` (touch),
 * 40px from `lg`.
 */
export const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap transition-[color,background-color,border-color] duration-150 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				primary: "rounded-[2px] bg-ink text-paper hover:bg-ink/85",
				accent: "rounded-[2px] bg-accent text-on-accent hover:bg-accent-strong",
				outline:
					"rounded-[2px] border border-current/30 bg-transparent hover:border-current/70",
				ghost: "rounded-[2px] hover:bg-current/[0.06]",
				link: "underline-offset-4 decoration-current/40 hover:underline",
			},
			size: {
				md: "min-h-11 px-5 text-sm lg:min-h-10",
				sm: "min-h-11 px-3 text-sm lg:min-h-9",
				lg: "min-h-12 px-6 text-base",
				icon: "size-11 lg:size-10",
				inline: "",
			},
		},
		defaultVariants: { variant: "primary", size: "md" },
	},
);

export type ButtonProps = React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({
	className,
	variant,
	size,
	asChild = false,
	...props
}: ButtonProps) {
	const Comp = asChild ? Slot.Root : "button";
	return (
		<Comp
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}
