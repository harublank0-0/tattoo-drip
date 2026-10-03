import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/portfolio/")({
	component: RouteComponent,
});

function RouteComponent() {
	return <div>Hello "/admin/portfolio/"!</div>;
}
