import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DiscoverySearch } from "#/components/discovery/discovery-search";
import {
	changeGallery,
	type GallerySearch,
	galleryFields,
	nextSearch,
	SEARCH_DEBOUNCE_MS,
} from "#/lib/gallery";
import { paths } from "#/lib/routes";

/**
 * The gallery's search (D09): the same GET form as everywhere (`?q=` on
 * `/tattoos`, the filters as hidden fields, so it works without
 * JavaScript), with the results following the typing. 400 ms after the
 * last keystroke a valid search (2–80 characters) is written to the
 * address: the first update of a burst adds a history entry, the next ones
 * replace it, so Back returns to the gallery before the search, not through
 * every keystroke. Enter applies at once; emptying the box (Clear) removes
 * the search at once. The box is never remounted while typing, so focus
 * stays; a search changed elsewhere (a chip, back/forward) refills it.
 */
export function GallerySearchBox({
	search,
	q,
}: {
	/** The address (validated). */
	search: GallerySearch;
	/** The search the page was read with. */
	q: string | undefined;
}) {
	const navigate = useNavigate();
	const [text, setText] = useState(q ?? "");
	// What this box last wrote, the address now and whether this burst has
	// already added its history entry; refs, so a pending timer reads them fresh.
	const sent = useRef(q ?? "");
	const current = useRef({ search, q });
	current.current = { search, q };
	const pushed = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => {
		const now = q ?? "";
		if (now !== sent.current) {
			// Changed by something else: show it, and start a new burst.
			sent.current = now;
			pushed.current = false;
			setText(now);
		}
	}, [q]);
	useEffect(() => () => clearTimeout(timer.current), []);

	/** Writes the search to the address if it changes it; whether it did. */
	const apply = (typed: string, replace: boolean): boolean => {
		const next = nextSearch(typed, current.current.q);
		if (!next.apply) return false;
		sent.current = next.q ?? "";
		navigate({
			to: paths.tattoos(),
			search: changeGallery(current.current.search, { q: next.q }) as never,
			replace,
		});
		return true;
	};

	return (
		<DiscoverySearch
			action={paths.tattoos()}
			label="Search tattoos"
			placeholder="A style, an artist, a studio, a subject"
			value={text}
			onValueChange={(value) => {
				setText(value);
				clearTimeout(timer.current);
				if (value.trim() === "") {
					// Clear: at once, as its own step.
					apply(value, false);
					pushed.current = false;
					return;
				}
				timer.current = setTimeout(() => {
					if (apply(value, pushed.current)) pushed.current = true;
				}, SEARCH_DEBOUNCE_MS);
			}}
			onSearch={(value) => {
				clearTimeout(timer.current);
				apply(value, pushed.current);
				pushed.current = false;
			}}
			hidden={galleryFields(search, ["q"])}
			className="max-w-2xl"
		/>
	);
}
