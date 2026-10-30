import { useEffect, useState } from "react";
import type { OpenNowView } from "./good-to-know.ts";
import { coverState, coverText } from "./hours.ts";

/**
 * The cover's line under the location: "Open now · till 8 pm" (TAT-128).
 * The page is cached for up to 11 minutes, so a time-of-day state baked into
 * its HTML could say "Open now" after closing. The server renders only a
 * state that cannot change within the cache life (`view.initial`, hours.ts
 * steadyCoverState); this island starts from it, then recomputes from the
 * visitor's clock at once and every 30 seconds. The line keeps its height
 * while empty (CSS), so filling it moves nothing. This is the page's one
 * timer: no DOM access, no `document` or `window`.
 */
const REFRESH_MS = 30_000;

export function OpenNow({ view }: { view: OpenNowView }) {
	const [state, setState] = useState(view.initial);
	useEffect(() => {
		const tick = () =>
			setState(coverState(view.week, view.closures, view.timezone, new Date()));
		tick();
		const timer = setInterval(tick, REFRESH_MS);
		return () => clearInterval(timer);
	}, [view]);

	const text = state ? coverText(state) : null;
	// Closed days with no weekly hours: the line exists only on a closed day,
	// so a day with nothing to say leaves no empty line on the cover.
	if (!text && view.week.every((day) => day === null)) return null;
	return (
		<p className="profile-hours">
			{text ? (
				<>
					<strong>{text.lead}</strong>
					{text.detail ? (
						<>
							{" · "}
							<span className="user-text" dir="auto">
								{text.detail}
							</span>
						</>
					) : null}
				</>
			) : null}
		</p>
	);
}
