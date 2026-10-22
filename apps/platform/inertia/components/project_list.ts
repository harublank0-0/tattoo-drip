import type { ProjectListProps, ProjectRow } from "~/components/projects";

/**
 * The Projects list's words and links (TAT-109). Plain: the unit tests load
 * this file. The server decides the rows, their order and every word of a row
 * (`ProjectsController.index`, `#modules/projects/project_list`); this holds
 * only what the page adds: its links, the card's fallback line and meta, the
 * empty sentences and the table's caption.
 */

/** The title of the clients' side, as Today names it. */
export const ON_CLIENT_TITLE = "Waiting on clients";

/** The two sorts of an open view, as the switch and the table headers name them. */
export const SORT_LABELS = {
	needs: "What needs you",
	contact: "Last contact",
} as const;

/** What a list address carries; defaults are left out of the URL. */
export type ListQuery = {
	status?: string;
	waiting?: string | null;
	sort?: ProjectListProps["sort"];
	page?: number;
};

/**
 * The address of a view. A waiting view needs only itself (the server puts it
 * under its chip); the default sort and the first page are not written.
 */
export function listHref(base: string, query: ListQuery): string {
	const parts: string[] = [];
	if (query.waiting) parts.push(`waiting=${query.waiting}`);
	else if (query.status) parts.push(`status=${query.status}`);
	if (query.sort === "contact") parts.push("sort=contact");
	if (query.page && query.page > 1) parts.push(`page=${query.page}`);
	return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
}

/** A card's one line: what waits, else the next session, else nothing. */
export function cardLine(
	row: Pick<ProjectRow, "line" | "nextSessionText">,
): NonNullable<ProjectRow["line"]> | null {
	if (row.line) return row.line;
	if (row.nextSessionText) {
		return {
			text: `Next session ${row.nextSessionText}`,
			needsYou: false,
			hash: null,
		};
	}
	return null;
}

/**
 * A card's last line: the artist for an owner, and the last contact in the
 * contact sort (where it is the sort key). Nothing says "never contacted".
 */
export function cardMeta(
	row: Pick<ProjectRow, "artistName" | "contactedText">,
	{ isOwner, sort }: { isOwner: boolean; sort: ProjectListProps["sort"] },
): string | null {
	const parts: string[] = [];
	if (isOwner)
		parts.push(row.artistName ? `With ${row.artistName}` : "No artist yet");
	if (sort === "contact") parts.push(row.contactedText ?? "No contact yet");
	return parts.length > 0 ? parts.join(" · ") : null;
}

/** What an empty view says, in place of the cards and the table. */
export function emptyListText({
	filter,
	waiting,
	isOwner,
	page,
}: {
	filter: string;
	waiting: string | null;
	isOwner: boolean;
	page: { current: number; last: number };
}): string {
	if (page.current > page.last) return "There's nothing on this page.";
	if (waiting) return "Nothing left here.";
	if (filter === "needs_you") {
		return isOwner
			? "Nothing needs you right now. A project shows up here when it needs a price, a deposit link or a session."
			: "Nothing needs you right now. Your projects show up here when they need a price or a session.";
	}
	if (filter === "active") {
		return isOwner
			? "No projects yet. Accept a request in the Inbox or book a session, and it shows up here."
			: "No projects for you yet. They show up here when the studio gives you one.";
	}
	if (filter === "closed") return "No closed projects yet.";
	return "No projects here right now.";
}

/** The table's caption (read to a screen reader): how the rows are ordered. */
export function tableCaption(
	view: Pick<ProjectListProps, "filter" | "waiting" | "sort">,
	title: string | null,
): string {
	if (view.waiting) return `${title ?? "Projects"}, the longest wait first`;
	if (view.filter === "needs_you")
		return "What needs you, the longest wait first";
	if (view.sort === null) return "Closed projects, the latest change first";
	return view.sort === "contact"
		? "Your projects, the longest since last contact first"
		: "Your projects, what needs you first";
}

/** The way back from a waiting view: the chip it sits under. */
export function backLink(waiting: string): { label: string; status: string } {
	return waiting === "on_client"
		? { label: "Show all active projects", status: "active" }
		: { label: "Show all that needs you", status: "needs_you" };
}
