# shotwright-746.6.1 — E6.R: init scaffold + generalized skill research

Research date: 2026-07-30. Synthesized from a delegated grounding survey (raw
findings archived outside the repo, with fuller
per-claim citations) plus a targeted empirical follow-up on pnpm argument
forwarding. Repo claims verified against `1cc2513`. Ecosystem claims web-checked
2026-07-30. Research only — no code changed.

## Binding constraints

- **Consumers stay thin.** Anything a second project would copy-paste ships in
  the package or its `templates/` (`docs/design.md:21-23`, `README.md:36-37`).
  init exists to make that literal.
- **Output is throwaway.** Captures are regenerated and gitignored; no
  golden-diff gating (`README.md:13-19`).
- **Headed public.** Nothing init generates, and nothing this phase commits, may
  carry host paths, LAN IPs, usernames, or personal data (`docs/design.md:38`).
- **Epic acceptance:** running init in a fresh vite project yields a working
  `pnpm shots` + `/shots-harness` skill with **no manual edits beyond webServer
  config**.
- **CI seam — owner decision, 2026-07-30.** The epic text lists the CI workflow
  file among init's outputs, but E7 owns the reusable artifacts-only workflow
  design and has not run (`docs/design.md:127-128`). E6 builds the template
  mechanism and leaves a CI-shaped slot; E7 drops its workflow in. E6 does not
  invent a workflow for E7 to unpick.

## 1. What a consumer must own today

Walked `src/`, `demo/`, and `package.json`. The public surface a consumer
touches is already narrow — `defineShotsConfig` from `shotwright`, `shot` /
`walkthrough` from `shotwright/capture` (`package.json:19-31`), driven by the
`shotwright` bin (`package.json:33-35`). `demo/shots.config.ts` is the closest
existing model of a consumer config, and it uses the public entry, not `src/`
(`demo/shots.config.ts:1-12`).

Splitting the consumer surface into what init should generate versus what stays
genuinely project-specific:

| Surface | init generates | Stays project-specific |
|---|---|---|
| `shots.config.ts` | Import, `export default defineShotsConfig({…})`, `shotsDir: 'shots'`, comments marking the one block to edit | `webServer.command` / `.url` / `reuseExistingServer`, usually `use.baseURL` |
| `shots/example.shots.ts` | One runnable spec proving the `walkthrough` + `shot` shape | All real specs: routes, labels, fixtures, shot names |
| `package.json` scripts | `shots`, `shots:gallery`, `shots:install` | Script names only if the consumer renames them |
| `.gitignore` | Appended output entries (`shots-output/`, `playwright-report/`, `test-results/`) | Pre-existing content, preserved |
| `.claude/skills/shots-harness/SKILL.md` | The managed generic body | The project-notes section (§5) |
| CI workflow | *(seam only — E7)* | — |

Two things that look like consumer surface but are not: the repo's own
`demo:shots` script is `pnpm run build && node dist/cli.js run --config …`
(`package.json:43`) — it builds and invokes `dist` directly because the package
self-tests its own build, which no consumer does; and `demo/` itself (the vite
app, `demo/vite.config.ts`) is the package's test fixture, not scaffold.
`package.json:15-18` already restricts the published tarball to `dist` and
`templates`, so neither leaks.

`shots:install` is not optional garnish — ADR 0002 already commits init to
scaffolding it as `playwright install chromium`, because the browser install
belongs to the consumer's Playwright under the peer-dependency model
(`docs/adr/0002-playwright-peer-dependency.md:19-22`).

## 2. The argument-forwarding papercut — and what is actually true

The two committed verification docs **contradicted each other** on how to pass
flags through `pnpm run`, and E6 is the phase that would have propagated the
wrong one into every consumer's scripts and skill file. Resolved empirically
rather than by reading (evidence archived outside the repo; pnpm 10.13.1, Node v24.16.0).

**The mechanism.** `pnpm run <script> -- <args>` forwards the **literal `--`**
into the script command. shotwright's own parser treats `--` as the passthrough
boundary and routes everything after it to Playwright (`src/cli.ts:49-51`).
So the separator that pnpm users reach for by reflex is precisely the token that
takes shotwright's flags away from shotwright.

