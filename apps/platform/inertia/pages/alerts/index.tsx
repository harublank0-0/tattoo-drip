import { Form } from "@adonisjs/inertia/react";
import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { urlFor } from "~/client";
import { emptyAlertsText } from "~/components/alerts";
import Page from "~/components/page";
import { Button, buttonVariants } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

type AlertRow = {
	id: string;
	title: string;
	detail: string;
	whenText: string;
	unread: boolean;
};

/**
 * The member's alerts (TAT-52), newest first. Opening one marks it read and
 * goes to its inquiry (owners) or stays here.
 */
export default function AlertsIndex({
	alerts,
	unread,
	page,
}: {
	alerts: AlertRow[];
	unread: number;
	page: { current: number; last: number; total: number };
}) {
	const tenant = useTenant();
	const base = urlFor("tenant.alerts.index", { tenant: tenant.slug });
	const href = (pageNumber: number) =>
		pageNumber > 1 ? `${base}?page=${pageNumber}` : base;

	return (
		<Page
			title="Alerts"
			actions={
				unread > 0 ? (
					<Form
						route="tenant.alerts.read"
						routeParams={{ tenant: tenant.slug }}
					>
						{({ processing }) => (
							<Button
								type="submit"
								variant="outline"
								className="h-11"
								disabled={processing}
							>
								{processing ? "Marking…" : "Mark all as read"}
							</Button>
						)}
					</Form>
				) : undefined
			}
		>
			{alerts.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{emptyAlertsText(page.total)}
				</p>
			) : (
				<ul className="flex max-w-2xl flex-col divide-y rounded-md border">
					{alerts.map((alert) => (
						<li key={alert.id}>
							<Link
								href={urlFor("tenant.alerts.open", {
									tenant: tenant.slug,
									id: alert.id,
								})}
								method="post"
								as="button"
								className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50"
							>
								<span
									aria-hidden="true"
									className={cn(
										"mt-1.5 size-2 shrink-0 rounded-full",
										alert.unread ? "bg-primary" : "bg-transparent",
									)}
								/>
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span
										className={cn("text-sm", alert.unread && "font-semibold")}
									>
										{alert.title}
										{alert.unread && <span className="sr-only"> (Unread)</span>}
									</span>
									<span className="text-sm text-muted-foreground">
										{alert.detail}
									</span>
									<span className="text-xs text-muted-foreground">
										{alert.whenText}
									</span>
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}

			{(page.last > 1 || page.current > 1) && (
				<nav aria-label="Pages" className="flex justify-between gap-3 text-sm">
					{page.current > 1 ? (
						<Link
							href={href(page.current - 1)}
							className={cn(buttonVariants({ variant: "outline" }), "h-11")}
						>
							Previous
						</Link>
					) : (
						<span />
					)}
					{page.current < page.last ? (
						<Link
							href={href(page.current + 1)}
							className={cn(buttonVariants({ variant: "outline" }), "h-11")}
						>
							Next
						</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</Page>
	);
}

AlertsIndex.layout = [AppLayout];
