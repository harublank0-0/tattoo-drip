# Agent workflow

Read this for session, memory or exploration questions. Task-specific code conventions are routed by the [documentation index](README.md); they are not imported into startup instructions.

## Loading and settings

`AGENTS.md` is canonical. Each adjacent `CLAUDE.md` contains only `@AGENTS.md`, a supported eager import. Startup loads root and ancestor/current-area wrappers and their imports. Deeper wrappers load when Claude uses Read/Write/Edit there; shell searches do not trigger that mechanism. Direct AGENTS discovery is version/configuration dependent (introduced in 2.1.277), so this repo keeps the explicit imports. An area launch can ask once to approve the ancestor import outside its working directory. Approve only the expected repository files. Plain Markdown links are pointers, not imports or guaranteed automatic reads. Open matching guidance explicitly before editing. [Anthropic memory documentation](https://code.claude.com/docs/en/memory).

There are no repository `.claude/rules/` files. Unscoped rules would add startup context; `paths` rules load on matching file-tool access. Keep the four area guides rather than duplicating them in rules. Existing scoped skill symlinks remain: names/descriptions enter discovery context; bodies and supporting files are loaded when the skill is invoked or needed. Don't invoke all skills for every task. [Anthropic skills documentation](https://code.claude.com/docs/en/skills).

Shared/scoped `.claude/settings.json` files configure tool access, not project knowledge. Existing secret-file deny rules are preserved. Generated outputs, lockfiles and other nonsecret artifacts are skipped by guidance, with their former read denies removed so debugging can inspect them. Read denies constrain built-in file tools but are not OS isolation for arbitrary subprocesses. `.gitignore` helps default `rg` exploration and avoids committing task notes; it does not prevent context loading. `.claudeignore` has no effect. Do not use an ignore file as a security or context boundary. [Anthropic permissions documentation](https://code.claude.com/docs/en/permissions).

Shared project settings come from the session's primary working directory; they do not inherit root settings like instruction files do. Each area's small settings file therefore configures the same repo-local status script. Local, managed or command-line settings may affect what a real session uses. [Anthropic settings documentation](https://code.claude.com/docs/en/settings).

Additional-directory access does not promise instruction/settings discovery. For work spanning apps, launch at the repo root and read the relevant area guide. If using `--add-dir`, explicitly read that area's guidance; do not assume access imports its knowledge. Personal/global settings, plugins and memory can add context outside this repo's budget; do not change them as part of repository maintenance.

## Task entry and completion

Use `/td-work <goal>` to implement a task, or `/td-work .claude/task-notes/<task>.md` to resume a handoff. These project-specific commands are available from the root and each area. They are manual skills: their descriptions and bodies stay out of routine model context until invoked. Root placement avoids copies in each area. Once invoked, the skill body remains in the conversation, so use one invocation per task rather than adding it on every turn. [Anthropic skills documentation](https://code.claude.com/docs/en/skills).

Start with the behavior to achieve and an acceptance check. Read a supplied handoff first, then inspect changes since its checks. For a small clear fix, proceed directly. Plan when the approach is uncertain or touches schema, tenancy, auth or the API contract: identify affected behavior/files and verification before implementing. A plan is not an extra approval gate. Finish with the outcome, changed paths, checks/results and remaining blocker; preserve failure evidence and state unrun checks. [Anthropic best practices](https://code.claude.com/docs/en/best-practices).

Delegate independent work when a concise result will reduce repeated exploration or keep large investigation output out of the main session. Give each investigator a narrow question, relevant paths and required evidence; ask for findings and locations rather than a transcript. Subagents still consume tokens, so do not run several agents to answer the same question. Shared findings should replace redundant reads, not create another round of them.

## Context and usage visibility

The local status line shows the configured model, current context percentage/window size when available, and estimated session API cost. It reads Claude's supplied JSON, prints one line and makes no model or network calls. It does not collect or persist session data. The Git lookup in the launcher finds the shared script from any repository area. [Anthropic status-line documentation](https://code.claude.com/docs/en/statusline).

Use `/context` when starting an unfamiliar workflow or diagnosing growth to distinguish instructions, skill listings, tools and conversation. Use `/usage` (also available as `/cost`) for session/plan usage. The locally estimated API dollar figure is not subscription billing. Large context percentages signal a need to finish a coherent step and create a compact handoff, not a reason to drop necessary checks. Don't run usage diagnostics after every tool call. [Anthropic cost documentation](https://code.claude.com/docs/en/costs).

Keep the user's configured model and reasoning settings by default. For straightforward work, `/effort` can reduce reasoning overhead when supported; retain sufficient reasoning for ambiguous architecture, debugging, tenancy/security and database changes. Avoid fixed thinking-token limits as a repo default. Do not disable useful skill knowledge or connected tools just to shrink a number; inspect their actual contribution and use them when the task needs them.

## Exploration

1. Check `git status --short` and identify the affected area. Search filenames before content, e.g. `rg --files apps/platform/app -g '*tenant*'`.
2. Search the symbol in the likely directory: `rg -n 'membershipFor' apps/platform/app/modules/tenancy`. Use `rg -l` when only filenames matter. Inspect headings first in long docs: `rg -n '^##' <doc>`.
3. Read the needed region, e.g. `sed -n '40,100p' <file>`, then expand only when necessary. Track paths/findings already read instead of rereading unchanged files.

Routine searches should exclude `node_modules`, `.git`, `.adonisjs`, generated schemas/routes/types, `build`, `dist`, `.output`, `.tanstack`, coverage, logs, screenshots, archives and lockfiles. Default `rg` honors git ignores, but tracked generated files require explicit exclusions when searching broadly. For example, from the root:

```bash
rg --files apps/platform -g '!**/database/schema.ts' -g '!**/.adonisjs/**'
rg -n 'ImageService' apps/platform/app apps/platform/tests
```

Inspect excluded material when the issue requires it: generated types for a compiler mismatch, dependency metadata with `pnpm why` / `pnpm list`, or bounded logs for a failure. Avoid `--no-ignore` and recursive whole-repo dumps for routine work. Save full diagnostic output to a task-local log and read the relevant error region; don't truncate away the cause or conceal a failing exit status.

## Validation

Run checks for changed behavior first. Use `pnpm --filter @tattoo-drip/<area> typecheck`; platform test narrowing is in [testing](../apps/platform/docs/testing.md). For supported changed files, run `pnpm exec biome check <paths>`; use `--write` deliberately for fixes. Biome does not validate Markdown; check its links, examples and consistency directly. Avoid repo-wide format writes for a localized change.

Include security/isolation, integration, browser or migration checks when the change needs them. Passing typechecks alone cannot prove runtime behavior. Root `pnpm test` currently runs platform only. Full gates and schema-generation checks are in [README](../README.md) and CI. Once appropriate checks pass, rerun only after relevant edits, a failure or new evidence. Report unrun checks and environment limitations; retain failure evidence.

## Durable memory

Keep stable decisions with rationale, commands verified in this environment, and recurring pitfalls that are absent from canonical docs. Include the scope/source and verification date when a fact depends on versions or local setup. Prefer fixing the relevant canonical guide for shared project facts; memory should link that guide rather than copy it. Do not save secrets, speculation, task transcripts, current TODOs or rapidly changing implementation status as durable knowledge.

Before adding an entry, search for an existing one. Correct its source and entry together when it is wrong; replace contradictions rather than appending competing advice. Merge duplicates and prune obsolete commands, solved temporary workarounds and facts invalidated by code/config changes. At a handoff or after a recurring correction, review the affected entries rather than reloading all memory.

Claude's default auto memory is personal, outside this repo. This setup neither redirects nor modifies it. Its `MEMORY.md` index can load at startup, while topic files are on demand; audit it separately with `/memory` if it becomes noisy. No checked-in auto-memory index is seeded with copies of the docs.

## Everyday sessions and handoffs

- Start: `cd apps/platform` (or storefront/packages), then `claude`. State the goal, affected area and acceptance check; use `/context` to inspect actual loaded memory and skill listing costs when needed. Root starts are for work spanning areas.
- Continue: from the same area, `claude --continue` resumes the latest conversation; `claude --resume` selects one. Before continuing, check user changes and what has changed since the last validation. [Anthropic session documentation](https://code.claude.com/docs/en/sessions).
- Keep one task per conversation. Use `/compact` at a natural milestone with a focus on goal, constraints, key findings, validation and next action; use a fresh session for unrelated work. [Anthropic best practices](https://code.claude.com/docs/en/best-practices).
- Hand off: `/td-handoff <task>` updates one short file at repo-root `.claude/task-notes/<task>.md` (gitignored), or the existing `.superpowers/sdd/<task>/progress.md` ledger. Resume with `/td-work .claude/task-notes/<task>.md`; the note is not automatically loaded. Share only the compact note when changing agents, not a transcript or large diff. Keep history while active; prune completed temporary notes when no longer needed.

```text
Goal / acceptance check:
Area / branch / user edits to preserve:
Verified findings / canonical links:
Changed paths:
Validation (command, result, environment; what remains unrun):
Open decisions / blocker:
Next concrete action:
```

## Maintaining startup size

Review budget: at most 3,000 bytes of UTF-8 text for root instructions and 3,000 for each area, plus an 11-byte wrapper each. This accommodates the repository's essential boundaries, regeneration commands, high-risk pitfalls and task pointers; platform detail previously cost 14 KB. It is a review budget, not a tool-enforced cap or a target to fill. New detail belongs in the matching on-demand guide unless every task in that scope needs it. See the [audit](agent-context-audit.md) for measured file sizes, estimates and limitations.