Measured, showing what `parseRunArgs` actually received:

| Invocation | Parsed result |
|---|---|
| `pnpm run demo:shots --only theme-dark` | `only: "theme-dark"`, passthrough `[]` ✅ |
| `pnpm run demo:shots -- --only theme-dark` | `only: null`, passthrough `["--only","theme-dark"]` ❌ |
| `pnpm run demo:shots --video --trace` | `video: true, trace: true` ✅ |
| `pnpm run demo:shots -- --video --trace` | `video: false, trace: false`, passthrough `["--video","--trace"]` ❌ |
| `pnpm run demo:shots -- --workers=2` | passthrough `["--workers=2"]` ✅ (intended use) |
| `pnpm run demo:shots --only theme-dark -- --workers=2` | `only: "theme-dark"` **and** passthrough `["--workers=2"]` ✅ |

**There is no valued-vs-boolean asymmetry** — the hypothesis that `--only x`
behaves differently from bare `--video` is false; all shotwright flags behave
identically.

**Nor is the compound-script shape the cause.** A plausible reading was that the
trap is an artifact of the repo's compound self-test script
(`pnpm run build && node dist/cli.js …`, `package.json:43`) and that a consumer
with a plain `"shots": "shotwright run"` would never hit it. Tested directly
against the non-compound `build` script: pnpm appends the literal `--`
identically. **The footgun is real, consumer-facing, and init must document
around it.**

### A committed doc is wrong

`docs/shotwright-746.3.4-verification.md:37-40` records
`CI=1 pnpm run demo:shots -- --video --trace` as "the working form" and
explicitly earmarks it for E6's consumer docs. That command does not enable
shotwright's video or trace — it hands both tokens to Playwright as passthrough
(`src/cli.ts:49-51`, `src/cli.ts:269`).
`docs/shotwright-746.2.4-verification.md:93-97` is the correct one.

And the forwarded tokens are not merely misrouted — they are **invalid**.
`playwright test` exposes `--trace <mode>` with a required value and has **no
`--video` flag at all** (verified against the pinned Playwright; see
<https://playwright.dev/docs/test-cli>). So the recorded command errors on an
unknown option before any capture runs.

That resolves the ambiguity rather than leaving it open. E3.V records concrete
observed artifacts — a byte-exact `206` WebM range response, a trace served as
`application/zip`, a real 1.40 s WebM seek — so video and trace demonstrably
existed in that run. Since the recorded command *cannot* have produced them, the
doc is a **mis-transcription**, not a description of a subtly-wrong run. Pin 6's
conclusion stands; its reproduction record does not. Filed as
**`shotwright-746.9`**.

### What init must therefore generate

- Consumer script: `"shots": "shotwright run"` — plain, non-compound, invoked
  through the consumer's `node_modules/.bin` PATH injection, never a hard-coded
  `./node_modules/.bin/shotwright` or any `dist/` path. E2 records that
  `pnpm exec shotwright` does not work from shotwright's own checkout (bin
  linking applies to dependents, not self) while consumers get the real bin
  (`docs/shotwright-746.2.4-verification.md:99-102`), and E3's consumer proof
  ran via the consumer's `.bin` (`docs/shotwright-746.3.4-verification.md:41-43`).
- Generated docs and `SKILL.md` must show **no `--` before shotwright flags**,
  and reserve `--` for Playwright passthrough, with the combined form
  (`pnpm shots --only x -- --workers=2`) shown explicitly — it is the one an
  agent is most likely to get wrong.
- P should consider whether the CLI itself should *detect* the mistake:
  a leading `--only`/`--video`/`--trace` appearing inside `passthrough` is
  almost certainly a misplaced separator, and a one-line warning would close
  this papercut at the source rather than relying on documentation. Recorded as
  a P-phase option, not a research decision.

## 3. The config-probe contract — a hard constraint on the template

