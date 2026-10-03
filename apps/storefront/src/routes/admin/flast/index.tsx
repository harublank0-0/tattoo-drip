import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/flast/")({
	component: RouteComponent,
});

function RouteComponent() {
	return <div>Hello "/admin/flast/"!</div>;
}
