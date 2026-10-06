# shotwright-746.6.2 — E6.P: init scaffold + generalized skill plan

Plan date: 2026-07-30. Synthesized from a delegated plan draft and its redteam (raw notes archived
outside the repo).
Binding input: `docs/shotwright-746.6.1-research.md`. Repo claims verified
against `f4346bf`. No code changed in this phase.

## Binding constraints (from R, not reopened here)

- **CI is a seam.** E6 writes no workflow file; E7 owns that design.
- **init does not install browsers.** It prints `pnpm shots:install` as its
  *first* next step.
- **Template resolution:** one helper, `new URL('../templates/…', import.meta.url)`
  from the compiled `dist/` CLI.
- **`SKILL.md` is never overwritten** — `.new` sibling instead.
- **`--dry-run` ships; package-manager detection does not.**
- Amended epic acceptance: a fresh vite project yields a working `pnpm shots`
  plus the skill, **no manual file edits beyond webServer config**, after the
  one generated `pnpm shots:install` command.

## 0. The separator rule — read before writing any command string

Research §2 measured this and the P-phase draft still got it wrong **three
times**, so it is stated once here and every generated string in this plan is
checked against it:

> `pnpm run <script> -- <args>` forwards the **literal `--`** into the script
> command. `shotwright run` treats `--` as its passthrough boundary
> (`src/cli.ts:49-51`). `shotwright gallery` has **no** passthrough handling at
> all — `parseGalleryArgs` throws `unknown argument: --` because it starts with
> `-` (`src/cli.ts:127-129`).

Consequences, all verified against the parsers:

| Intent | Correct | Wrong |
|---|---|---|
| shotwright flags on `run` | `pnpm shots --only home --video` | `pnpm shots -- --only home` |
| Playwright flags on `run` | `pnpm shots -- --workers=1` | `pnpm shots --workers=1` |
| both | `pnpm shots --video -- --workers=1` | — |
| gallery flags | `pnpm shots:gallery --lan` | `pnpm shots:gallery -- --lan` (errors) |
| re-running init | `pnpm exec shotwright init` | `pnpm shotwright init` (not a script; exits 254) |

**I-phase requirement:** every command string in a template, in printed output,
or in the generated `SKILL.md` is covered by a test asserting it parses to the
intended flags. Strings are not reviewed by eye — the class of error is too easy.

## 1. init file manifest

| Destination | Source | Behavior when absent | Behavior when present |
|---|---|---|---|
| `shots.config.ts` | `templates/init/shots.config.ts` + rendered webServer block | write | identical → no-op; **different → leave alone, report "yours, left alone"** (§4) |
| `shots/example.shots.ts` | `templates/init/shots/example.shots.ts` | write | identical → no-op; different → leave alone, report |
| `.gitignore` | `templates/init/gitignore.snippet` | create | append only missing lines; preserve content, order, final newline |
| `package.json` scripts | structured mutation | add `shots`, `shots:gallery`, `shots:install` | identical → no-op; **name taken by a different command → report, exit 1** (§4) |
| `.claude/skills/shots-harness/SKILL.md` | `templates/skills/shots-harness/SKILL.md` | write | identical → no-op; different → never overwrite, write `.new`, report |
| CI workflow | — | not written (seam) | — |

Nothing else is written. There is **no** `templates/github/` directory and no
`.gitkeep`: an empty directory shipped in the published tarball is a path-shaped
promise about a workflow E7 has not designed yet, with no init caller. The seam
is a documented decision, which costs nothing; a placeholder file is
scaffolding-for-scaffolding (redteam, agreed).

## 2. Module decomposition

**`src/init.ts`** (new)

- `parseInitArgs(argv)` → `{ dryRun }`. Only `--dry-run`. Unknown flags throw
  with usage. No `--force`: skip-and-report covers every managed collision
  without risking consumer-owned files, and no concrete collision requires
  overwrite. (R demoted it to "only if P justifies it"; P does not.)
