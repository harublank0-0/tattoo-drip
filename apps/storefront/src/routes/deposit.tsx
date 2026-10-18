import { createFileRoute } from "@tanstack/react-router";
import { DepositScreen } from "../deposit/components/deposit-screen.tsx";
import { loadDepositShell } from "../deposit/loader.ts";
import { DEPOSIT_PAGE_HEADERS, depositHead } from "../deposit/seo.ts";

/**
 * The deposit page (TAT-65b): `/deposit#<token>`, the link an owner sends
 * (TAT-65). The server renders only the shell, from the studio the lookup
 * cached; the deposit loads in the browser (DepositScreen), because the
 * token is in the fragment, which no server sees. Never stored, never
 * indexed, no Referer.
 */
export const Route = createFileRoute("/deposit")({
	loader: ({ context }) => loadDepositShell(context),
	head: ({ loaderData }) => depositHead(loaderData?.studioName ?? null),
	headers: () => ({ ...DEPOSIT_PAGE_HEADERS }),
	component: DepositRoute,
});

function DepositRoute() {
	return <DepositScreen shell={Route.useLoaderData()} />;
}
