import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import MarketingLayout from "~/layouts/marketing";

export default function ServerError() {
	return (
		<div className="flex min-h-svh flex-col items-center justify-center px-6 pt-26 pb-14">
			<Card className="w-full max-w-[580px]">
				<CardHeader className="gap-5">
					<Badge variant="destructive">500</Badge>
					<h1 className="flex flex-col font-serif text-3xl leading-tight text-balance sm:text-4xl">
						<span>Something broke.</span>
						<em className="text-muted-foreground">
							The server hit an unexpected error.
						</em>
					</h1>
				</CardHeader>
				<CardContent className="text-sm leading-relaxed text-muted-foreground">
					Try again in a moment. If the problem persists, check the server logs
					for the underlying exception.
				</CardContent>
			</Card>
		</div>
	);
}

ServerError.layout = [MarketingLayout];