- `planInit(cwd, readTemplate)` → `InitPlan`. Pure-ish: reads, decides, writes
  nothing. Used by both `--dry-run` and the apply path, so it is genuinely
  two-caller and is where all the semantics live.
- `applyInitPlan(plan)` → `InitResult`. Sequential writes, recording each
  completed write *before* attempting the next, so a throw leaves an accurate
  ledger. One caller, justified: it isolates mutation and is the whole basis of
  the no-false-success guarantee.
- `detectVite(pkg)`, `mutatePackageJsonScripts(raw, desired)`,
  `resolveSkillDestination(cwd)` — helpers, each with pinned edge-case semantics
  in §5.

**`src/templates.ts`** (new)

- `templateUrl(rel)` → `new URL('../templates/' + rel, import.meta.url)`. The
  **single** place encoding `dist/`↔`templates/` adjacency, so ADR 0003's
  possible future bundler swap touches one line.
- `readTemplate(rel)` → string.

**`src/cli.ts`** (edit)

- Add `init` to the command switch and usage (`src/cli.ts:307-316`).
- Add a non-fatal warning in `run()`: if `passthrough` contains `--only`,
  `--video`, or `--trace`, warn to stderr that shotwright flags belong before
  `--`. This ships in E6 — the papercut is consumer-facing, it has already
  produced one wrong committed doc (`shotwright-746.9`) and three wrong strings
  in this plan's own draft, and documentation alone has now demonstrably failed
  to prevent it. It does not change exit codes.

`templates/`:

```
templates/
  init/
    shots.config.ts
    shots/example.shots.ts
    gitignore.snippet
  skills/shots-harness/SKILL.md
```

## 3. Template contents

**`templates/init/shots.config.ts`**

```ts
import { defineShotsConfig } from 'shotwright'

export default defineShotsConfig({
  shotsDir: 'shots',
{{webServerBlock}}
})
```

`webServer` stays *inside* the factory call: probe mode suppresses server boot
while still reporting `outputDir` (`src/index.ts:39-54`), and run mode passes it
through (`src/index.ts:87`). A config that hoists `webServer` outside the call,
or omits `defineShotsConfig()`, is rejected by `shotwright gallery`
(`src/cli.ts:213-227`).

Detected-vite render:

```ts
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: !process.env.CI,
  },
```

Two deliberate choices. **No `--` separator** (§0) — the draft's
`pnpm dev -- --host …` hands the flags to vite on the far side of an argument
terminator, so `--strictPort` never applies; vite then silently moves off an
occupied 5173 while Playwright waits on `http://127.0.0.1:5173/` forever. That
sat directly on the acceptance path. **`pnpm exec vite` rather than `pnpm dev`**
— detection only proves a `dev` script *exists*, not that it is vite-shaped
(`npm-run-all dev:*` is a real pattern), and appending flags to an unknown
script is a guess. Invoking the binary directly is what E2/E3 consumer proofs
already do.

Non-vite render — commented placeholder, so the failure is actionable rather
than a fake server assumption:

```ts
  // Point these at the command and URL that boot your app for review captures.
  // use: { baseURL: 'http://127.0.0.1:5173' },
  // webServer: {
  //   command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort',
  //   url: 'http://127.0.0.1:5173/',
  //   reuseExistingServer: !process.env.CI,
  // },
```

Detection is narrow and stated: `vite` in `dependencies`/`devDependencies`. The
package stays stack-agnostic (`docs/design.md:57-61`); vite is a scaffold
convenience for a project that already declares it, never a package invariant.

**`templates/init/shots/example.shots.ts`**

```ts
import { shot, walkthrough } from 'shotwright/capture'

walkthrough('home page', async ({ page }) => {
  await page.goto('/')
  await shot(page, 'home')
})
```

Public API only (`package.json:24-31`); `walkthrough` is the `test` alias
(`src/capture.ts:19-20`). No assertions — review artifacts, not assertions.

**`templates/init/gitignore.snippet`**

