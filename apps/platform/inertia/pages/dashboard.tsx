import { LayoutGrid } from "lucide-react";
import Page from "~/components/page";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";
import AppLayout from "~/layouts/app";

export default function Dashboard() {
	return (
		<Page title="Dashboard" hideTitle>
			<Empty className="flex-1">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<LayoutGrid />
					</EmptyMedia>
					<EmptyTitle>Your dashboard is ready</EmptyTitle>
					<EmptyDescription>
						It&apos;s empty on purpose. A clean starting point with nothing to
						undo. Add your first route and component to begin.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<p className="text-sm text-muted-foreground">
						Start in{" "}
						<code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
							inertia/pages/dashboard.tsx
						</code>
					</p>
				</EmptyContent>
			</Empty>
		</Page>
	);
}

Dashboard.layout = [AppLayout];