`shotwright gallery` does not guess where output lives. It resolves the
consumer's own Playwright CLI and evaluates the selected config in list mode
with `SHOTWRIGHT_CONFIG_PROBE_FILE` set; `defineShotsConfig` sees that env var,
writes the resolved absolute `outputDir` to the probe file via a unique temp
file plus atomic rename, and returns a no-test config with no webServer,
reporter, or run-dir side effects (`src/index.ts:39-54`;
`docs/adr/0005-gallery-single-file-inline-originals.md:38-42`). The CLI rejects
a config that never calls `defineShotsConfig()`, and rejects non-canonical probe
values (`src/cli.ts:213-227`). Unit tests pin all of it
(`test/unit/factory.test.ts:84-107`, `test/unit/cli.test.ts:180-189`).

What this binds for the generated template — each of these is a way init could
silently break `gallery` for every consumer:

1. The config **must** have a default export that calls `defineShotsConfig()`.
   A hand-rolled `defineConfig` passes `playwright test` and fails `gallery`.
2. A custom `outputDir` must be passed **through `defineShotsConfig`**, never
   duplicated into a script flag or the gallery command.
3. `webServer` must live **inside** the `defineShotsConfig({ webServer })`
   argument, so probe mode can suppress server boot while run mode passes it
   through untouched (`src/index.ts:34`, `src/index.ts:87`).

Point 3 is the sharp one for E6: the epic's "no manual edits beyond webServer
config" means the generated config's editable region is exactly the field whose
placement the probe contract constrains. The template must make the right
placement the obvious one — an edit-here comment inside the
`defineShotsConfig({…})` call, not a `webServer` const spliced in beside it.

## 4. `templates/` — layout and runtime resolution

### What already ships

`templates` is **already** in `package.json` `files` (`package.json:15-18`), and
ADR 0003 already states templates ship as plain files untouched by the build
(`docs/adr/0003-tsc-only-build.md:36-37`). The directory simply does not exist
yet. The build is `tsc -p tsconfig.build.json` with `rootDir: src` — it will
never see or transform `templates/`. The package is ESM (`package.json:5`).

### Proposed layout

```
templates/
  init/
    shots.config.ts
    shots/example.shots.ts
    gitignore.snippet
  skills/shots-harness/SKILL.md
  github/workflows/          # seam — E7 fills this
```

Directory-shaped skills with a `SKILL.md` match the local convention
(`.agents/skills/rpiv/SKILL.md:1-6`).

### Resolution — the decision that matters

Templates must be found at runtime from inside a consumer's `node_modules`,
under pnpm's symlinked store. Options assessed:

| Option | Verdict |
|---|---|
| `new URL('../templates/…', import.meta.url)` from `dist/cli.js` | **Recommended.** Survives tsc-only build (templates are never transformed), uses the existing `files` contract, needs no new `exports` entry, and is Node's documented ESM pattern for loading files relative to a module. Note the compiled CLI lives in `dist/`, so the path is `../templates`, not `./templates`. |
| `import.meta.resolve('shotwright/templates/…')` | Blocked by the current `exports` map — with `exports` present, only exported subpaths are reachable. Would force templates into the public API surface for no gain. |
| `createRequire(import.meta.url).resolve(…)` | Same `exports` problem, more machinery. Warranted only for resolving a *different* package. |
| Templates inlined as TS string constants | Immune to layout concerns, but a generalized `SKILL.md` and a config template become large multiline literals — worse to review, worse to diff, and it discards the plain-file shipping ADR 0003 already chose. |
| `process.cwd()/node_modules/shotwright/templates/…` | Reject. Breaks when init runs from a subdirectory, and assumes a flat physical tree pnpm does not provide. |

**Recommendation: `import.meta.url` relative resolution.** It is the only option
that adds no public surface and no build step.

**Stated cost (redteam):** this couples runtime behavior to the build layout.
`../templates` is correct only because `tsconfig.build.json` emits `outDir: dist`
from `rootDir: src`. ADR 0003 names tsdown as the fallback if bundling is ever
needed (`docs/adr/0003-tsc-only-build.md:20`); if that lands, this resolution
breaks unless the bundler preserves a filesystem-adjacent asset layout. The cost
is small and local — one resolution helper, not a scattered assumption — but it
should be *one* helper precisely so that swap stays cheap. P should require that.

### A test E6 must add

