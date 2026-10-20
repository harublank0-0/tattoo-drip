# The tattoo-studio feel: three directions and one recommendation

Constraints every direction meets:

- **Stack.** Tailwind v4 tokens in `apps/platform/inertia/css/app.css` (shadcn names mapped onto them, as `apps/storefront/src/styles.css:66-85` already does) and the storefront's own CSS. No new runtime dependency, no icon or animation library.
- **Devanagari.** No uppercase, letter-spacing, ellipses or line clamps on user text. Display type has a Devanagari design (or a Noto fallback); line height is at least 1.5 for Devanagari body text.
- **Phones in daylight on mid-range Android.** Contrast is checked below (WCAG ratios, computed): body text at least 7:1, muted text at least 4.5:1, borders and input outlines at least 3:1.
- **Fonts.** Vendored today: **Eczar 700** (Latin, Latin Extended, Devanagari; SIL OFL) in `apps/storefront/src/assets/fonts/eczar/` (15 KB + 7 KB + 51 KB). The storefront also lists `@fontsource/manrope` and `@fontsource/cormorant-garamond`, prototype leftovers with **no Devanagari**, so neither fits. Anything else is named here and needs the user's permission to download.
- **Per-studio theming later (TAT-54).** Only the foundation now: every colour and the display face are tokens, and a studio theme may override only `--accent`, `--paper` (within a lightness range) and `--display-face`, with a contrast guard (see "Foundations" at the end).

Swatches of all three were rendered as an image kept outside the repo; the values are in the tables below.

---

## A. Flash Sheet

**Mood.** The wall of a traditional parlour: hand-painted flash on cream card stock, black outlines, tattoo red, a bit of mustard and teal. Confident, warm, a little nostalgic.

**Palette (light only; dark is a dimmed variant).**

| Token | Hex | Notes |
|---|---|---|
| paper | `#F3EAD8` | aged card |
| ink | `#1B1612` | 15.0:1 on paper |
| ink-muted | `#5F5446` | 6.2:1 |
| red (action) | `#A8231B` | 6.0:1 as text; white on it 7.2:1 |
| teal (secondary) | `#1E5B57` | 6.5:1 |
| mustard (highlight, never text) | `#C99A2E` | ink on it 7.0:1 |
| line | `#DCCDB2` | |

**Type.** Eczar 700/800 for display (800 needs permission to vendor; 700 is in the repo). Optionally **Rozha One** (OFL, Latin + Devanagari, high-contrast poster face; permission needed) for the studio name only. Body: system sans.

**Imagery and texture.** Thick 2 px ink outlines on cards; photos in a thin cream mat with a red corner tick; dividers like a flash sheet's ruled lines; empty states as single-line flash drawings (swallow, rose, dagger, lotus) drawn as inline SVG.

**Voice.** Old-shop friendly. "Fresh request in." / "Price sent. Ball's in their court." / Empty inbox: "Quiet day. Put your link in your Instagram bio to bring requests here."

**Dashboard and studio page.** The same cream and red in both; the dashboard calmer (fewer outlines).

**Risks.** Red is also the error colour, so actions and errors fight (errors would need a different treatment). The look is "old school", and studios that do fine line, realism or Newari and Buddhist work may not see themselves in it. It is also the most cliché.

## B. Night Studio

**Mood.** Inside the studio after dark: black walls, bone-white type, one hot colour like a neon sign or a marigold garland. Photography-first; tattoos glow on black.

**Palette (dark first).**

| Token | Hex | Notes |
|---|---|---|
| bg | `#0F0E0D` | |
| surface | `#1A1816` | |
| ink | `#F1EBE3` | 16.3:1 |
| ink-muted | `#A39A90` | 7.0:1 on bg, 6.4:1 on surface |
| vermilion (action) | `#FF5A36` | 6.2:1; dark text on it 6.2:1 |
| marigold (highlight) | `#F5B041` | 10.3:1 |
| line | `#2B2724` | |

**Type.** Eczar 700 large for names; labels in a condensed sans such as **Anek Devanagari** (OFL, variable width, Latin + Devanagari; permission needed); body system sans.

**Imagery and texture.** Full-bleed photos, no frames; a faint film grain made with a CSS gradient (no image); marigold dots for "needs you".

**Voice.** Short and cool. "New request." / "Booked. See you Saturday." / Empty inbox: "No requests yet. Share your link."