```
# shotwright review artifacts — regenerated, never committed
shots-output/
playwright-report/
test-results/
```

**`templates/skills/shots-harness/SKILL.md`** — frontmatter `name: shots-harness`
plus a description, matching the local skill shape
(`.agents/skills/rpiv/SKILL.md:1-4`). Body teaches, with every command checked
against §0:

- What the harness produces and the review-artifacts-not-assertions posture.
- `pnpm shots` to capture; `pnpm shots --only <substr>` to filter (the
  walkthrough still runs, only shot *writes* are gated — `src/filter.ts:1-13`);
  `pnpm shots --video --trace` for artifacts; `pnpm shots -- --workers=1` for
  Playwright flags, and the combined form.
- Specs run only under `shotwright run` — `shot()` throws without
  `SHOTWRIGHT_RUN_DIR`, bare `playwright test` is unsupported
  (`src/capture.ts:31-37`).
- `pnpm shots:gallery` to build/serve; `pnpm shots:gallery --lan` for phone
  review — **no `--`**, gallery has no passthrough (`src/cli.ts:127-129`).
- **Delivery model** (ADR 0005): `gallery.html` embeds every screenshot's
  original bytes, so that one file alone is the complete *screenshot* artifact
  and can be handed straight to the user. Video and trace are sibling files —
  copying the HTML away breaks those links; serve the run directory instead when
  they matter.
- Serve binds loopback by default; `--lan` is opt-in and prints an exposure
  warning (`src/cli.ts:95-99`, `src/cli.ts:293-302`). The skill teaches the
  caution, not `--lan` as a default.
- A clearly marked project-notes section at the end, which init never rewrites
  (the file is never overwritten at all).

No project names, host paths, LAN IPs, or ports beyond the documented default —
it is generated into repos of unknown visibility.

## 4. CLI surface, exit codes, and output

```
shotwright init [--dry-run]
```

### The exit-code rule

The draft exited 1 whenever a managed file existed and differed. That mislabels
the healthy steady state: the acceptance *requires* the consumer to edit
`webServer`, so from the second run onward a correctly-configured project would
report `scaffold incomplete` and advise "merge or rename the skipped files" —
telling users to discard the customization they were instructed to make. That is
false reporting, so it is fixed here rather than deferred.

**Rule: exit 0 unless init left the project unable to run `pnpm shots`.**

| Case | Exit | Why |
|---|---:|---|
| Fresh scaffold written | 0 | |
| Everything already identical | 0 | |
| Config/spec exists and differs | **0** | expected customization; `pnpm shots` works |
| `SKILL.md` differs → `.new` written | **0** | project works; the skill is advisory and the old one still functions. Reported prominently as needing review |
| `--dry-run` | 0 | |
| Script name taken by a *different* command | **1** | `pnpm shots` does not run shotwright — genuinely broken |
| Bad/missing/unparseable `package.json`; unknown flag | 1 | cannot proceed |
| Filesystem failure mid-write | 1 | partial state |

The discriminator is a question about the project, not about init's own
bookkeeping: *after this returns, does `pnpm shots` do the right thing?*

### Output

Fresh vite success:

```
shotwright init: detected vite — wrote an executable webServer default for http://127.0.0.1:5173

Created
  shots.config.ts
  shots/example.shots.ts
  .claude/skills/shots-harness/SKILL.md

Updated
  package.json   scripts: shots, shots:gallery, shots:install
  .gitignore     +3 entries

Next steps
  1. pnpm shots:install     # download the browser (one time)
  2. pnpm shots
  3. pnpm shots:gallery
```

Re-run on a configured project — note exit 0 and no "resolve collisions" advice:

```
shotwright init: already set up — nothing to change

Left alone (yours)
  shots.config.ts            differs from the template, as expected
  shots/example.shots.ts     differs from the template, as expected

Needs your review
  .claude/skills/shots-harness/SKILL.md.new
    your SKILL.md differs and was not overwritten; compare and merge if you want
    the updated guidance

Up to date
  package.json scripts, .gitignore
```

