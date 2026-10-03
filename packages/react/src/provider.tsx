import type { TattooClient } from "@tattoo-drip/sdk";
import { createContext, type ReactNode, useContext } from "react";

const TattooClientContext = createContext<TattooClient | null>(null);

export interface TattooProviderProps {
	client: TattooClient;
	children: ReactNode;
}

/**
 * Makes a client available to the hooks. The app owns the TanStack Query
 * `QueryClientProvider`; render this inside it.
 */
export function TattooProvider({ client, children }: TattooProviderProps) {
	return (
		<TattooClientContext.Provider value={client}>
			{children}
		</TattooClientContext.Provider>
	);
}

export function useTattooClient(): TattooClient {
	const client = useContext(TattooClientContext);
	if (!client) {
		throw new Error("useTattooClient must be used inside <TattooProvider>.");
	}
	return client;
}