**Dashboard and studio page.** Both dark by default; a light theme exists but is secondary.

**Risks.** Dark pages in sunlight on cheap screens, and dark forms are harder to fill in. The studio page *must* have good photos, or it looks empty and moody for no reason. "Black and neon" also reads as nightclub and generic luxury. Most Nepali studios' Instagram grids are light and photographic, not dark.

## C. Stencil & Ink (recommended)

**Mood.** The moment before the needle: clean skin-toned paper, the violet line of a transfer stencil, black ink. Calm, precise, crafted, trustworthy. It grows out of what the studio page already does (the violet offset frame, Eczar), so it reads as a deliberate brand rather than a reskin, and every client who has been tattooed has seen that purple line on their skin.

**Palette.**

Light:

| Token | Hex | Contrast | Use |
|---|---|---|---|
| `--paper` | `#F7F3EE` | | page background (warmer than today's `#f5f6f8`) |
| `--surface` | `#FFFDFA` | | cards, inputs |
| `--ink` | `#1C1917` | 15.8:1 | text |
| `--ink-muted` | `#5E5650` | 6.5:1 | secondary text |
| `--line` | `#E3DBD2` | | dividers |
| `--line-strong` | `#8C8279` | 3.4:1 | input borders |
| `--stencil` | `#4B3BA6` | 7.7:1; white on it 8.5:1 | primary action, links, focus |
| `--stencil-strong` | `#3A2D88` | | hover/pressed |
| `--stencil-wash` | `#ECE8F7` | stencil text on it 7.1:1 | selected, chips |
| `--marigold` | `#E8A317` | ink on it 8.1:1 | "needs you" dots, today marker; never text on paper |
| `--destructive` | `#B42318` | 6.0:1 | errors only |

Dark:

| Token | Hex | Contrast |
|---|---|---|
| `--paper` | `#14110F` | |
| `--surface` | `#1C1815` | |
| `--ink` | `#EFE9E2` | 15.6:1 |
| `--ink-muted` | `#A89F96` | 7.2:1 (6.8:1 on surface) |
| `--line-strong` | `#6B625A` | 3.2:1 |
| `--stencil` | `#A99CFF` | 8.0:1; paper-coloured text on it 8.0:1 |
| `--stencil-wash` | `#241F3A` | |
| `--marigold` | `#F2B53A` | 10.3:1 |
| `--destructive` | `#F4A39A` | 9.5:1 |

Status tokens (text on its wash; always with a word, plus an icon in lists):

| Meaning | Statuses | Text / wash (light) | Ratio |
|---|---|---|---|
| Waiting on the studio | new request, reviewing, screenshot to check | `#8A5A00` / `#FBF0D9` + marigold dot | 5.2:1 |
| Waiting on the client | quoted, on hold, deposit pending (link sent) | `#1F4E79` / `#E3EDF7` | 7.3:1 |
| Booked | booked | `#1E6B45` / `#E3F2E9` | 5.6:1 |
| In the chair | in progress, healing check | `--stencil` / `--stencil-wash` | 7.1:1 |
| Closed | completed, declined, cancelled | `--ink-muted` / `--line` | |

Dark mode uses the same hues at about 80% lightness on 20% washes (verify each at 4.5:1 or better when building).

**Type.**
- Display: **Eczar 700** (vendored) for page titles, the studio and artist names, amounts and the reference code's label. On the studio page as today; in the dashboard **only** for the page `h1` and the studio name (keeps the 51 KB Devanagari file off most screens; `font-display: optional`).
- Body and UI: the system stack already in the storefront (`system-ui, …, 'Noto Sans', 'Nirmala UI', 'Noto Sans Devanagari'`). Android phones ship Noto Sans Devanagari, so Nepali text is crisp at no cost.
- Optional upgrade (permission needed): **Mukta** (Ek Type, OFL, Latin + Devanagari, 400/600) as the shared UI face, if the system font feels too plain after the rest lands. Not needed for the first slices.
- Sizes on phones: body 16 px (17 px on the storefront), hints at least 14 px, page title 28 px Eczar, amounts 40 px Eczar. Desktop body 15 px.

**Imagery and texture (all CSS or inline SVG, no image downloads).**
- **The stencil frame:** a 1.5 px violet line offset 6 px behind photos, the success "tickets" and the Today card. Already on the storefront; bring it to the dashboard (artist avatars, references, proof thumbnails).
- **Stencil line drawings** for empty states: a single violet line (lotus, swallow, mountain range, Buddha eyes, a machine). One inline SVG each, under 2 KB.
- **The dashed transfer line:** a 1.5 px dashed violet border for "add photo" drop zones and the reference code (already used); a dotted connector in the project progress line.
- **The needle line:** the 2 px violet tracing bar (`intake-trace`) as the one motion: page loading, sending. Respect reduced motion.
- **Photos lead:** a cover photo on the studio page and the deposit page header, work grids on artist pages, reference thumbnails in the inbox.
- Radius stays small (4 px): stencils have sharp corners; the zinc theme's 10 px rounding is part of why the dashboard looks generic.

**Voice.** A calm studio manager: short, warm, specific, never cute, never technical. English now, written so a Nepali file can mirror it (no idioms that don't translate).

| Where | Today | Proposed |
|---|---|---|
| Empty inbox (new studio) | "No new inquiries. They arrive here from the studio page." | "No requests yet. Put your studio link in your Instagram bio and requests land here." [Copy link] |
| Inquiry action | "Accept and create project" | "Accept…" → sheet "Who will tattoo this?" → "Start the project" |
| Next step, reviewing | (form at the bottom) | "Send Sita a price" |
| Quote sent | "Quote issued." | "Price sent. When Sita says yes, tap Client accepted." |
| Deposit paid (client) | "Your deposit is paid. Thank you!" | "Deposit paid. You're booked in: Sat 24 Oct, 11:00 with Aarav." |
| Alert | "New inquiry / Open it in the inbox." | "Sita Thapa wants a koi on the left calf" |
| Studio hero | "Send an inquiry" | "Send your idea" |
| Signup error | "The passwordConfirmation field must be defined" | "Type the same password again." |

**How the dashboard and the studio page relate.** One token file and one vocabulary. The studio page is the studio's (its cover, its photos, later its accent colour and display face); the dashboard is Tattoo Drip's (fixed palette, the stencil violet as the brand), with the studio's cover and name in the sidebar and the Today header so it still feels like *their* desk. The deposit page sits between them: the studio's header, Tattoo Drip's calm structure and reassurance line.

**Risks.** Violet is not a "tattoo colour" to everyone; it must be explained by use (stencil line, frames) rather than splashed everywhere. Keep it for actions, focus and the frame, and let photos and black ink carry the rest.

---

## Recommendation: C, Stencil & Ink

1. **It builds on what works.** The storefront's tokens, Eczar, the offset frame and the copy voice already exist and are good; C extends them to the dashboard and warms them. A and B would throw that away.
2. **It is authentic, not costume.** The purple transfer stencil is universal in tattooing and works for every style (realism, fine line, Newari, traditional). Flash-sheet red-and-mustard (A) says "traditional" only; black-and-neon (B) says "nightclub".
3. **It is light-first with a real dark mode.** That suits daylight phones and form-filling, and the dashboard's existing theme toggle keeps dark for owners who like it.
4. **It is cheap.** It is token changes, a status system and a few motifs, so the first visible change is about 3 points of work, and per-studio themes fit on top (accent, paper, display face) without redesign.
5. **Devanagari is solved.** Eczar's Devanagari plus the Android system Noto stack; no new font is needed.

## Foundations to build now (so studio themes work later)

- **One token vocabulary in both apps:** `--paper --surface --ink --ink-muted --line --line-strong --stencil --stencil-strong --stencil-wash --on-stencil --marigold --destructive --status-{studio,client,booked,chair,closed}-{fg,bg} --display-face --body-face --radius`, mapped onto shadcn's names (`--background`, `--primary`, …) in each app's CSS, exactly as the storefront does. Duplicate the small token block in both apps for now (`packages/*` may not import from `apps/*`, and a shared CSS package is a later step).
- **Theme overrides are a short whitelist:** a studio theme sets `--accent` (used where `--stencil` is used on the studio and deposit pages only), `--paper` (lightness between 92% and 99% in light mode), and `--display-face` (from a vetted list with Devanagari support). `--on-accent` is computed (ink or white, whichever passes 4.5:1), and the platform refuses an accent below 4.5:1 against paper. The dashboard never takes a studio theme.
- **Fonts are vendored, never fetched from a CDN** (the storefront's rule and test). If the dashboard uses Eczar, copy the three 700 files and the OFL licence into `apps/platform` (or a later shared assets package), with the same `unicode-range` blocks.
