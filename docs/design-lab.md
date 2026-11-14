# AI Design Lab

A private workspace in the studio dashboard (`/t/:tenant/design-lab`, nav item "AI Design Lab" under More) where owners and artists generate tattoo **concepts** with an image model, compare them, keep a preferred one, rename and annotate them, download them, and optionally file a design project under one of the studio's tattoo projects (a booking). Output is an AI concept for the artist to review and redraw. The product never calls it a stencil or a design ready to tattoo.

MVP scope: artists and owners only. No customer self-service, no body-photo try-on, no reference or client photo uploads, no payments or billing.

## Who sees what

- Every route is open to every member (`TENANT_ROUTE_ROLES`, `MEMBERS`). `DesignLabService` scopes each record: owners reach every design project in the studio, and an artist reaches only the projects they started (`created_by`). Anything else, including another studio's records, is the same 404 as an unknown URL.
- A linked tattoo project must be one the member may open (`ProjectService.findFor`). Linking only files the concepts with that project: no client data enters a generation.
- Stored concepts sit on the private `design_concept` image purpose (the existing Drive disks: local folders in development, the private R2 bucket in production). Pages get 5-minute signed URLs after the scoped load, and downloads are streamed by the app (`ImageService.read`). Nothing is public, and nothing is shared unless an artist sends a file themselves.

## Data

Migration `1791980000000_create_design_lab`: four tenant-owned tables, each with RLS (`enableTenantRls`) and composite tenant keys.

