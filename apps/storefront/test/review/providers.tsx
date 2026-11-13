import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TattooProvider, tattooKeys } from "@tattoo-drip/react";
import type { ReviewPage, TattooClient } from "@tattoo-drip/sdk";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `element` rendered as the page renders it once the review page of `token`
 * has been read: `page` is already in the query's cache, so nothing is fetched.
 */
export function renderWithReview(
	client: TattooClient,
	token: string,
	page: ReviewPage,
	element: ReactElement,
): string {
	const queryClient = new QueryClient();
	queryClient.setQueryData(tattooKeys.review(client.tenant, token), page);
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<TattooProvider client={client}>{element}</TattooProvider>
		</QueryClientProvider>,
	);
}
