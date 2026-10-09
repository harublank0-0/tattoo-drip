# Storefront development

Read the relevant section before changing UI/forms, server functions or version-specific TanStack integration. General commands and boundaries are in [area instructions](../AGENTS.md).

Both apps use Tailwind CSS v4 and shadcn/ui (new-york, Radix, lucide, zinc), with separate themes until a shared design system replaces them. Storefront theme entry: `src/styles.css`. Environment validation: `src/env.ts`.

The unused `@tanstack/ai*` prototype packages are slated for removal; do not build on them.

## shadcn

Add components from `apps/storefront` with `pnpm dlx shadcn@latest add <component>`, then run a focused Biome check on the generated components from the root (see [validation](../../../docs/agent-workflow.md#validation)). The CLI imports `cn` from the `cn` package (shadcn's clsx + tailwind-merge replacement); older components (`dialog`, `sheet`) still use `#/lib/utils`.

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

## TanStack skill loading

The linked TanStack skills cover most work. Only when a change depends on version-specific TanStack APIs they don't cover:

- Run `pnpm dlx @tanstack/intent@latest list` from `apps/storefront` to see the skills shipped with the installed packages.
- Load the one matching skill with `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files, and follow its `SKILL.md`.
