# Dashboard UI conventions

Read before changing dashboard components, forms, styling or SSR. Dashboard UI lives in `inertia/pages`, `inertia/layouts`, `inertia/components`, `inertia/hooks` and `inertia/css/app.css` (Tailwind entry and theme tokens). Backend and test guidance is separate: [backend](backend.md), [testing](testing.md).

## Stack and rendering

- Inertia + React. The SSR entry exists in `inertia/ssr.tsx`, but SSR is disabled in `config/inertia.ts`.
- Tailwind CSS v4 and shadcn/ui (new-york style, Radix, lucide icons; same `components.json` settings as the storefront). Theme tokens are shadcn's stock zinc palette in `inertia/css/app.css` until the shared design system replaces them.

## Components, forms and theme

- Build UI from shadcn components in `inertia/components/ui` and semantic tokens (`bg-background`, `text-muted-foreground`); don't add custom CSS classes. Use `cn` from the `cn` package.
- Add components from `apps/platform` with `pnpm dlx shadcn@latest add <component>`, then run a focused Biome check on those files from the root (see [validation](../../../docs/agent-workflow.md#validation)). Don't edit generated components just to satisfy Biome; it relaxes a few lint rules for `**/components/ui/**`.
- Forms post with `Form` from `@adonisjs/inertia/react` and are validated server-side with VineJS. Lay fields out with shadcn's `FieldGroup` / `Field` / `FieldLabel` / `FieldError`, setting `data-invalid` on `Field` and `aria-invalid` on the control (see `inertia/pages/auth/login.tsx`).
- Dark mode follows `data-theme` on `<html>`, rendered from the `app_theme` cookie, and Tailwind's `dark:` variant is keyed to it. Use `useTheme` from `~/hooks/use-theme`, not `next-themes`.
- Import frontend code with the `~/` alias (`~/components/ui/button`).
- Chat links (TAT-52): `ChatMessage` and `ChatLinks` (`inertia/components/chat_message.tsx`) are the one way to draw a WhatsApp, Viber or Call link; each tap calls back with its channel so the page records the last contact. Hand an `onClick` a wrapper (`() => markContacted()`), never the recording function itself, or the click event becomes the request body. The "Message the client" card is `inertia/components/message_card.tsx`.
- Guest pages (`AuthLayout`, TAT-18): login, signup, the password reset pages, "Check your email", the confirmation page and the confirm-email notice. Give each its own `<Head title>`, 44 px buttons and inputs, and no third-party link: these pages hold reset and confirmation state.

## App shell

- `AppLayout` is the shell for every tenant page (TAT-67). Below Tailwind's `lg` (1024px): a top bar (studio switcher, account menu) and a bottom tab bar; from `lg`: a left sidebar. Both render `navItems` from `inertia/components/shell/nav_items.ts`, which is plain data and unit-tested: add a new area there (and its icon in `nav_icons.ts`), not in the layout. The tab bar only shows with two or more destinations; `also` lists other path prefixes that make an item current (Settings covers `/artists`). The Alerts link (`inertia/components/shell/alerts_link.tsx`, TAT-52) is not a nav item: a bell with the member's unread count (the shared `alertCount`) next to the account menu in the top bar, and a row above the account menu in the sidebar. The email confirmation bar (`inertia/components/shell/verify_email_bar.tsx`, TAT-18) shows under the top bar while the signed-in account's address isn't confirmed (the shared `user.emailVerified`), with "Send a new link".
- The page under the tab bar is padded by the bar's height plus `env(safe-area-inset-bottom)`; anything fixed to the bottom of a page must clear it too.
- Installable: `public/manifest.webmanifest`, icons in `public/icons/` generated from `resources/brand/mark.svg` by `node scripts/generate_icons.ts` (commit the outputs), and `public/sw.js`. The service worker caches only hashed `/assets/*` build files and the offline page; it never stores pages, Inertia responses, `/files` or `/uploads`. Bump its `CACHE` name to drop everything an older version stored. It registers only in production builds.

## Phones and slow connections

Check every page against these:

- Open-ended lists are paginated (25 per page); a view bounded by a range (the calendar's day or week) lists the whole range instead. Props carry only what the screen shows.
- Images in lists and grids are lazy-loaded thumbnails, never the full-size file.
- Forms disable their button and say "Saving…" while a request is in flight.
- Optimistic UI only for reversible single-field changes (notes, "Mark contacted"); never for money, quotes, status moves, or accepting and declining.
- Touch targets are at least 44px, and nothing is wider than 375px.
