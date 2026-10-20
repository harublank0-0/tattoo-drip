# Fail CI when the generated API types drift from openapi.yaml (TAT-17)

> Instructions for the coding agent (opencode, deepseek-v4.1-flash-free). Do the tasks in order. Run each command, read the result, and only then go on. Read `docs/agent-environment.md` first.

**Goal:** `packages/types/src/openapi.gen.ts` is generated from `packages/types/openapi.yaml`, and the SDK and the storefront are built on it. Add a CI step that fails when someone edits `openapi.yaml` and forgets to regenerate. About 1 point.

**Scope:** one new step in `.github/workflows/ci.yml`. Nothing else: no source file, no `package.json`, no new dependency, no documentation (no doc lists the CI steps).

**STOP rule:** if Task 1's check is not clean before you change anything, do not touch any file. Write what you saw under "Findings" at the bottom of this file and report it.

## Facts already verified on this branch (do not redo them, but Task 1 and 2 re-run them as the proof)

- `pnpm --filter @tattoo-drip/types generate` runs `openapi-typescript openapi.yaml -o src/openapi.gen.ts`.
- Biome ignores `**/openapi.gen.ts` (see `biome.json`), so the generator's output is compared as written; do NOT add a `biome check --write` step for it (the database schema step above it needs one; this one does not).
- On a clean checkout the generated file is identical to the committed one: `git diff --exit-code -- packages/types/src/openapi.gen.ts` exits 0 after generating.
- After an edit to `openapi.yaml` that reaches the generated output (for example changing the `description:` under `listStyles` > `responses` > `"200"`, about line 58), generating changes the committed file, so the same diff exits 1.

## Task 0: Preconditions

- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` prints `v24.3.0`. Use that PATH prefix for every `pnpm` command below.
- [ ] `git branch --show-current` prints `harublank00/tat-17-fail-ci-when-generated-api-types-drift-from-openapiyaml`; `git status --short` prints nothing. The branch already has the opencode setup commit and this plan; do not change them.
- [ ] `.github/workflows/ci.yml` has these steps in order: `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm typecheck`, then a comment and "Prepare platform .env". Read the file once.

## Task 1: The check passes on a clean tree

- [ ] Run, from the repository root:

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/types generate
git diff --exit-code -- packages/types/src/openapi.gen.ts; echo "exit=$?"
```

Expected: `exit=0` and `git status --short` prints nothing. If not, STOP (see the STOP rule).

## Task 2: The check fails when the yaml drifts (prove it is not vacuous)

- [ ] Edit `packages/types/openapi.yaml`: on the line `          description: Styles` (the `"200"` response of `listStyles`, about line 58) change the text to `          description: Styles DRIFT CHECK`. Do NOT regenerate.
- [ ] Run the same two commands as in Task 1. Expected: `exit=1` and the diff shows `DRIFT CHECK` in `packages/types/src/openapi.gen.ts`.
- [ ] Undo it: `git checkout -- packages/types`. `git status --short` must print nothing again.

## Task 3: Add the CI step

- [ ] In `.github/workflows/ci.yml`, directly after the `- run: pnpm typecheck` step and before the comment block that starts `# Ace commands that boot the app`, add exactly this (same two-space indentation as its neighbours, one blank line before and after):

```yaml
      # The SDK and the storefront are built on these generated types, so fail
      # when openapi.yaml changed without regenerating them. Biome ignores the
      # generated file, so the output is compared as written.
      - name: Check generated API types are committed
        run: |
          pnpm --filter @tattoo-drip/types generate
          git diff --exit-code -- packages/types/src/openapi.gen.ts
```

- [ ] Check the YAML still parses and the step is where you meant it: `python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); print([s.get('name') or s.get('run') for s in d['jobs'][list(d['jobs'])[0]]['steps']])"` prints a list in which `Check generated API types are committed` comes right after `pnpm typecheck`.

## Task 4: Gates and finish

- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check` from the root: no new findings (the repository has 2 warnings and 1 info in other files; leave them).
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm typecheck` from the root: clean.
- [ ] `git status --short` shows only `.github/workflows/ci.yml` modified.
- [ ] Commit it with this exact message (the pre-commit hook runs Biome and commitlint; keep the subject under 100 characters):

```
ci: fail when the generated API types drift from openapi.yaml (TAT-17)

A new CI step regenerates packages/types/src/openapi.gen.ts and fails if it
differs from the committed file, so an openapi.yaml edit can't land without
its regenerated types.

Assisted-by: opencode (deepseek-v4.1-flash-free)
```

- [ ] Do NOT push and do NOT open a pull request. The real proof is the CI run on the pull request, which the coordinator opens after a review. Write the result (the two exit codes from Task 1 and 2, the printed step list from Task 3, the commit hash, anything you could not do) as your final message.

## Findings

(none yet)
