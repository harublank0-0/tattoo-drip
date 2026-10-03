# Portfolio imagery

## Selected work

Six real tattoo photographs are bundled locally as compressed, 1000px-wide JPEGs. The gallery and detail views use these files directly, with no external image requests or API dependency.

These are stock placeholders for the fictional portfolio, not tattoos by Suraj Rana. Project names and descriptions are illustrative. Replace the files with the artist’s own work before presenting this as a live portfolio.

| Local file | Source |
| --- | --- |
| `tattoos/work-01.jpg` | [Tattoo with Flowers — Pexels](https://www.pexels.com/photo/tattoo-with-flowers-9356536/) |
| `tattoos/work-02.jpg` | [Back View of a Woman with a Tattoo — Pexels](https://www.pexels.com/photo/back-view-of-a-woman-with-a-tattoo-12562858/) |
| `tattoos/work-03.jpg` | [Black Tattoo on a Person’s Arm — Pexels](https://www.pexels.com/photo/black-tattoo-on-a-person-s-arm-8349189/) |
| `tattoos/work-04.jpg` | [Artistic Tattoo on Human Leg — Pexels](https://www.pexels.com/photo/artistic-tattoo-on-human-leg-in-ambient-setting-29832808/) |
| `tattoos/work-05.jpg` | [Arm with Intricate Tribal Tattoo — Pexels](https://www.pexels.com/photo/close-up-of-arm-with-intricate-tribal-tattoo-32986829/) |
| `tattoos/work-06.jpg` | [Photo of Left Arm with Tattoo — Pexels](https://www.pexels.com/photo/photo-of-left-arm-with-tattoo-2183131/) |

Downloaded September 18, 2026. Source licensing: [Pexels License](https://www.pexels.com/license/).

## Artist and hero

The hero uses `tattoos/hero.jpg`, a locally bundled, compressed 1600 × 1068 JPEG from [A Man Tattooing a Client — Pexels](https://www.pexels.com/photo/a-man-tattooing-a-client-6593497/), downloaded September 18, 2026 under the [Pexels License](https://www.pexels.com/license/). This is a stock tattoo-session placeholder, not a photograph of Suraj. A charcoal overlay in `src/styles.css` darkens the photo by 30% on desktop and 40% on mobile for text readability.

The portrait uses `tattoos/tattoo-header.jpg`. Both image paths are configurable in `src/data/mock/artist.ts`.

## Flash and mock content

The supplied `flash/*.svg` files are original placeholder illustrations for this fictional concept. Replace their paths in `src/data/mock/flash.ts` when final designs are available.

All artist, project, and flash content is local mock data in `src/data/mock/`. The `.example` email is deliberately non-deliverable; replace it before publishing. Booking actions prepare an email draft and do not submit or store data.
