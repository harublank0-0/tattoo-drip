import { ArrowUpRight, Menu } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "#/components/ui/sheet";
import { artist } from "#/data/mock/artist";
import { navigation } from "./navigation";

export function MobileNav() {
	return (
		<div className="md:hidden">
			<Sheet>
				<SheetTrigger asChild>
					<Button variant="ghost" size="icon-lg" aria-label="Open navigation">
						<Menu aria-hidden="true" />
					</Button>
				</SheetTrigger>
				<SheetContent className="w-[min(90vw,26rem)] overflow-y-auto p-6">
					<SheetHeader className="px-0 pt-12">
						<SheetTitle>{artist.studio}</SheetTitle>
						<SheetDescription>
							Independent tattoo artist · {artist.location}
						</SheetDescription>
					</SheetHeader>
					<nav
						aria-label="Mobile navigation"
						className="flex flex-col gap-2 py-10"
					>
						{navigation.map((item) => (
							<SheetClose key={item.label} asChild>
								<a
									href={item.href}
									className="group flex items-center justify-between py-3 font-display text-5xl transition-colors hover:text-accent"
								>
									{item.label}
									<ArrowUpRight className="size-5" aria-hidden="true" />
								</a>
							</SheetClose>
						))}
					</nav>
					<SheetFooter className="px-0">
						<a className="text-link" href={artist.instagramUrl}>
							{artist.instagram}
							<ArrowUpRight className="size-4" aria-hidden="true" />
						</a>
					</SheetFooter>
				</SheetContent>
			</Sheet>
		</div>
	);
}
