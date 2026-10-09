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