`expectPackInventory()` in `test/smoke/cli.test.ts:685-712` asserts what the
packed tarball contains and excludes — but it does not currently assert that
`templates/` ships. Since init is *entirely* dependent on templates being in the
tarball, and a stray `files` edit would break every consumer while leaving all
unit tests green, E6 must extend that inventory to assert the template files are
packed. This is the single highest-value regression guard in the epic.

## 5. Skill generalization split

### Generic (managed) body

Package-generic only: the review-artifacts-not-assertions philosophy
(`README.md:13-19`); running `pnpm shots`; filtering with `--only`, where
filtering gates shot *writes* while the walkthrough still runs
(`src/filter.ts:1-13`, `docs/design.md:67-68`); enabling `--video` / `--trace`
(`src/cli.ts:56-58`); generating and serving the gallery (`src/cli.ts:276-296`);
and the delivery model below. It must carry no project names, host paths, LAN
IPs, or ports beyond placeholders — it is generated into repos of unknown
visibility.

### Delivery model the skill must teach

ADR 0005 makes this precise, and the skill is where an agent learns it:
`gallery.html` embeds every screenshot's original bytes exactly once, so that
one file **alone** is the complete screenshot review artifact and can be handed
straight to the user (`docs/adr/0005-…:20-22`). Video and trace stay sibling
files — copying `gallery.html` away from its run directory carries all
screenshots but **breaks video/trace links** (`docs/adr/0005-…:22-23,50-51`).
So: hand over the file for screenshot review; serve the run directory when video
or trace matters. And serving defaults to loopback — `--lan` is opt-in and the
CLI warns that anyone on the network can view the captures
(`src/cli.ts:95-99,293-302`). The skill must reproduce that caution rather than
teaching `--lan` as the default.

### Where the skill gets installed — an edge init must not trip over

This repo keeps skills at `.agents/skills/<name>/SKILL.md` with `.claude/skills`
as a **symlink** to `../.agents/skills` — tool-agnostic storage, agent skill
discovery. Frontmatter is `name` + `description` (`.agents/skills/rpiv/SKILL.md:1-4`).

Two consequences P must settle, neither of which the epic text anticipates:

1. **Which path does init write?** Writing `.claude/skills/shots-harness/` is
   the simple, discoverable default. Replicating this repo's `.agents/` +
   symlink convention would push a shotwright-internal layout choice onto every
   consumer — the wrong direction for "consumers stay thin," which is about
   *code* the consumer would otherwise copy, not about dictating their repo
   layout. Recommend writing `.claude/skills/`.
