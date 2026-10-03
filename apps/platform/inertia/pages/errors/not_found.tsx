import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import MarketingLayout from "~/layouts/marketing";

export default function NotFound() {
	return (
		<div className="flex min-h-svh flex-col items-center justify-center px-6 pt-26 pb-14">
			<Card className="w-full max-w-[580px]">
				<CardHeader className="gap-5">
					<Badge variant="outline">404</Badge>
					<h1 className="flex flex-col font-serif text-3xl leading-tight text-balance sm:text-4xl">
						<span>Not found.</span>
						<em className="text-muted-foreground">
							That route hasn&apos;t been built yet.
						</em>
					</h1>
				</CardHeader>
				<CardContent className="text-sm leading-relaxed text-muted-foreground">
					The page you tried to reach doesn&apos;t exist. Check the URL or head
					back home.
				</CardContent>
			</Card>
		</div>
	);
}

NotFound.layout = [MarketingLayout];
