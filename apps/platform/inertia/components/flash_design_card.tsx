import {
	FLASH_CARD_HIDDEN,
	type FlashCardProps,
	flashCardLine,
} from "~/components/flash";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

/**
 * The flash design a request or a project names (TAT-129), on the inquiry
 * page and the project page: its picture (a link to the large copy), its name
 * and its artist, size and price. A design the studio hid since is still
 * shown here, marked: the request names it.
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
				</div>
			</CardContent>
		</Card>
	);
}
