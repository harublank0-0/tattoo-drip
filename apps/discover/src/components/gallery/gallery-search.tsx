import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DiscoverySearch } from "#/components/discovery/discovery-search";
import {
	changeGallery,
	type GallerySearch,
	galleryFields,
	nextSearch,
	SEARCH_DEBOUNCE_MS,
	startsBurst,
} from "#/lib/gallery";
import { paths } from "#/lib/routes";

/**
 * The gallery's search (D09): the same GET form as everywhere (`?q=` on
 * `/tattoos`, the filters as hidden fields, so it works without
 * JavaScript), with the results following the typing. 400 ms after the
 * last keystroke a valid search (2–80 characters) is written to the
 * address: the first update of a burst adds a history entry, the next ones
 * replace it, so Back returns to the previous search (or the gallery
 * before it), not through every keystroke. A burst ends with a pause of
 * `SEARCH_BURST_GAP_MS`, leaving the box (a pending search applies then),
 * Enter or Clear, so a later search is its own history entry. Enter
 * applies at once; emptying the box (Clear) removes the search at once. The box is never remounted while typing, so focus
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
	const lastKeystroke = useRef<number | undefined>(undefined);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => {
		const now = q ?? "";
		if (now !== sent.current) {
			// Changed by something else: show it, and start a new burst.
			sent.current = now;
			pushed.current = false;
			lastKeystroke.current = undefined;
			setText(now);
		}
	}, [q]);
	useEffect(() => () => clearTimeout(timer.current), []);

	/** Ends the burst: the next search the box writes adds a history entry. */
	const endBurst = () => {
		pushed.current = false;
		lastKeystroke.current = undefined;
	};

	/** Writes the search to the address if it changes it; whether it did. */
	const apply = (typed: string, replace: boolean): boolean => {
		// Against what the box last wrote, so a write still on its way (blur,
		// then Enter) is not written twice.
		const next = nextSearch(typed, sent.current || undefined);
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
				timer.current = undefined;
				const now = Date.now();
				if (startsBurst(lastKeystroke.current, now)) pushed.current = false;
				lastKeystroke.current = now;
				if (value.trim() === "") {
					// Clear: at once, as its own step.
					apply(value, false);
					endBurst();
					return;
				}
				timer.current = setTimeout(() => {
					timer.current = undefined;
					if (apply(value, pushed.current)) pushed.current = true;
				}, SEARCH_DEBOUNCE_MS);
			}}
			onSearch={(value) => {
				clearTimeout(timer.current);
				timer.current = undefined;
				apply(value, pushed.current);
				endBurst();
			}}
			onBlur={(value) => {
				// Leaving the box: apply what is pending, then end the burst.
				if (timer.current !== undefined) {
					clearTimeout(timer.current);
					timer.current = undefined;
					apply(value, pushed.current);
				}
				endBurst();
			}}
			hidden={galleryFields(search, ["q"])}
			className="max-w-2xl"
		/>
	);
}
