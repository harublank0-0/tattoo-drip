import type { ReactNode } from "react";
import FlashToasts from "~/components/flash_toasts";
import Logo from "~/components/logo";
import ThemeToggle from "~/components/theme_toggle";
import { Button } from "~/components/ui/button";

export default function AuthLayout({ children }: { children: ReactNode }) {
	return (
		<>
			<div className="grid min-h-svh min-[880px]:grid-cols-[1.04fr_1fr]">
				<div className="flex flex-col bg-card px-6 py-7 sm:px-9">
					<div className="flex items-center justify-between">
						<Logo size={28} />
						<div className="min-[880px]:hidden">
							<ThemeToggle />
						</div>
					</div>
					<div className="m-auto flex w-full max-w-sm flex-col gap-6 py-5">
						{children}
					</div>
				</div>

				<aside className="hidden flex-col justify-between border-l bg-muted/40 p-11 min-[880px]:flex">
					<div className="flex justify-end">
						<ThemeToggle />
					</div>

					<p className="max-w-[22ch] font-serif text-2xl leading-snug text-balance">
						Auth, kept intentionally minimal so you can build it your way.
					</p>

					<div className="flex flex-col gap-2">
						<p className="text-sm font-medium">
							Looking for production-ready auth?
						</p>
						<p className="max-w-sm text-sm text-muted-foreground">
							Check out Feature packs, production-ready full-stack components
							from the creator of AdonisJS.
						</p>
						<Button asChild variant="link" className="self-start px-0">
							<a
								href="https://plus.adonisjs.com/feature-packs"
								target="_blank"
								rel="noreferrer"
							>
								Explore Feature packs →
							</a>
						</Button>
					</div>
				</aside>
			</div>
			<FlashToasts />
		</>
	);
}
