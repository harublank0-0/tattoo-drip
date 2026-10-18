import { isAllowedHref, linkRel } from "../links.ts";
import type { StudioView } from "../view-model.ts";

/**
 * The studio's links and street address (TAT-48). Nothing when the studio
 * has set neither. Every href comes from the view model and is checked once
 * more here.
 */
export function ContactBlock({ studio }: { studio: StudioView }) {
	const links = studio.links.filter((link) => isAllowedHref(link.href));
	const address =
		studio.address && isAllowedHref(studio.address.mapsHref)
			? studio.address
			: null;
	if (links.length === 0 && !address) return null;
	return (
		<address className="contact">
			{links.length > 0 ? (
				<ul className="links" aria-label="Contact and social links">
					{links.map((link) => (
						<li key={`${link.kind}:${link.href}`}>
							<a
								className="link-chip"
								href={link.href}
								rel={linkRel(link.href)}
							>
								{link.label}
							</a>
						</li>
					))}
				</ul>
			) : null}
			{address ? (
				<div className="street">
					<p className="user-text" dir="auto">
						{address.text}
					</p>
					<a
						className="text-link"
						href={address.mapsHref}
						rel={linkRel(address.mapsHref)}
					>
						Open in Google Maps
					</a>
				</div>
			) : null}
		</address>
	);
}
