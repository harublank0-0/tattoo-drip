import { Link } from "@inertiajs/react";
import { ArrowUpRight, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { urlFor } from "~/client";
import type { SelectedSession } from "~/components/calendar";
import { SESSION_KIND_LABELS } from "~/components/projects";
import SessionStatusBadge from "~/components/session_status_badge";
import {
	ACTION_LABELS,
	type SessionAction,
	sessionActions,
} from "~/components/sessions";
import { MoveForm, OutcomePanel } from "~/components/sessions_card";
import StatusBadge from "~/components/status_badge";
import { Button, buttonVariants } from "~/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "~/components/ui/sheet";
import { useTenant } from "~/hooks/use-tenant";

/**
 * The calendar's session drawer (Studio OS): from the right on a desktop
 * (28rem), the whole screen on a phone. Who and when, the project's brief
 * and status, and what this member may do there, which is the server's
 * (`selected.outcomes`, `selected.move`): done, no-show or cancel behind the
 * project page's own confirmation, and the project page's move form. Both
 * post to the sessions routes with `back`, so the server answers with this
 * calendar, refreshed and with the drawer closed; a refused move (another
 * session at that time) keeps the drawer open with the error under its
 * field. Radix moves focus into the drawer and back to the session that
 * opened it; Escape and the close button close it.
 */
export default function SessionDrawer({
	selected,
	back,
	onClose,
}: {
	selected: SelectedSession | null;
	/** This calendar without the drawer: where the forms send the member back to. */
	back: string;
	onClose: () => void;
}) {
	// Keep the last session while the drawer slides out, so it doesn't go blank.
	const shown = useRef(selected);
	if (selected) shown.current = selected;
	const session = shown.current;

	return (
		<Sheet open={selected !== null} onOpenChange={(open) => !open && onClose()}>
			<SheetContent
				side="right"
				overlayClassName="bg-background/30"
				className="w-full gap-0 p-0 sm:max-w-md lg:max-w-[28rem]"
			>
				{session && (
					<DrawerBody key={session.id} session={session} back={back} />
				)}
			</SheetContent>
		</Sheet>
	);
}

function DrawerBody({
	session,
	back,
}: {
	session: SelectedSession;
	back: string;
}) {
	const tenant = useTenant();
	const [open, setOpen] = useState<SessionAction | null>(null);
	const title = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (open === null) title.current?.focus();
	}, [open]);
	const { project } = session;
	const kind = SESSION_KIND_LABELS[session.kind] ?? session.kind;
	const actions = sessionActions(session.outcomes, session.move !== null);
	const name = project
		? (project.clientName ?? "Unknown client")
		: tenant.role === "owner"
			? "Project not available"
			: "Not assigned to you";

	return (
		<div className="flex min-h-full flex-col pt-[env(safe-area-inset-top)]">
			<header className="flex flex-col gap-2 border-b px-5 pt-5 pb-4 pr-14">
				<SheetTitle asChild>
					<h2
						ref={title}
						tabIndex={-1}
						className="text-lg leading-snug font-semibold wrap-anywhere outline-none"
					>
						{name}
					</h2>
				</SheetTitle>
				<SheetDescription className="text-sm text-muted-foreground">
					{session.whenText}
				</SheetDescription>
				<div className="flex flex-wrap items-center gap-2">
					<SessionStatusBadge status={session.status} />
					{project && (
						<StatusBadge
							status={project.status}
							className="text-xs py-0.5 px-2"
						/>
					)}
				</div>
			</header>

			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5 border-b px-5 py-4 text-sm">
				<dt className="text-muted-foreground">Session</dt>
				<dd>{kind}</dd>
				<dt className="text-muted-foreground">Length</dt>
				<dd className="tabular-nums">{session.lengthText}</dd>
				<dt className="text-muted-foreground">Artist</dt>
				<dd className="wrap-anywhere">
					{session.artistName ?? "Unknown artist"}
				</dd>
			</dl>

			{project?.brief && (
				<section aria-labelledby="drawer-brief" className="border-b px-5 py-4">
					<h3
						id="drawer-brief"
						className="pb-1.5 text-xs font-medium text-muted-foreground"
					>
						The piece
					</h3>
					<p className="text-sm whitespace-pre-line wrap-anywhere">
						{project.brief}
					</p>
				</section>
			)}

			{session.awaitingBooking && (
				<p className="border-b px-5 py-3 text-sm text-muted-foreground">
					Done waits for the booking: the project isn't booked yet.
				</p>
			)}

			{actions.length > 0 && (
				<section
					aria-label="Change this session"
					className="flex flex-col gap-3 border-b px-5 py-4"
				>
					{open === null ? (
						<div className="flex flex-wrap gap-2">
							{actions.map((action) => (
								<Button
									key={action}
									type="button"
									variant={action === "move" ? "default" : "outline"}
									size="sm"
									onClick={() => setOpen(action)}
								>
									{action === "move" ? "Reschedule" : ACTION_LABELS[action]}
								</Button>
							))}
						</div>
					) : open === "move" && session.move ? (
						<MoveForm
							sessionId={session.id}
							whenText={session.whenText}
							values={session.move}
							dates={session.dates}
							back={back}
							onCancel={() => setOpen(null)}
							onDone={() => setOpen(null)}
						/>
					) : open !== "move" ? (
						<OutcomePanel
							sessionId={session.id}
							outcome={open}
							whenText={session.whenText}
							back={back}
							onCancel={() => setOpen(null)}
							onDone={() => setOpen(null)}
						/>
					) : null}
				</section>
			)}

			{project && (
				<div className="mt-auto flex flex-wrap gap-2 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
					<Link
						href={`${urlFor("tenant.projects.show", { tenant: tenant.slug, id: project.id })}#sessions`}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						<ArrowUpRight aria-hidden="true" />
						Open project
					</Link>
					{project.clientId && (
						<Link
							href={urlFor("tenant.clients.show", {
								tenant: tenant.slug,
								id: project.clientId,
							})}
							className={buttonVariants({ variant: "ghost", size: "sm" })}
						>
							<UserRound aria-hidden="true" />
							View client
						</Link>
					)}
				</div>
			)}
		</div>
	);
}
