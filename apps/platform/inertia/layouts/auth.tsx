import type { ReactNode } from "react";
import FlashToasts from "~/components/flash_toasts";
import Logo from "~/components/logo";
import ThemeToggle from "~/components/theme_toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
	return (
		<>
			<div className="grid min-h-svh min-[880px]:grid-cols-[1.04fr_1fr]">
				<div className="flex flex-col bg-card px-6 py-7 sm:px-9">
					<div className="flex items-center justify-between">
						<Logo />
						<div className="min-[880px]:hidden">
							<ThemeToggle />
						</div>
					</div>
					<div className="m-auto flex w-full max-w-sm flex-col gap-6 py-5">
						{children}
					</div>
				</div>

				<aside className="hidden flex-col justify-between border-l bg-muted p-11 min-[880px]:flex">
					<div className="flex justify-end">
						<ThemeToggle />
					</div>

					<p className="max-w-[22ch] font-serif text-2xl leading-snug text-balance">
						Inquiries, quotes and deposits for your studio, in one place.
					</p>

					<p className="max-w-sm text-sm text-muted-foreground">
						Tattoo Drip turns your booking link into complete inquiries, then
						helps you quote, take the deposit and book the session.
					</p>
				</aside>
			</div>
			<FlashToasts />
		</>
	);
}
