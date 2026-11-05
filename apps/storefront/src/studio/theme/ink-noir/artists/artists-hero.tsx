import { Lines } from "../home/parts.tsx";
import { inkNoirArtistsCopy } from "./copy.ts";

const copy = inkNoirArtistsCopy.hero;

/**
 * The directory's opening: the label and an oversized headline on the left,
 * the description set lower on the right (beneath it on a phone), over a
 * hairline. The page's one h1. Singular for a studio of one.
 */
export function ArtistsHero({ one }: { one: boolean }) {
	const count = one ? "one" : "many";
	return (
		<header className="ink-dir-hero">
			<div className="ink-container ink-dir-hero-grid">
				<p className="ink-label">{copy.label[count]}</p>
				<h1 className="ink-dir-title">
					<Lines lines={copy.lines[count]} />
				</h1>
				<p className="ink-dir-lede">{copy.description[count]}</p>
			</div>
		</header>
	);
}
