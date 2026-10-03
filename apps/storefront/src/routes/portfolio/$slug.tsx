import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/portfolio/$slug")({
	component: RouteComponent,
});

function RouteComponent() {
	return <div>Hello "/portfolio/$slug"!</div>;
}
