import { ArrowUpRight } from "lucide-react";
import { specialties } from "#/data/mock/artist";

export function Specialties() {
	return (
		<section
			className="border-y border-border bg-secondary/40"
			aria-labelledby="specialties-title"
		>
			<div className="page-container section-space grid gap-10 md:grid-cols-[1fr_2fr] md:gap-16">
				<div>
					<h2 id="specialties-title" className="eyebrow text-muted-foreground">
						Specialties
					</h2>
					<p className="mt-5 max-w-48 font-display text-2xl text-muted-foreground">
						Different expressions.
						<br />
						The same intention.
					</p>
				</div>
				<div>
					{specialties.map((specialty, index) => (
						<details
							key={specialty.name}
							name="specialties"
							className="specialty group"
						>
							<summary>
								<span className="eyebrow text-muted-foreground">
									0{index + 1}
								</span>
								<span className="specialty-name">{specialty.name}</span>
								<ArrowUpRight
									className="ml-auto size-5 shrink-0 transition-transform group-open:rotate-90"
									aria-hidden="true"
								/>
							</summary>
							<div className="pb-7 pl-10 sm:pl-14">
								<p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
									{specialty.description}
								</p>
								<a href="#booking" className="text-link mt-5">
									Discuss a piece
									<ArrowUpRight className="size-3.5" aria-hidden="true" />
								</a>
							</div>
						</details>
					))}
				</div>
			</div>
		</section>
	);
}
