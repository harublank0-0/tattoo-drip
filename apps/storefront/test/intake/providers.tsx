import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TattooProvider } from "@tattoo-drip/react";
import type { TattooClient } from "@tattoo-drip/sdk";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** `element` rendered as the page renders it: inside the query and SDK providers. */
export function renderWithProviders(
	client: TattooClient,
	element: ReactElement,
): string {
	return renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<TattooProvider client={client}>{element}</TattooProvider>
		</QueryClientProvider>,
	);
}
