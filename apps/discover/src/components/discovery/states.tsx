import {
	type ErrorComponentProps,
	Link,
	useRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { isUnavailable } from "#/lib/api-errors";
import { cn } from "#/lib/utils";
import { Button, buttonVariants } from "../ui/button.tsx";
import { PageContainer } from "./layout.tsx";

/**
 * A result that is honestly empty: what happened and what to do next, in
 * the site's own type, never fake listings or figures.
 */
export function EmptyState({
	title,
	children,
	action,
	className,
}: {
	title: string;
	children?: ReactNode;
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-start gap-4 border-t border-line py-12",
				className,
			)}
		>
			<h2 className="font-display text-display-md font-bold">{title}</h2>
			{children && (
				<div className="max-w-xl text-muted-foreground">{children}</div>
			)}
			{action}
		</div>
	);
}

/** A read that failed: announced to screen readers, with a retry when it can help. */
export function ErrorState({
	title = "This didn't load",
	children,
	onRetry,
	className,
}: {
	title?: string;
	children?: ReactNode;
	onRetry?: () => void;
	className?: string;
}) {
	return (
		<div
			role="alert"
			className={cn(
				"flex flex-col items-start gap-4 border-t border-accent/40 py-12",
				className,
			)}
		>
			<h2 className="font-display text-display-md font-bold">{title}</h2>
			<div className="max-w-xl text-muted-foreground">
				{children ??
					"Discover couldn't reach its data just now. Try again in a moment."}
			</div>
			{onRetry && (
				<Button variant="outline" onClick={onRetry}>
					Try again
				</Button>
			)}
		</div>
	);
}

/** Placeholder blocks while something loads: announced once, invisible to readers otherwise. */
export function LoadingSkeleton({
	rows = 3,
	label = "Loading",
	className,
}: {
	rows?: number;
	label?: string;
	className?: string;
}) {
	return (
		<output aria-live="polite" className={cn("flex flex-col gap-3", className)}>
			<span className="sr-only">{label}…</span>
			{Array.from({ length: rows }, (_, index) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: identical placeholder rows.
					key={index}
					aria-hidden="true"
					className="h-16 animate-pulse rounded-[2px] bg-paper-sunk motion-reduce:animate-none"
				/>
			))}
		</output>
	);
}

/** The page for an address Discover doesn't have (the router's default). */
export function NotFoundState() {
	return (
		<PageContainer className="py-20 lg:py-32">
			<p className="eyebrow text-muted-foreground">404</p>
			<h1 className="mt-4 font-display text-display-xl font-bold">
				Nothing here
			</h1>
			<p className="mt-6 max-w-xl text-lg text-muted-foreground">
				This page doesn't exist, or it's no longer listed on Discover.
			</p>
			<Link
				to="/"
				className={cn(
					buttonVariants({ variant: "primary", size: "lg" }),
					"mt-10",
				)}
			>
				Back to Discover
			</Link>
		</PageContainer>
	);
}

/**
 * A page whose read failed (the router's default error component): a
 * temporary problem says so and offers a retry; nothing technical is shown.
 */
export function RouteErrorState({ error, reset }: ErrorComponentProps) {
	const router = useRouter();
	// The server's error arrives in the browser as a plain Error, so this
	// reads the marked message too (src/lib/api-errors.ts).
	const unavailable = isUnavailable(error);
	return (
		<PageContainer className="py-20 lg:py-32">
			<ErrorState
				title={
					unavailable
						? "Discover is unavailable for a moment"
						: "Something went wrong"
				}
				onRetry={() => {
					reset();
					router.invalidate();
				}}
			>
				{unavailable
					? "We couldn't reach the studios' data. Nothing is wrong on your side: try again in a moment."
					: "This page couldn't be shown. Try again, or go back to the start."}
			</ErrorState>
		</PageContainer>
	);
}

/**
 * A page Discover has planned but not built yet (D06–D09): says so plainly,
 * with somewhere real to go. Never a page that pretends to work.
 */
export function FoundationNotice({
	children,
	action,
}: {
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<PageContainer className="py-16 lg:py-24">
			<div
				role="note"
				className="flex max-w-2xl flex-col items-start gap-6 border-l-2 border-accent pl-6"
			>
				<p className="eyebrow text-accent">Coming soon</p>
				<div className="text-lg text-muted-foreground">{children}</div>
				{action}
			</div>
		</PageContainer>
	);
}
