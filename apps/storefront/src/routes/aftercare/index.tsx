import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/aftercare/")({
	component: RouteComponent,
});

function RouteComponent() {
	return <div>Hello "/aftercare/"!</div>;
}