| Table | Holds |
|---|---|
| `design_projects` | title, artist notes, `review_state` (`exploring`, `decided` once a concept is preferred, `archived`), optional `tattoo_project_id` (`ON DELETE SET NULL (tattoo_project_id)`), `created_by`; soft-deleted |
| `design_generations` | one provider request (one image): `request_id` + `variant_index` (unique per studio: a submit's idempotency key), provider, model, `prompt_version`, validated `inputs` (jsonb), `status` (`queued`, `processing`, `completed`, `failed`, `moderated`), `failure_code`, `attempt`, `step` (the worker's fence), `provider_request_id`, `polling_url_sealed`, safe `provider_meta` (cost, seed, the provider's status word, run counters) |
| `design_assets` | the stored image of a completed generation (one per generation), size, title, notes, `selected_at` (at most one per project) |
| `design_usage_records` | the allowance ledger: one row per generation attempt, `reserved` → `settled` or `released` (with a reason), estimated and actual provider credits |

`stuck_design_generation_candidates()` is a SECURITY DEFINER function (ids only, pinned `search_path`, no PUBLIC execute). It lists generations still unfinished 30 minutes after their last change, for the sweep.

## Prompt

`#modules/design_lab/prompt` builds every provider prompt on the server from validated structured inputs and the template `tattoo-concept-v1` (`PROMPT_VERSION`). The browser sends only choices and short texts: a concept (3 to 400 characters), a style preset (fine line, blackwork, traditional, Japanese, realism, geometric, watercolor, lettering, custom), and optionally a subject, a custom style, lettering text, palette, composition, detail level and intended placement. Free text with an email address, a phone number, a link, a social handle or hidden characters is refused with a field error. The template asks for an isolated design sheet on white with legible linework, and explicitly no body, skin, person, mockup or photograph. The placement shapes proportions only. Each generation stores its inputs and template version, and the concept card shows them with the prompt that was built, so an artist can see how a design was made. Prompts and provider URLs are never logged.

Changing the template's words means adding a new version and keeping the old builder, so stored rows still explain themselves.

## Provider

`DesignProvider` (`#modules/design_lab/providers/types`) is the contract: `submit`, `poll` the handle the provider returned, `download` the finished image. `DesignProviders` (container class) picks the implementation from `DESIGN_LAB_PROVIDER`:

- `bfl`: `BflProvider`, Black Forest Labs' **hosted** FLUX API (never self-hosted weights). It does `POST <BFL_API_URL>/v1/<BFL_MODEL>` with the key in `x-key`, then `GET` the returned `polling_url` exactly as given (never rebuilt), with the key. Status `Ready` puts the image at `result.sample`; `Pending`; `Request Moderated` and `Content Moderated` become `moderated`; `Error` and `Task not found` become `provider_error`; any other word is treated as pending until the deadline. The `result.sample` delivery URL is temporary and is fetched without the key. The key only ever goes to the API's host or a subdomain of its domain: a polling or sample URL elsewhere is refused. Models whose name contains `ultra` or `kontext` are sized with `aspect_ratio`, and the rest with `width` and `height` (832×1216, 1216×832 or 1024×1024). `output_format` is `png` and `safety_tolerance` is 2.
- `preview`: `PreviewProvider`, a labelled placeholder drawn locally with no network (development's default). Production refuses it. Put `test:moderate` or `test:error` in a concept to try those outcomes.
- `off`: the nav item is hidden and every route is a 404.

Tests swap in `FakeDesignProvider` (`tests/helpers/design_lab.ts`, installed in `tests/bootstrap.ts`), so no test reaches BFL.

## Worker

`RunDesignGenerationJob { tenantId, generationId, attempt, step }` runs on the default queue. It is a plain `Job`, allowlisted like the video jobs, because a step waits on the provider for up to 30 s and must not hold a transaction. `GenerationRunner` does each step in three parts:

1. **Claim** in a short `withDbContext({ tenantId })` transaction, under the row's lock. Only a run whose `step` matches the row's goes on. It bumps `step`, and in the same transaction queues a **watchdog** run for the new step 90 s later (`LEASE_MS`), so a worker that dies mid-call is picked up.
2. **Act** with no transaction open: submit, poll, or download and store (`ImageService.storeBytes` on `design_concept`: the format sniff, metadata strip and copies apply).
3. **Write** the outcome under the lock, only if the row is still at the claimed step (otherwise the watchdog took over, and files this run stored are deleted). Then queue the next poll (2 s, growing by 1 s every other poll, at most 10 s).

A repeated or stale delivery finds the step moved on and does nothing. **A submit happens at most once per attempt**: `submitted_at` is set at the claim, and a run that finds it set with no provider id never submits again. The outcome is unknown, so it fails as `submit_unconfirmed` and the artist may retry. A 429, or a server error with an HTTP answer, means the request was not accepted: the generation stays `queued` and backs off (5 s doubling, at most 2 min, 6 tries, 15 minutes from acceptance). Results get 10 minutes from the submit. A ready image that can't be downloaded or stored gets 3 tries. A run that keeps throwing ends in `failed()` → `giveUp`, which marks the generation `worker_failed` only if that run still owned it. `SweepStuckDesignGenerationsJob` (every 10 minutes, `start/scheduler.ts`) queues `FailStuckDesignGenerationJob` (a `TenantJob`) for each generation untouched for 30 minutes. That job fails it as `timed_out` under its lock.

The polling URL is sealed with the app's encryption key (`APP_KEY`, purpose bound to the generation id) and never leaves the server. The provider id, cost and seed are stored. Logs carry ids, attempts and failure codes, never prompts, URLs or keys. A failure to authenticate or pay (`provider_unavailable`) logs at error level for operators.

## Retry

`POST /t/:tenant/design-lab/generations/:id/retry` with the attempt the page showed. A failed generation is retried in place as its next attempt, with a new reservation, a bumped `step` (old jobs are fenced off) and a new job, at most 5 attempts in all. Moderated and provider-rejected requests are not retryable: they would be refused again. A second click, or a retry of an attempt already retried, changes nothing.

## Usage and cost

TattooDrip pays the provider. The account balance is TattooDrip's and is never shown as a studio's balance. Each studio may start `DESIGN_LAB_MONTHLY_LIMIT` generations per calendar month (UTC, default 40). One submit may ask for up to `DESIGN_LAB_MAX_VARIATIONS` images (default 2, at most 4). Each image is its own provider request and counts on its own, and the form says how many it will use before it is sent. A generation attempt is **reserved** when accepted (under a per-studio advisory lock, so the last unit can't be taken twice), **settled** once its image is stored, and **released** when it fails or is moderated. Settling and releasing only change a `reserved` row, so nothing counts twice. The provider's reported cost (BFL's `cost`, in credits) is recorded as actual credits, and `DESIGN_LAB_CREDITS_PER_IMAGE`, when set, as the estimate. The browser sends no count, cost, model or limit that the server uses.

Submits are idempotent: the page renders a `requestId`, and a repeated form (a double click or a retried request) returns the generations already made.

## Privacy and provider terms

Before a member's first generation in a studio, the form shows the provider notice (`#modules/design_lab/notice`) and requires the acknowledgement. The notice says:

- requests are processed by BFL;
- BFL handles inputs and outputs under its API terms and usage policy and may keep them for a limited time to run and safeguard its service;
- only the concept text and options are sent (never client names, contact details, booking notes or photos);
- members must not describe real people without consent, must never describe minors, and must leave out personal details;
- results are concepts for review, private to the studio.

The words summarise BFL's terms as understood when this was written. **Review them against the current [FLUX API Service Terms](https://bfl.ai/legal/flux-api-service-terms) and usage policy before launch**, especially the retention period, whether inputs are used for training, and any end-user policy or AI-disclosure duties. There are no image uploads in the MVP. A reference-artwork upload would need an explicit "I have the rights to use this" confirmation and the same no-people rule.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DESIGN_LAB_PROVIDER` | `off` in production, `preview` elsewhere | `off`, `preview` or `bfl` |
| `BFL_API_KEY` | none | Required with `bfl`. Server only: never in props, logs or responses |
| `BFL_MODEL` | none | Required with `bfl`: the endpoint name after `/v1/` in BFL's API reference that the account supports. No default, so it is always a conscious choice |
| `BFL_API_URL` | `https://api.bfl.ai` | Must be https in production. A regional endpoint (e.g. `https://api.eu.bfl.ai`) works the same way |
| `DESIGN_LAB_MONTHLY_LIMIT` | 40 | Per studio per calendar month; 0 turns generation off for everyone |
| `DESIGN_LAB_MAX_VARIATIONS` | 2 | 1 to 4 |
| `DESIGN_LAB_CREDITS_PER_IMAGE` | none | Optional estimate for the ledger |

Going live: set `DESIGN_LAB_PROVIDER=bfl`, `BFL_API_KEY` and `BFL_MODEL` on the web **and** worker processes, run the migration, restart both, and generate one concept as an owner to confirm. Before choosing `BFL_MODEL`, check in BFL's API reference that the model takes `prompt`, `width` and `height` (or `aspect_ratio`), `output_format`, `safety_tolerance`, and returns `id` and `polling_url`.
