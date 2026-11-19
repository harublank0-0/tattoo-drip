import { Star } from "lucide-react";

/**
 * Five stars, `rating` of them filled. With a `label` ("4 out of 5") a
 * screen reader hears it once, as text; without one the stars are
 * decoration beside words that already say it (the average's line).
 */
export function ReviewStars({
	rating,
	label,
}: {
	rating: number;
	label: string | null;
}) {
	const stars = (
		<span className="client-review-stars-row" aria-hidden="true">
			{[1, 2, 3, 4, 5].map((n) => (
				<Star
					key={n}
					data-on={n <= rating ? "" : undefined}
					fill={n <= rating ? "currentColor" : "none"}
					strokeWidth={1.75}
				/>
			))}
		</span>
	);
	if (label === null)
		return <span className="client-review-stars">{stars}</span>;
	return (
		<span className="client-review-stars">
			<span className="sr-only">{label}</span>
			{stars}
		</span>
	);
}