Script collision (exit 1 — the one case that genuinely breaks `pnpm shots`):

```
shotwright init: cannot claim the `shots` script

  package.json already defines:
      "shots": "playwright test"
  shotwright did not change it.

  Rename your existing script, or run captures with `pnpm exec shotwright run`.

Created
  shots/example.shots.ts
  .claude/skills/shots-harness/SKILL.md
```

Partial failure (exit 1) — an exact ledger, never "complete":

```
shotwright init: failed partway through — the scaffold is incomplete

Error
  EACCES: permission denied, open '.claude/skills/shots-harness/SKILL.md'

Written before the failure
  shots.config.ts
  shots/example.shots.ts
  package.json (scripts)
  .gitignore (+3 entries)

Not attempted
  .claude/skills/shots-harness/SKILL.md

Fix the error and re-run `pnpm exec shotwright init` — it will skip what already exists.
```

Symlink notice, printed *before* any write when `.claude/skills` is a symlink:

```
Note: .claude/skills is a symlink to .agents/skills
      the skill will be written to .agents/skills/shots-harness/SKILL.md
```

`--dry-run` prints the same sections under "Would create / Would update /
Would leave alone", writes nothing, exits 0.

Misplaced-separator warning on `run` (stderr, non-fatal):

```
shotwright: warning: --video came after `--`, so it went to Playwright, not shotwright.
            Put shotwright flags first:  pnpm shots --video -- --workers=1
```

## 5. Pinned edge-case semantics

The draft left these to I-phase; pinning them here so I does not invent them.

| Input | Behavior |
|---|---|
| `package.json` with no `scripts` key | create `scripts` as the last top-level key |
| no trailing newline | preserve (do not add one) |
| minified / single-line JSON | no indented property line to sample → emit with 2-space indent, and say so in output |
| indentation is tabs / 4 spaces | detect from the first indented property line and match |
| malformed JSON | exit 1, write nothing at all, name the parse error |
| `package.json` missing | exit 1, write nothing |
| `.gitignore` with no trailing newline | add one before appending |
| `.claude/skills` symlink | resolve, report target, then write |
| `SKILL.md.new` already exists, identical | no-op, still reported |
| `SKILL.md.new` already exists, differs | leave both, report both paths |

"Write nothing at all" for the `package.json` failures means the read-and-validate
pass completes **before** any write begins — cheap to do since `planInit` is
already separate from `applyInitPlan`.

## 6. Test matrix

| Level | Test | Proves |
|---|---|---|
| Unit | `parseInitArgs` accepts `[]`/`--dry-run`, rejects others incl. `--force` | CLI surface is exactly as planned |
| Unit | `templateUrl('init/shots.config.ts')` resolves to `../templates/…` from the module URL | the single build-layout assumption lives in one place |
| Unit | **every command string** in templates + printed output, fed through `parseRunArgs`/`parseGalleryArgs` | §0 — the separator class of bug cannot ship |
| Unit | vite fixture → executable webServer with `--strictPort` and no `--` | acceptance path |
| Unit | non-vite fixture → commented placeholder + edit-first next steps | stack-agnostic invariant held |
| Unit | each row of §5 | pinned edge cases, not invented ones |
| Unit | exists-and-differs → exit **0**, "left alone" wording, file unmodified | the healthy steady state is not reported as failure |
| Unit | script name taken by a different command → exit **1** | the one genuinely-broken case |
| Unit | `.gitignore` append adds only missing lines, preserves order/newline | re-run idempotency |
| Unit | `SKILL.md` differs → `.new` written, original byte-identical afterwards | never-overwrite rule |
| Unit | symlinked `.claude/skills` fixture → target reported before write | symlink safety |
| Unit | injected write failure after N writes → exact ledger, exit 1, no success wording | no false success |
| Unit | `run()` warning fires for `--only`/`--video`/`--trace` in passthrough; exit code unchanged | warning ships without new failure modes |
| Smoke | fresh vite temp app: pack → install → `init` → `shots:install` → `shots` → `shots:gallery` | **epic acceptance**, end to end, no manual file edits |
| Smoke | re-run `init` in that app after editing `webServer` | exit 0, no duplicate scripts/ignore lines, config untouched |
| Smoke | app with `scripts.shots` already taken | exit 1, nothing overwritten |
| Smoke | app where `.claude/skills` is a symlink | target reported, file lands there |
| Smoke | `expectPackInventory()` asserts `templates/init/shots.config.ts`, `templates/init/shots/example.shots.ts`, `templates/init/gitignore.snippet`, `templates/skills/shots-harness/SKILL.md` are packed | **required** — init depends wholly on templates shipping, and a `files` edit would break every consumer with all unit tests green (`test/smoke/cli.test.ts:685-712`) |
| Smoke | tarball still excludes `docs/`, `test/`, mockups | package shape unchanged |

