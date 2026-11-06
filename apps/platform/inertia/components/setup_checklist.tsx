import { Link } from "@adonisjs/inertia/react";
import { cn } from "cn";
import { Circle, CircleCheck } from "lucide-react";
import type { SetupProps, SetupStepKey } from "~/components/studio_link";
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

const ROW =
	"flex min-h-11 items-center gap-3 px-4 py-3 outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset";

/**
 * The new-studio checklist (TAT-101): four steps, the first open one
 * highlighted and marked "Next". Done steps are ticked with a check icon
 * and read "done" to a screen reader, so colour is never the only signal.
 * Each step is a link to where it gets done; the last opens the studio page.
 * Studio OS: one titled section with the steps as a single list, split by
 * hairlines, the next step raised and named "Next" in words.
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
		<section aria-labelledby="setup-title" className="flex flex-col gap-3">
			<header className="flex min-h-8 items-center gap-2">
				<h2 id="setup-title" className="text-base leading-snug font-semibold">
					Set up your studio
				</h2>
				<span className="text-sm text-muted-foreground tabular-nums">
					{setup.doneCount} of {setup.total} done
				</span>
			</header>
			<div className="overflow-hidden rounded-lg border bg-card">
				<ol className="flex flex-col divide-y">
					{setup.steps.map(({ key, done, next }) => {
						const { title, hint } = COPY[key];
						const Icon = done ? CircleCheck : Circle;
						const body = (
							<>
								<Icon
									aria-hidden="true"
									className={cn(
										"size-5 shrink-0",
										done ? "text-brand-text" : "text-muted-foreground",
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
								{next && (
									<span className="shrink-0 text-xs font-semibold text-brand-text">
										Next
									</span>
								)}
							</>
						);
						const className = cn(ROW, next && "bg-accent/60");
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
			</div>
		</section>
	);
}
