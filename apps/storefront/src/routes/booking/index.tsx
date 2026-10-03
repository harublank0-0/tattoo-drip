import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/booking/")({
	component: RouteComponent,
});

function RouteComponent() {
	return <div>Hello "/booking/"!</div>;
}
