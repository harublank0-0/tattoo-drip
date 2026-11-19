import { router } from "@inertiajs/react";
import { useRef } from "react";
import { urlFor } from "~/client";
import InlineConfirm from "~/components/inline_confirm";
import type { ReferenceProps } from "~/components/inquiries";
import { useTenant } from "~/hooks/use-tenant";

/**
 * The client's reference images as a thumbnail grid (the 320 px copy, never
 * the full-size file: ui.md); each opens the full image in a new tab. The
 * URLs are signed for a few minutes, so reload the page to view them later.
 * An owner may delete one, to free the studio's storage (the storage
 * meter); the server allows owners only.
 */
export default function ReferenceGrid({
	references,
}: {
	references: ReferenceProps[];
}) {
	const tenant = useTenant();
	// Where focus goes once a deleted photo's button is gone.
	const grid = useRef<HTMLUListElement>(null);
	if (references.length === 0) {
		return <p className="text-sm text-muted-foreground">No references.</p>;
	}
	const owner = tenant.role === "owner";
	return (
		<ul
			ref={grid}
			tabIndex={-1}
			className="grid grid-cols-3 gap-2 outline-none sm:grid-cols-4"
		>
			{references.map((reference, index) => (
				<li key={reference.id} className="flex flex-col gap-1">
					<a href={reference.url} target="_blank" rel="noreferrer">
						<img
							src={reference.thumbnailUrl}
							alt={`Reference ${index + 1}`}
							loading="lazy"
							decoding="async"
							className="aspect-square w-full rounded-md border object-cover"
						/>
					</a>
					{owner && (
						<InlineConfirm
							label="Delete"
							ariaLabel={`Delete reference ${index + 1}`}
							variant="ghost"
							size="sm"
							triggerClassName="self-start text-muted-foreground"
							question="Delete this photo? It's the client's file and can't be brought back."
							confirmLabel="Delete photo"
							keepLabel="Keep it"
							busyLabel="Deleting…"
							fallback={grid}
							onConfirm={(finished) =>
								router.delete(
									urlFor("tenant.references.destroy", {
										tenant: tenant.slug,
										id: reference.id,
									}),
									{ preserveScroll: true, onFinish: finished },
								)
							}
						/>
					)}
				</li>
			))}
		</ul>
	);
}