## 7. Assumption pins

| Assumption | I-phase proof | V-phase proof |
|---|---|---|
| Generated commands parse to intended flags | per-string parser tests (§0) | fresh-vite smoke runs them for real |
| vite default boots and Playwright reaches it | vite fixture snapshot incl. `--strictPort` | smoke: `pnpm shots` captures without hand-editing |
| Templates resolve from the packed tarball | `templateUrl` unit test | pack inventory + consumer install smoke |
| Generated config satisfies the probe contract | template snapshot has `defineShotsConfig` default export, `webServer` inside | smoke runs `shots:gallery`, which probes the config |
| Exit codes describe project health | §6 exit-code rows | re-run + collision smokes |
| Partial failure never claims success | injected-failure unit test | permission-denied smoke asserts absent success wording |
| `.new` rule loses no user content | unit: original byte-identical after `.new` | re-run smoke |
| Skill teaches the correct delivery model | template snapshot asserts ADR 0005 phrasing | packed-tarball smoke reads the skill and checks key phrases |
| Symlink never written through unreported | symlink fixture unit test | symlink smoke |

## 8. Redteam dispositions (P→I gate, 2026-07-30)

Raw notes archived outside the repo. One redteam, per convention.

**Fixed:**
- **Three separate separator bugs in generated strings** — the vite
  `webServer.command` (acceptance path; `--strictPort` would never apply), the
  printed re-run instruction `pnpm shotwright init` (not a script — exits 254),
  and the skill's `pnpm shots:gallery -- --lan` (gallery has no passthrough, so
  it errors). All three are the papercut E6 exists to eliminate, in E6's own
  output. §0 now states the rule once and §6 requires every generated string to
  be parser-tested rather than eyeballed.
- `templates/github/workflows/.gitkeep` dropped.
- `package.json` mutation edge cases pinned (§5) instead of left to I.

**Fixed beyond the redteam:**
- The exit-code semantics (§4). The draft reported `scaffold incomplete` and
  exit 1 for any managed file that existed and differed — i.e. for every
  correctly-configured project from its second run onward, while advising users
  to discard the `webServer` edit the acceptance requires. The redteam defended
  exit 1 for the `SKILL.md` path specifically as "honest"; that defence does not
  extend to the config path, and the shared "resolve collisions" framing was the
  actual defect. Replaced with a rule keyed to whether `pnpm shots` still works.

**Declined:** none outstanding — the redteam's DECLINED items were verifications
that came back sound (current-code citations; the one-caller abstractions), not
findings.

**Independently re-verified by the redteam:** `src/cli.ts` dispatches only
`run`/`gallery`; `walkthrough` is the `test` alias; `defineShotsConfig` probe
behaviour. Separately re-checked here: `parseGalleryArgs` does throw on a bare
`--` (`src/cli.ts:127-129`).

## 9. Open questions

None. Everything R deferred to P is decided above. The webServer placeholder
resolved to narrow vite detection with an executable default and an actionable
placeholder otherwise; `--force` is dropped; the misplaced-separator warning
ships in E6.
