import {
	CLAIMED_HERE,
	FLASH_CARD_HIDDEN,
	type FlashCardProps,
	flashCardLine,
	TAKEN_LABEL,
} from "~/components/flash";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

/**
 * The flash design a request or a project names (TAT-129), on the inquiry
 * page and the project page: its picture (a link to the large copy), its name
 * and its artist, size and price. A design the studio hid since is still
 * shown here, marked: the request names it. A one-of-a-kind design someone
 * else claimed is marked "Design taken: offer something similar" while the
 * request or project is open (nothing is cancelled for it), and the project
 * that claimed it says so.
 */
export default function FlashDesignCard({ flash }: { flash: FlashCardProps }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Flash design</CardTitle>
			</CardHeader>
			<CardContent className="flex gap-3">
				<a
					href={flash.imageUrl}
					target="_blank"
					rel="noreferrer"
					className="shrink-0"
				>
					<img
						src={flash.thumbnailUrl}
						alt={flash.name}
						width={96}
						height={96}
						decoding="async"
						className="size-24 rounded-md border bg-muted object-contain"
					/>
				</a>
				<div className="flex min-w-0 flex-col gap-1 text-sm">
					<p className="font-medium wrap-anywhere" dir="auto">
						{flash.name}
					</p>
					<p className="text-muted-foreground wrap-anywhere">
						{flashCardLine(flash)}
					</p>
					{flash.hidden && (
						<p className="text-muted-foreground">{FLASH_CARD_HIDDEN}</p>
					)}
					{flash.claim === "taken" && (
						<Badge variant="secondary" className="h-auto whitespace-normal">
							{TAKEN_LABEL}
						</Badge>
					)}
					{flash.claim === "here" && (
						<Badge variant="secondary">{CLAIMED_HERE}</Badge>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
