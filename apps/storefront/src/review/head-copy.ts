/*
 * The words in the review page's head: the title and description a browser
 * tab and a chat app's link preview show (the preview is fetched without the
 * fragment, so it names only the studio). seo.ts imports only this file.
 */
export const headCopy = {
	title: "Your tattoo review",
	titleWithStudio: "Your tattoo review · {studio}",
	description: "Tell the studio how your tattoo healed, and show it off.",
	descriptionWithStudio:
		"Tell {studio} how your tattoo healed, and show it off.",
} as const;
