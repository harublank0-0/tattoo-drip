import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TattooProvider, tattooKeys } from "@tattoo-drip/react";
import type { DepositPage, TattooClient } from "@tattoo-drip/sdk";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `element` rendered as the page renders it once the deposit of `token` has
 * been read: `page` is already in the query's cache, so nothing is fetched.
 */
export function renderWithDeposit(
	client: TattooClient,
	token: string,
	page: DepositPage,
	element: ReactElement,
): string {
	const queryClient = new QueryClient();
	queryClient.setQueryData(tattooKeys.deposit(client.tenant, token), page);
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<TattooProvider client={client}>{element}</TattooProvider>
		</QueryClientProvider>,
	);
}
