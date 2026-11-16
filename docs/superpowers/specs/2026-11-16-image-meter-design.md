# Design Lab image meter

Date: 2026-11-16. Status: approved by the product owner in conversation (short design). Phase 5, first meter, of [studio packages](2026-11-15-studio-packages-design.md) (Allowances, ruling 12).

## Intent

Each studio's monthly Design Lab generations come from its package's allowance bundle instead of one platform-wide setting, so the packages can differ in images once quantities are set, and the admin can see real use before setting them.

## Goals

- **The limit's source.** With `PACKAGE_ENFORCEMENT=enforce`, a studio's monthly limit is its entitlement's bundle `images_per_month`: the trial's, the paid package's or the pilot grant's bundle. In observe mode (the default) `DESIGN_LAB_MONTHLY_LIMIT` stays in force, and a request the bundle would have refused goes ahead and is logged `Package rule would refuse` (rule `image_allowance`), like the artist limit.
- **The ledger is unchanged.** Reserve, settle, release, the calendar month (UTC), the burst limit and the released-attempts cap (which follows the limit in force).
- **The Design Lab page** shows the limit in force in "X of Y left". With 1 to 5 left it adds a warning with the exact count and the reset date.
- **At the limit** the refusal names the blocked action and the reset date, says what still works, and offers Studio only when Studio's default bundle gives more images than the limit in force: "Your studio has used all N generations for this month. New generations are paused until D; your designs and history stay available." (+ " The Studio package includes M a month." when it applies).
- **Admin.** Each studio's admin page (Package section) shows "Design Lab images this month: U of L", where U counts settled and reserved images. In observe mode, when the bundle's number differs from the limit in force, it adds the package's number.

## Non-goals

- Real quantities (both bundles keep their placeholder 40) and the mid-month increase on upgrade: open business decisions, the second waiting for phase 4.
- The storage meter, and Design Lab's generated images counting toward storage.
- Extra credits.

## Anti-goals

- A studio refused by a bundle while observe mode is on.
- A changed count: a released attempt still never counts, and nothing the browser sends decides a limit.

## Calls made (the product owner's approval covers them)

- A bundle with no image number (`images_per_month` null, "not metered yet") falls back to `DESIGN_LAB_MONTHLY_LIMIT`.
- The warning shows at 5 or fewer left.
- `DESIGN_LAB_MONTHLY_LIMIT=0` stays the global off switch in every mode (docs/design-lab.md documents it as turning generation off for everyone); a bundle never turns generation back on.
- The Studio offer shows only in enforce mode: in observe mode the setting applies to every package, so upgrading wouldn't help.

## Left to the builder

Where the bundle lookup lives, the log's fields, the warning's markup, test structure (service tests for enforce, observe and the null fallback, the refusal's words, the page's warning text, the admin line).
