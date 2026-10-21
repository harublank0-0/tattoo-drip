import { Link } from "@adonisjs/inertia/react";
import { cn } from "cn";
import { Circle, CircleCheck } from "lucide-react";
import type { SetupProps, SetupStepKey } from "~/components/studio_link";
import { Badge } from "~/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { useTenant } from "~/hooks/use-tenant";

const COPY: Record<SetupStepKey, { title: string; hint: string }> = {
	artists: {
		title: "Add your artists",
		hint: "Each artist gets their own photo, bio and link.",
	},
	payments: {
		title: "Add a payment QR code",
		hint: "Clients pay their deposit from your page.",
	},
	policy: {
		title: "Write your deposit policy",
		hint: "Tell clients what the deposit covers.",
	},
	inquiry: {
		title: "Share your studio link",
		hint: "Put it in your Instagram bio. This ticks when the first request arrives.",
	},
};

/** Where each step is done; the last one opens the studio page instead. */
const LINKS = {
	artists: "tenant.artists.create",
	payments: "tenant.settings.payments.create",
	policy: "tenant.settings.payments",
} as const;

const ROW = "flex min-h-11 items-center gap-3 px-3 py-2";

/**
 * The new-studio checklist (TAT-101): four steps, the first open one
 * highlighted and marked "Next". Done steps are ticked with a check icon
 * and read "done" to a screen reader, so colour is never the only signal.
 * Each step is a link to where it gets done; the last opens the studio page.
 */
export default function SetupChecklist({
	setup,
	studioUrl,
}: {
	setup: SetupProps;
	studioUrl: string;
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };

	return (
		<Card>
			<CardHeader>
				<CardTitle>Set up your studio</CardTitle>
				<CardDescription>
					{setup.doneCount} of {setup.total} done
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ol className="flex flex-col gap-2">
					{setup.steps.map(({ key, done, next }) => {
						const { title, hint } = COPY[key];
						const Icon = done ? CircleCheck : Circle;
						const body = (
							<>
								<Icon
									aria-hidden="true"
									className={cn(
										"size-5 shrink-0",
										done ? "text-primary" : "text-muted-foreground",
									)}
								/>
								<span className="flex min-w-0 flex-1 flex-col">
									<span
										className={cn(
											"text-sm font-medium",
											done && "text-muted-foreground",
										)}
									>
										{title}
										{done && <span className="sr-only"> (done)</span>}
									</span>
									<span className="text-sm text-muted-foreground">{hint}</span>
								</span>
								{next && <Badge>Next</Badge>}
							</>
						);
						const className = cn(
							ROW,
							"rounded-md border hover:bg-accent",
							next && "border-primary bg-accent",
						);
						return (
							<li key={key} aria-current={next ? "step" : undefined}>
								{key === "inquiry" ? (
									<a
										href={studioUrl}
										target="_blank"
										rel="noreferrer"
										className={className}
									>
										{body}
									</a>
								) : (
									<Link
										route={LINKS[key]}
										routeParams={params}
										className={className}
									>
										{body}
									</Link>
								)}
							</li>
						);
					})}
				</ol>
			</CardContent>
		</Card>
	);
}
