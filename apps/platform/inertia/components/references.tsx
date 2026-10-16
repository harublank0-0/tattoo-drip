import type { ReferenceProps } from "~/components/inquiries";

/**
 * The client's reference images as a thumbnail grid; each opens the full
 * image in a new tab. The URLs are signed for a few minutes, so reload the
 * page to view them later.
 */
export default function ReferenceGrid({
	references,
}: {
	references: ReferenceProps[];
}) {
	if (references.length === 0) {
		return <p className="text-sm text-muted-foreground">No references.</p>;
	}
	return (
		<ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
			{references.map((reference, index) => (
				<li key={reference.id}>
					<a href={reference.url} target="_blank" rel="noreferrer">
						<img
							src={reference.url}
							alt={`Reference ${index + 1}`}
							loading="lazy"
							className="aspect-square w-full rounded-md border object-cover"
						/>
					</a>
				</li>
			))}
		</ul>
	);
}
