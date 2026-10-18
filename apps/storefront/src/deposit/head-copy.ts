/*
 * The words in the deposit page's head (TAT-65b): the title and description
 * a browser tab and a chat app's link preview show. They live apart from
 * copy.ts, which copy.ts carries whole (`...headCopy`), because the route's
 * head runs in the entry chunk of every page while the rest of the copy
 * belongs to the page's own lazy chunk: seo.ts imports only this file.
 * Nothing is imported here.
 */
export const headCopy = {
	title: "Pay your deposit",
	titleWithStudio: "Pay your deposit · {studio}",
	description: "Pay your deposit, then send a screenshot of the payment.",
	descriptionWithStudio:
		"Pay your deposit to {studio}, then send a screenshot of the payment.",
} as const;
