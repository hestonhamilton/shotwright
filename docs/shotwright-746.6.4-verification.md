# shotwright-746.6.4 — E6.V: init verification

Verification date: 2026-07-30, against merged `main` `1dc5ed6` (E6.I, PR #12).
Executed directly; commands and observed output recorded below rather
than asserted. Consumer-shape probes ran against **`git archive` copies** of
two consumer repositories (consumer B and consumer C) — both repos verified untouched afterwards (E8 owns
actual migration, not E6.V).

## Epic acceptance (amended 2026-07-30)

> Running init in a fresh vite project yields a working `pnpm shots` +
> `/shots-harness` skill with no manual file edits beyond webServer config,
> after running the single generated `pnpm shots:install` command that init
> prints as its first next step.

**Result: PASS on the capture path; PARTIAL on the skill clause.** Stated
precisely, because the two clauses are proven to different depths (V-gate
redteam finding, accepted):

- *"working `pnpm shots` … after `pnpm shots:install`"* — **proven end to end**
  against a genuinely fresh vite app with a cold browser cache, with no file
  edited between `init` and a real capture (V3).
- *"`/shots-harness` skill"* — **proven installed and valid, not proven
  exercised.** Recorded evidence (V4a): the file is written to
  `.claude/skills/shots-harness/SKILL.md`; its frontmatter parses with
  `name: shots-harness` matching the directory, so `/shots-harness` resolves;
  the shape matches this repo's known-good skills; and every command it teaches
  parses to the intended flags. What was **not** done is loading it into an
  agent session and having it drive a capture. Calling that "end to end" would
  have been an overclaim.

## Pin matrix

| # | Pin | Result |
|---|---|---|
| 1 | `pnpm run typecheck` on merged main | PASS |
| 2 | `pnpm run lint` (eslint + build + publint) | PASS — `All good!` |
| 3 | `pnpm run test` | 198/198 — **but see the flake in Residuals** |
| 4 | `pnpm run smoke` | 17/17 |
| 5 | Cold browser install via generated `shots:install` | PASS (V3) |
| 6 | Fresh vite: init → shots:install → shots → gallery | PASS (V3) |
| 7 | Capture is genuinely the consumer's app | PASS (V3) — unique marker, viewed |
| 8 | Gallery renders in a real consumer, zero page errors | PASS (V4) — viewed |
| 8a | Generated skill installed, valid, `/shots-harness` resolves | PASS (V4a) — **not** proven exercised by an agent |
| 9 | Re-run idempotency | PASS (V5) |
| 10 | Real vite consumer with a conflicting `shots` script | PASS (V6, consumer B) |
| 11 | Real non-vite consumer with a pre-existing skill | PASS (V7, consumer C) |
| 12 | Consumer repos untouched by verification | PASS |

## V1 · Packed-artifact consumer proof

`pnpm pack` → `shotwright-0.1.0.tgz` (34,297 bytes), installed into the fresh app
alongside the `@playwright/test` peer. `node_modules/.bin/` then contained both
`shotwright` and `playwright`, confirming E2's finding that consumers get the
real bin (the package's own checkout does not).

## V2 · Fresh vite project

Created with `npm create vite@latest freshapp -- --template vanilla-ts` —
genuinely fresh, not a fixture. Resolved `vite ^8.2.0`, `@playwright/test
^1.62.1` (inside the `>=1.60 <2` peer range, ADR 0002).

## V3 · The acceptance chain, cold

`shotwright init` → exit **0**:

```
shotwright init: detected vite — wrote an executable webServer default for http://127.0.0.1:5173

Created
  shots.config.ts
  shots/example.shots.ts
  .claude/skills/shots-harness/SKILL.md

Updated
  package.json (scripts)
  .gitignore (+3 entries)

Next steps
  1. pnpm shots:install     # download the browser (one time)
  2. pnpm shots
  3. pnpm shots:gallery
```

Generated config calls `defineShotsConfig()` with `webServer` **inside** the
factory argument, satisfying the ADR 0005 probe contract, and carries no `--`
separator in `webServer.command` (ADR 0006 / plan §0).

**Cold install — closes the E6.I residual.** With `PLAYWRIGHT_BROWSERS_PATH`
pointed at an empty directory (`0 entries` before), `pnpm shots:install`
downloaded 114.7 MiB and exited **0**; the cache then held `chromium-1234`,
`chromium_headless_shell-1234`, `ffmpeg-1011`. The E6.I smoke could only prove
the command was *invoked* because Playwright's installer hangs in a restricted
sandbox — that was an environment limitation, not a defect, and is now settled.

`pnpm shots` → exit **0**, `1 shot(s)` written. **No file was edited between
init and a working capture** — the acceptance's central claim.

Playwright warned `Port 5173 is in use on a wildcard address, but 127.0.0.1:5173
is available`. Because `reuseExistingServer` is true outside CI, a silent
capture of *someone else's* server would have been a false pass on the
acceptance — so this was checked rather than reasoned about.

First check (weak, recorded for honesty): the capture showed the vite starter
page. The V-gate redteam correctly objected that generic starter text is not a
consumer-unique fingerprint — another vite app on the wildcard address would
look identical.

Second check (conclusive): a unique string `E6V-MARKER-7f3a9c21` was injected
into the fresh app's `index.html` body and `pnpm shots` re-run. The marker
appears in the resulting capture, positively identifying the captured page as
**this** consumer's app. The generated `--host 127.0.0.1 --strictPort` bound our
own server as intended.

## V4 · Gallery, viewed

The run auto-published `gallery.html`. Rendered at 1440×960 DSF 2 and inspected:
run header with the intrinsic badge (`Published manifest · pass/fail status is
not embedded`), `1 shot` / `1 spec`, `Video and trace absent in this run`,
versions `shotwright 0.1.0 · Playwright 1.62.1`, manifest `v1 · 668 bytes`, spec
workbench for `example.shots.ts`, DSF chip, and the capture itself. **Zero page
errors.** Satisfies the repo's own gate — an unviewed UI change does not ship.

## V4a · The generated skill

Recorded, since the acceptance names the skill explicitly:

```
.claude/skills/shots-harness/SKILL.md
---
name: shots-harness
description: Use when capturing Playwright-powered UI walkthrough artifacts with shotwright for human review.
---
```

`name` matches the containing directory, so `/shots-harness` resolves; the
frontmatter shape matches this repo's own known-good skills
(`.agents/skills/rpiv/SKILL.md:1-4`). Every command the skill teaches was
extracted and parsed:

```
pnpm shots
pnpm shots --only home
pnpm shots --video --trace
pnpm shots -- --workers=1
pnpm shots --video -- --workers=1
pnpm shots -- --trace retain-on-failure
pnpm shots:gallery
pnpm shots:gallery --lan
```

All correct under plan §0 and ADR 0006 — note the skill teaches the `--trace`
carve-out (`-- --trace retain-on-failure` stays with Playwright) and never puts
a `--` before a gallery flag.

**Limit of this pin:** the skill is proven *installed, discoverable, and
internally correct*. It was not loaded into an agent session and made to drive a
capture. That is the honest boundary of the skill clause.

## V5 · Re-run idempotency

Second `shotwright init` in the configured app → exit **0**:

```
shotwright init: already set up — nothing to change

Up to date
  shots.config.ts, shots/example.shots.ts, package.json scripts, .gitignore, .claude/skills/shots-harness/SKILL.md
```

No duplicated scripts, no duplicated ignore lines. The generated `.gitignore`
additions appended below vite's own entries with everything preserved.

## V6 · consumer B — real vite consumer, conflicting script

Consumer B is a real vite app that **already defines a `shots` script**
(a custom node script). This is the exact case plan §4's exit-code rule was
written for, occurring in a real project rather than a fixture.

`shotwright init` → exit **1**:

```
shotwright init: cannot claim the `shots` script

  package.json already defines:
      "shots": "node <existing-script>"
  shotwright did not change it.

  Rename your existing script, or run captures with `pnpm exec shotwright run`.
```

Their script was left byte-identical. Exit 1 is correct here — `pnpm shots`
would not run shotwright, which is the "genuinely broken" case. The files init
*did* write are listed honestly under `Created`; no success wording appears.

## V7 · consumer C — non-vite consumer with a pre-existing skill

Consumer C is a non-vite project (no vite dependency) and already carries its own
harness: `playwright.shots.config.ts`, `e2e/shots/*.shots.ts`, a `shots` script,
**and an existing `.claude/skills/shots-harness/SKILL.md`**. The richest
collision surface available, and a preview of E8.

`shotwright init` → exit **1** (script conflict), with:

- The **non-vite placeholder** config written — commented `webServer`/`baseURL`,
  no fabricated vite assumption on a non-vite project.
- Their existing `SKILL.md` **not overwritten** — verified byte-identical to
  `git show HEAD:` — with `SKILL.md.new` written beside it and surfaced under
  `Needs your review`. The never-overwrite rule (R redteam reversal) holds
  against a real prior skill.
- `playwright.shots.config.ts` byte-identical — their harness untouched.
- `.gitignore (+1 entries)` — accurate: they already ignore `playwright-report/`
  and `test-results/`, so only `shots-output/` was missing. The count excludes
  the comment line (the A2 repair), and the diff confirms exactly one entry plus
  the comment were appended.

## Residuals

1. **Unit suite flaked once — `shotwright-746.10` (open).** During pin 3 the
   suite reported `Tests 1 failed | 197 passed (198)`. It passed immediately on
   re-run and did **not** reproduce across 11 further runs, including 3
   replications of the exact `typecheck; lint; test` sequence. The failing test
   name was lost because the capture grep filtered to summary lines — recorded
   as the collection mistake. Most plausible culprit is the pre-existing
   E3-era `test/unit/gallery-browser.test.ts`, which drives a real Chromium over
   60 cards with a 2 s per-card `waitFor` and asserts `live <= 3`
   (`gallery-browser.test.ts:195-204`) — load-sensitive, and the failure landed
   directly after `lint` (full build + `pnpm pack`) with browser downloads and
   consumer installs in recent flight. `cli.test.ts:129` was ruled out
   (`/tmp/node_modules` absent).

   **The culprit is unidentified.** An earlier draft of this doc said "not
   introduced by E6"; the V-gate redteam was right that losing the test name
   makes that unprovable, and it has been withdrawn. E6's own additions — chiefly
   the new `test/unit/init.test.ts` — are **not** excluded, though a static scan
   found per-test temp dirs with `afterEach` cleanup and no global/env mutation
   there. Filed rather than waved off, because "the suite is green" is a claim
   this repo's philosophy rests on.
2. **`resolveSkillDestination` handles only `ENOENT`** (`src/init.ts`). Any
   other `lstat` error surfaces as a raw message. Fails safe — `planInit` throws
   before any write — and no scenario reachable in the three consumer projects
   triggers it. Considered and **declined** under the practical-bite bar.
3. **`+1 entries` grammar.** Cosmetic; declined, consistent with the E3
   precedent that declined the `1 shots` grammar nit.
4. **Symlinked `.claude/skills` not exercised on a real consumer.** Neither
   consumer B nor consumer C uses a symlink there (shotwright itself does). The
   path is covered by unit and smoke fixtures, so this is a gap in *real-shape*
   coverage only.

## V-gate redteam dispositions

Raw notes archived outside the repo. One redteam, per convention.

**Accepted and corrected (both were overclaims in the draft):**
- *Skill usability.* The draft called the acceptance "proven end to end" while
  only evidencing that the skill file was written. Now split into a proven
  clause and a partial one, with V4a recording exactly what was checked.
- *Flake attribution.* The draft said "not introduced by E6"; losing the failing
  test name makes that unprovable. Withdrawn here and on `shotwright-746.10`.

**Accepted and fixed by doing more work, not by softening wording:**
- *Wrong-app capture.* The redteam noted generic vite starter text is not a
  consumer-unique fingerprint. Re-ran the capture with a unique injected marker;
  it appears in the output, so the identification is now positive rather than
  inferred (V3).

**Declined:** the cold-install pin does not overclaim — the acceptance is
consumer-local, not a CI cold-download guarantee, and the smoke helper still
tolerates an installer timeout by design.

**Independently re-verified by the redteam:** both consumer repos untouched
(`git -C <path-to-consumer-checkout> status` for each of the two, each clean
on `main`), and V6/V7 scoping.

## What was not proven

- No consumer was actually migrated. V6/V7 ran against `git archive` copies and
  deliberately stopped at `init`; neither project booted its stack or captured
  shots through shotwright. E8 owns that.
- The non-vite path was proven to *scaffold* correctly, not to *capture* — doing
  so requires filling in `webServer`, which is by definition beyond init.
