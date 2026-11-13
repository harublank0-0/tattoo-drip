import type { ReactNode } from "react";
import { Star } from "./ornaments.tsx";

/**
 * The opening of a page that is not the home page: a fixed label, the page's
 * h1 large in the display face between two stars (decoration), and a line
 * under it. `titleId` names the h1 when something points at it (the booking
 * page's form).
 */
export function PageHead({
	label,
	title,
	line,
	titleId,
}: {
	label: string;
	title: ReactNode;
	line?: ReactNode;
	titleId?: string;
}) {
	return (
		<header className="fp-page-head">
			<div className="fp-container">
				<p className="fp-kicker">{label}</p>
				<div className="fp-page-title-row">
					<Star tone="red" className="fp-page-star" />
					<h1 id={titleId} className="fp-page-title">
						{title}
					</h1>
					<Star tone="green" className="fp-page-star" />
				</div>
				{line ? <p className="fp-page-line">{line}</p> : null}
			</div>
		</header>
	);
}
