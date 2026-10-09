# Agent context audit

Audited 2026-10-08. This is maintainer evidence, read on demand; it is not an import or startup instruction.

## Targeted inventory and changes

The baseline had four project `AGENTS.md` files, no `CLAUDE.md` or scoped rules, root/scoped Claude settings, and per-area skill symlinks. Fourteen shared skill sources live in `.agents/skills`; platform links 11, storefront 12 and packages 4. Historical specs/plans and local `.superpowers/sdd/` task notes remain intact. Research contents and application implementation were not broadly read for this audit.

`AGENTS.md` remains the shared canonical instruction source. Four one-line Claude imports provide compatibility across versions/settings without copying the instructions. Platform details moved to backend, UI, jobs/email and testing guides; storefront details moved to development guidance. The task-based [documentation index](README.md) replaces the product document's whole-folder reading chain. Stale architecture status claims were replaced by pointers to implementation evidence; the SDK draft warning remains canonical in `sdk.md`.

Nonsecret read denies for generated files, artifacts and lockfiles were removed; routine exploration now skips them by guidance but can inspect them for debugging. Every existing `.env` / `.env.local` deny and all additional-directory settings were preserved. The personal local review hook was untouched. No ignore file is represented as a context/security boundary. Session/memory policy lives in [agent workflow](agent-workflow.md); temporary handoffs use an ignored repo-local directory or the existing task ledger. No global configuration or auto memory was modified.

## Which files count

At startup, `CLAUDE.md` in the working directory and its ancestors loads, including its eager `AGENTS.md` import. Root-only sessions load the root pair; area sessions also load that area's pair. Deeper area pairs load on file-tool access. This setup has no `.claude/rules/` files. Documentation links do not import content; task-relevant guides must be read explicitly. Direct AGENTS discovery is available in current Claude Code but depends on version/settings, so the baseline's automatic load must not be assumed for every installation. [Anthropic memory documentation](https://code.claude.com/docs/en/memory).

Scoped skill names/descriptions contribute separately at discovery; bodies/supporting references are on demand. Full YAML metadata/file sizes are not equivalent to loaded context. Parsed settings JSON is not a Markdown instruction import. Personal/managed instructions, plugins, hook output, user prompts and an enabled auto-memory index can add context outside the repo totals. [Anthropic skills documentation](https://code.claude.com/docs/en/skills).

## Measured file sizes

UTF-8 bytes, including newline. Each new `CLAUDE.md` is 11 bytes. Budgets are justified review thresholds, not automatic enforcement or targets; see [maintenance policy](agent-workflow.md#maintaining-startup-size).

| Scope | Before AGENTS bytes | After AGENTS bytes | New wrapper bytes |
|---|---:|---:|---:|
| Root | 2,648 | 2,689 | 11 |
| Platform | 14,450 | 2,333 | 11 |
| Storefront | 3,190 | 1,029 | 11 |
| Packages | 1,151 | 952 | 11 |

For a fresh session started in each directory, count root plus the applicable area, rather than summing every scope:

| Start directory | Before applicable bytes | After loaded bytes | Byte change | Coarse token estimate before → after |
|---|---:|---:|---:|---:|
| Root | 2,648 | 2,700 | +2.0% | 662 → 675 |
| Platform | 17,098 | 5,044 | −70.5% | 4,275 → 1,261 |
| Storefront | 5,838 | 3,740 | −35.9% | 1,460 → 935 |
| Packages | 3,799 | 3,663 | −3.6% | 950 → 916 |

Coarse estimates use `ceil(UTF-8 bytes / 4)`, not a tokenizer. Before totals describe the applicable AGENTS content under supported native discovery/default settings; it was not runtime-probed before editing. On versions/settings that did not discover AGENTS, baseline automatic project context could be zero, so this is a knowledge-size comparison rather than a universal savings claim. Root grew slightly to add exploration, validation and memory guidance. All four pairs total 7,047 bytes versus 21,439 before; that is the instruction inventory, not root-session startup cost.

## Validation and limitations

Claude Code 2.1.294 was probed interactively with temporary `/tmp` configuration, an invalid dummy key and an unreachable loopback API endpoint. No model prompts or paid API calls were sent. Temporary `InstructionsLoaded` hooks confirmed root and each area's wrapper/import each loaded exactly once; no documentation or unrelated area instructions loaded at startup. The first area start asked to approve the ancestor import; that approval was saved only in temporary config. [Anthropic hook documentation](https://code.claude.com/docs/en/hooks#instructionsloaded).

Local `/context` reported these **CLI estimates**, separately from the bytes/4 estimates above:

| Start directory | Memory estimate | Project skill-description estimate |
|---|---:|---:|
| Root | 900 | No area skill listing observed |
| Platform | 1,680 | ~1,410 |
| Storefront | 1,247 | ~1,020 |
| Packages | 1,221 | ~320 |

No full skill bodies were shown loaded at startup. On-demand nested loading during Read/Write/Edit follows official documentation but was not exercised without a model turn. Real user/managed settings and plugins were excluded from the probe, so inspect `/context` in the everyday session to confirm its actual context. No before/after billed-token, latency or task-runtime savings were measured.

Local Markdown references/import targets, skill symlinks, startup size budgets and preserved secret rules were checked. Documented commands were checked against package scripts, CI, hooks and installed Ace/pnpm command definitions. `pnpm check` passed across 224 supported files; Markdown links/content were checked separately. Two existing lint warnings in platform SSR/types were left untouched. `git diff --check` passed.

No application tests, migrations, typecheck or build were run for this instruction/documentation-only change. Node here is 26.9.0 versus the repo's 24.3.0 pin; pnpm matches 12.8.1. Command verification is not proof that every app command succeeds in this environment. No commits, pushes or deployments were made.
