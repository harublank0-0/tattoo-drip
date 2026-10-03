import { ArrowRight, ArrowUpRight } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { portfolio, type TattooProject } from "#/data/mock/portfolio";

function Project({ project }: { project: TattooProject }) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<button
					type="button"
					className="work-tile group"
					aria-label={`View ${project.title}, ${project.style}`}
					style={{ aspectRatio: project.aspectRatio }}
				>
					<img
						src={project.image}
						alt={project.alt}
						width={900}
						height={1200}
						loading="lazy"
						decoding="async"
						className="size-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-[1.025]"
					/>
					<span className="work-caption">
						<span>
							<span className="block font-display text-3xl">
								{project.title}
							</span>
							<span className="mt-1 block text-[9px] uppercase tracking-[0.17em] text-muted-foreground">
								{project.style}
							</span>
						</span>
						<ArrowUpRight className="size-5" aria-hidden="true" />
					</span>
				</button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>{project.title}</DialogTitle>
					<DialogDescription>
						{project.style} · {project.placement} · Custom work
					</DialogDescription>
				</DialogHeader>
				<img
					src={project.image}
					alt={project.alt}
					width={900}
					height={1200}
					className="max-h-[55svh] w-full bg-secondary object-contain"
				/>
				<p className="text-sm leading-relaxed text-muted-foreground">
					{project.description}
				</p>
			</DialogContent>
		</Dialog>
	);
}

export function FeaturedWork() {
	return (
		<section
			id="work"
			className="page-container pb-24 md:pb-36"
			aria-labelledby="work-title"
		>
			<div className="section-heading reveal">
				<div>
					<h2 id="work-title" className="section-title">
						Selected work<span className="text-accent">.</span>
					</h2>
					<p className="mt-4 text-sm text-muted-foreground">
						A selection of recent pieces.
					</p>
				</div>
				<span className="eyebrow text-muted-foreground">On skin / 2025—26</span>
			</div>
			<div className="portfolio-grid">
				{portfolio.map((project) => (
					<div className="portfolio-item reveal" key={project.id}>
						<Project project={project} />
					</div>
				))}
			</div>
			<div className="mt-12 flex justify-center">
				<Dialog>
					<DialogTrigger asChild>
						<button type="button" className="text-link">
							View all work
							<ArrowRight className="size-4" aria-hidden="true" />
						</button>
					</DialogTrigger>
					<DialogContent className="sm:max-w-5xl">
						<DialogHeader>
							<DialogTitle>The portfolio</DialogTitle>
							<DialogDescription>
								Six individual stories, made permanent. A collection of custom
								pieces from 2025–26.
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-10 sm:grid-cols-2">
							{portfolio.map((project) => (
								<figure key={project.id}>
									<img
										src={project.image}
										alt={project.alt}
										width={900}
										height={1200}
										loading="lazy"
										className="aspect-[4/5] w-full bg-secondary object-cover"
									/>
									<figcaption className="mt-4">
										<h3 className="font-display text-3xl">{project.title}</h3>
										<p className="eyebrow mt-2 text-accent">
											{project.style} / {project.placement}
										</p>
										<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
											{project.description}
										</p>
									</figcaption>
								</figure>
							))}
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</section>
	);
}