2. **A consumer may already have `.claude/skills` as a symlink** (this repo
   does — so shotwright's own eventual self-consumption hits it first). Writing
   through it silently lands the file in the symlink *target*, which may be a
   tracked directory the consumer did not expect to be written to. init must
   detect that `.claude/skills` is a symlink and report where the file will
   actually land, rather than following it blindly.

### Preserving project notes across re-runs

The design requires the generic body to be upgradeable while project-specific
content below a marked line survives (`docs/design.md:101-106`). Mechanisms:

| Mechanism | Verdict |
|---|---|
| Sentinel markers in one `SKILL.md` | **Recommended.** Matches the local single-`SKILL.md` convention and implements the design's marked-line requirement directly. init replaces only the managed region. |
| Separate `PROJECT.md` + include | Clean split, but no local skill uses include-composition; the reader must know to open a second file. |
| Never overwrite if present | Safe for user edits, but generic fixes never reach consumers — defeats the point of centralizing. |
| `.new` sibling on collision | Good *fallback* when markers are missing or damaged; poor primary path (manual merge every upgrade). |

**Recommendation — revised after redteam:** start with **never overwrite an
existing `SKILL.md`; write a `.new` sibling and report it.** Sentinel markers
are the eventual right answer, but they buy nothing until a generic-body upgrade
actually needs to reach an existing consumer, and they carry a data-loss edge
that "refuse on damaged sentinels" does not close: a user who edits *inside* the
managed region with the markers left perfectly intact loses that edit on the
next re-run, silently and by design. Intact-but-misused is the likely mistake,
not mangled.

P may still choose sentinels — but only if it also specifies what happens to
in-region edits (at minimum: diff the managed region against the template it was
generated from, and refuse to replace a region that has drifted). If P cannot
specify that, `.new` is the honest design.

## 6. Ecosystem grounding: init semantics

Web-checked 2026-07-30.

- **Idempotent re-run.** Playwright's own initializer is the expectation-setter
  for shotwright's neighbours: `npm init playwright@latest` works on new *or*
  existing projects and is documented as re-runnable without overwriting
  existing tests (<https://playwright.dev/docs/intro>). Re-running
  `shotwright init` should leave existing specs alone, preserve skill project
  notes, append only missing `.gitignore` entries, and touch a `package.json`
  script only when absent or exactly equal to the previous managed value.
- **Collisions.** `create-vite` prompts on a non-empty target (cancel / remove /
  ignore) and cancels by default when non-interactive
  (<https://github.com/vitejs/vite/blob/main/packages/create-vite/src/index.ts>).
  Angular exposes `--force` to overwrite and `--dry-run` to report without
  writing (<https://angular.dev/cli/add>). Shotwright should skip and *report*
  existing non-managed files by default; `--force` overwrites managed files
  only.
- **Dry run.** Adopt `--dry-run`, printing the file manifest, script changes,
  gitignore additions, and collisions without writing (Angular precedent above).
- **Package-manager detection.** `create-vite` reads
  `process.env.npm_config_user_agent` with an npm fallback; `package-manager-detector`
  detects via lockfile, `packageManager`, and `devEngines`
  (<https://www.npmjs.com/package/package-manager-detector>). **Recorded but not
  recommended for E6** (redteam, and it is right): a four-level precedence chain
  serves callers that do not exist. The three named consumers are one-owner
  sibling projects and this repo itself pins `packageManager: pnpm@10.13.1`
  (`package.json:14`). E6 should emit pnpm-shaped next-step text and revisit
  only when a non-pnpm consumer is real.
- **Mutating `package.json`.** `npm pkg set` exists precisely because hand-editing
  is error-prone, and respects existing indentation
  (<https://docs.npmjs.com/cli/v7/commands/npm-pkg/>). Parse, preserve
  indentation and trailing newline, mutate `scripts` only, and do **not**
  reorder the file.
- **Installing dependencies.** Playwright prompts to install browsers (default
  yes); `create-vite` installs only under an explicit flag; `ng add` gates on
  confirmation. **Recommendation: scaffold and print next steps, do not
  install.** shotwright is already installed by the time init runs, and browsers
  belong to the consumer's Playwright per ADR 0002 — writing `shots:install` and
  telling the user to run it is both the honest and the ADR-consistent default.

## 7. Wrong-premise flags

- **The epic says init writes the CI workflow; E7 says E7 designs it.** Real
  ordering conflict in `docs/design.md` (init's output list at `:108-112` vs the
  epic map at `:127-128`). Resolved by owner decision as a seam (see Binding
  constraints). The epic's acceptance criterion does not mention CI, so leaving
  the seam does not weaken it.
- **The bead's own framing of the papercut was imprecise.** This bead was
  written assuming two known traps to document around. One of the two source
  records was wrong (§2, `shotwright-746.9`), and the trap is subtler than
  "remember not to type `--`" — it is that `--` *is* meaningful to shotwright,
  which is why the combined form matters. Documenting only "omit `--`" would
  leave consumers unable to pass Playwright flags at all.
- **`templates/` "does not exist" is only half true.** It is already wired into
  `package.json` `files` and already ADR'd as plain-file shipping. E6 creates
  the directory; it does not get to re-decide how templates ship.

## 8. Open questions → disposition

| Question | Disposition |
|---|---|
| Does init install dependencies? | **Escalated and decided (owner, 2026-07-30)** — see below. |
| Does init write CI now? | **Decided (owner, 2026-07-30):** seam only. |
| How aggressive is `--force`? | **Demoted (redteam):** `--force` ships only if P names a concrete managed-file collision it must solve. Default behaviour is skip-and-report; never blind-overwrite a consumer's specs. |
| Default `webServer` placeholder | **For P.** Epic acceptance names a fresh *vite* project and forbids manual edits beyond webServer, which argues for a vite-shaped executable default; the package is otherwise stack-agnostic (`src/index.ts:34`, `docs/design.md:59-61`). P must decide whether init detects vite and writes a working default, or always writes a commented placeholder that fails actionably. |

### Browser install — acceptance amendment (owner, 2026-07-30)

The redteam caught a real gap and it is worth stating plainly, because it
changes what E6 must deliver. `resolvePlaywrightCli` only proves the
`@playwright/test` *package* resolves (`src/cli.ts:143-157`); it says nothing
about whether the browser binaries were downloaded. So in a genuinely fresh vite
project, `pnpm shots` fails immediately after init until browsers exist. Read
literally, the epic's "yields a working `pnpm shots`" was unreachable under a
no-install design — and init printing "done, now run `pnpm shots`" would have
been a **false success message**, which is the fix-now bar.

**Decision:** init does not install. It writes the scaffold and prints
`pnpm shots:install` as the *first* next step, ahead of `pnpm shots`. The epic
acceptance is amended to allow that one generated command, and updated on
`shotwright-746.6`.

Rationale: ADR 0002 deliberately assigns browser ownership to the consumer's
Playwright (`docs/adr/0002-playwright-peer-dependency.md:19-22`); making init
fetch ~120 MB would blur that line, and putting the fetch inside `shotwright run`
would push a surprise download onto every cold CI runner — a bad failure mode
for the artifacts-only workflow E7 is about to build.

**Binding on P:** the acceptance now depends on init's *printed output* being
correct, not merely on the files it writes. P must include a proof that the next
steps are ordered install-before-run, and that init never reports success for a
scaffold it only partially wrote.

## Redteam dispositions (R→P gate, 2026-07-30)

Raw notes archived outside the repo. One redteam, per convention.

**Applied:**
- §2 wording tightened — the forwarded tokens are invalid Playwright options,
  not merely misrouted ones, which upgrades `shotwright-746.9` from "ambiguous
  record" to "provable mis-transcription."
- §5 sentinel recommendation **reversed** to never-overwrite + `.new`. The
  redteam found a data-loss edge the original missed: intact-but-misused
  sentinels (user edits inside the managed region) lose work silently, and
  "refuse on damaged markers" does not cover it.
- §6 package-manager detection demoted from recommendation to recorded option.
- §4 build-layout lock-in cost stated explicitly.

**Declined (recorded, not fixed):**
- *`--dry-run` / `--force` are unearned surface.* Partly agreed — `--force` is
  demoted to "only if P names a concrete managed-file collision it must solve."
  `--dry-run` is kept: init mutates `package.json` and `.gitignore` in a
  consumer's repo, and the ability to see what it will touch before it touches
  it is worth one flag. That is a real bite, not a hypothetical one.

**Independently re-verified by the redteam** (not taken on trust): `templates`
already in `package.json` `files`; ADR 0003's plain-file shipping; the
config-probe description against `src/index.ts` / `src/cli.ts`; and that the
smoke inventory does not assert templates ship. No headed-public leak in this
doc.

**Escalated to the owner:** the dependency-install question (see §8) — it
changes the epic's acceptance, so it is not a call for the drafting pass.

## Recommended shape (input to P)

1. `shotwright init [--dry-run]`, resolving templates via a **single** helper
   using `import.meta.url` relative to `dist/`. `--force` only if P justifies it.
2. Writes: `shots.config.ts`, `shots/example.shots.ts`, `.gitignore` additions,
   `.claude/skills/shots-harness/SKILL.md`, and `scripts.shots` /
   `shots:gallery` / `shots:install` in `package.json`. No CI file (seam).
3. Idempotent: skip-and-report every collision; never overwrite an existing
   `SKILL.md` (write `.new`); append only missing `.gitignore` lines.
4. Does not install browsers. Prints `pnpm shots:install` as the **first** next
   step, ahead of `pnpm shots` (§8, owner-decided; epic acceptance amended).
5. Smoke pack inventory extended to assert templates actually ship.
6. Partial-write honesty: if init fails midway it must report exactly which
   files it wrote, not "init complete." See §8.
