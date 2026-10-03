## Storefront

TanStack Start app for the hosted studio page. It has no database: real data comes from the platform through `@tattoo-drip/react` / `@tattoo-drip/sdk` (`packages/`). Until the API exists, pages read mock data from `src/data/mock`.

- **Stack:** TanStack Start + Router (file routes in `src/routes`), TanStack Query, TanStack Form, React 19, Tailwind CSS v4 (`src/styles.css`), shadcn components in `src/components/ui`, t3 env validation in `src/env.ts`.
- **Imports:** use the `#/` alias for `src/` (`#/components/ui/button`, `#/lib/utils`).
- **Prototype leftovers:** the unused `@tanstack/ai*` packages are slated for removal. Don't build on them.
- **No auth or data layer here:** the storefront has no auth, database or Supabase client. Customer data goes to the platform API through the SDK.

## shadcn

Add components from `apps/storefront` with `pnpm dlx shadcn@latest add <component>`, then run `pnpm format:fix` from the root. The CLI imports `cn` from the `cn` package (shadcn's clsx + tailwind-merge replacement); older components (`dialog`, `sheet`) still use `#/lib/utils`.

Never run `shadcn add form`: `src/components/ui/form.tsx` is our TanStack Form toolkit, and the CLI would overwrite it with shadcn's react-hook-form version.

## Forms

- Build forms with `useAppForm` from `#/components/ui/form` (TanStack Form composition) and render fields with `<form.AppField name="…">`, using `field.TextField`, `field.TextareaField` or `field.SelectField`. Add new field types to `form.tsx` rather than wiring inputs by hand. `src/features/home/booking-form.tsx` is the reference.
- Pass Zod schemas straight to `validators` (TanStack Form 1.x reads Standard Schema; there are no adapters). For "validate on submit, then on change", use `validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" })` with `validators: { onDynamic: schema }`.
- No skill covers TanStack Form 1.x: the skills.sh `tanstack-form` skill targets the pre-1.0 adapter API. Go by the installed package's types and shadcn's TanStack Form guide.

## Sentry

Sentry is initialised server-side in `instrument.server.mjs`, which `pnpm dev` and `pnpm start` load with `--import`. Instrument server functions: wrap the body of each `createServerFn` handler in a span.

```tsx
import * as Sentry from "@sentry/tanstackstart-react";

Sentry.startSpan({ name: "Load studio profile" }, async () => {
	// server work here
});
```

## Commands

Run from `apps/storefront`:

- `pnpm dev` (port 3000, loads `.env.local`)
- `pnpm typecheck`
- `pnpm build`
- `pnpm generate-routes` (`src/routeTree.gen.ts` is generated; never edit it)

Relevant docs: `docs/product.md`, `docs/requirements.md`, `docs/sdk.md`.

<!-- intent-skills:start -->
## TanStack skill loading

The linked TanStack skills cover most work. Only when a change depends on version-specific TanStack APIs they don't cover:
- Run `pnpm dlx @tanstack/intent@latest list` from `apps/storefront` to see the skills shipped with the installed packages.
- Load the one matching skill with `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files, and follow its `SKILL.md`.
<!-- intent-skills:end -->
