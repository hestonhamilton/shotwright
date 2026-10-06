# E4.R — Research: run-comparison shape

**Bead:** `shotwright-746.4.1` (E4.R) · **Epic:** `shotwright-746.4` (E4 Run comparison)
**Phase:** Research — no code changed.

**Feature under study:** `shotwright compare A B` — a paired before/after gallery
matching shots by name across two runs, flagging added and removed shots.
Pixel-diffing beyond side-by-side pairing is an optional stretch, not required.

**Epic acceptance (verbatim):** "Two runs of the demo app with a deliberate UI
change between them produce a compare gallery where the change is findable by
eyeball in under a minute."

---

## 0. The headline finding

The invariant E4 is most likely to violate is not where the bead's framing
implies. "No golden-diff gating" does **not** mean "no difference view." The two
are separable, and the ecosystem demonstrates the separation.

GitHub's image review UI offers four modes — 2-up, swipe, onion-skin, and
**Difference** — and applies *no pass/fail judgment to any of them*. It is a
visualization instrument, not a validator. A difference *view* a human looks at
is a review affordance. What would violate shotwright's first principle is a
**threshold plus an exit code**: a number that decides, and a status that gates.

This matters for scoping E4.P, because it means the optional diff stretch is
cheaper to guard than "don't go near pixels" would suggest. The guard is narrow
and greppable (§9), not a prohibition on a whole class of UI.

---

## 1. Ecosystem grounding

Visual-testing tooling in 2026 has split into two camps, and **both gate**:

- **AI-diffing cloud platforms** — Percy (BrowserStack), Applitools, Chromatic.
  Baseline history, approval workflows, pass/fail on visual change.
- **Framework-baked snapshot libraries** — Playwright `toHaveScreenshot()`,
  BackstopJS, jest-image-snapshot. Committed reference images, `maxDiffPixels`
  thresholds, failing assertions.

shotwright's `compare` is **neither**. It is a third thing: a review artifact
with no stored reference and no verdict. The research doc states this explicitly
so E4.P does not drift into camp two by borrowing its vocabulary.

Worth noting that Playwright's own HTML reporter *does* offer side-by-side and
slider comparison modes — but they exist downstream of a failing assertion. The
review affordance is reusable; the gating it sits behind is not.

One practical constraint on mode choice: onion-skin is reported unusable on very
small images (`desktop/desktop#11404`). Shot thumbnails in a paired grid may be
small enough for this to bite.

**Sources:** [GitHub image view modes](https://github.blog/news-insights/behold-image-view-modes/) ·
[Playwright visual comparisons](https://playwright.dev/docs/test-snapshots) ·
[Percy: visual regression tooling 2026](https://percy.io/blog/visual-regression-testing-tools) ·
[small-image onion-skin limitation](https://github.com/desktop/desktop/issues/11404)

---

## 2. Run identity and resolution

- Run ids are `<UTC YYYY-MM-DDTHH-mm-ss>_<4 hex>`, the suffix from
  `crypto.randomBytes(2)` (`src/runs.ts:12`, `src/runs.ts:14`, `src/runs.ts:15`).
- A run lives at `path.join(outputDir, runId)`; creation also writes `.sidecar`
  inside it (`src/runs.ts:31`, `src/runs.ts:38`).
- `manifest.json` is published by temp-write-plus-rename (`src/runs.ts:43`,
  `src/runs.ts:46`). **A complete run is defined as a run dir containing
  `manifest.json`** (`src/runs.ts:50`, `src/runs.ts:52`) — this is the existing
  completeness predicate `compare` should reuse rather than reinvent.
- `latest` is an output-dir symlink, atomically replaced via `.latest.tmp`
  (`src/runs.ts:55`, `src/runs.ts:59`, `src/runs.ts:60`).
- Output-dir discovery is config probing, not a hard-coded `shots-output`
  (`src/cli.ts:252`, `src/cli.ts:271`, `src/index.ts:41`, `src/index.ts:46`).

**What already exists**, in `src/gallery/resolve.ts`: no-arg means the `latest`
symlink, one positional basename means an explicit run id (`resolve.ts:43`,
`resolve.ts:50`, `resolve.ts:64`).

**What is new work.** `validateRunId` rejects empty strings, NUL, `/`, `\`, `.`,
`%`, absolute paths, and anything where `path.basename(runId) !== runId`
(`resolve.ts:28`–`resolve.ts:39`, verified by direct read). So a run id is
strictly a single directory basename. Consequences for `compare A B`:

- Generated run ids and `latest` work today, free.
- **Directory paths do not** — rejected by the `.` and `/` checks.
- **Index aliases like `-1` do not** — no ordered-run listing exists, and `-1`
  would also need to survive `validateRunId`.

E4.P must decide deliberately whether `compare` accepts more than basenames. The
recommendation from this research is: **start with basenames plus `latest`
only.** It is the existing contract, it costs nothing, and relaxing it later is
backwards-compatible while tightening it is not.

---

## 3. Manifest sufficiency and the pairing key

Per shot the manifest records `name`, `spec`, `file`, `viewport`,
`deviceScaleFactor`, `fullPage`, `capturedAt`, `durationMs`, `video`, `trace`
(`src/manifest.ts:19`). Run level: version, `runId`, start/finish times,
shotwright version, Playwright version, flags, shots (`src/manifest.ts:32`).

**Shot name is a sound pairing key, and this is enforced twice.**
`assembleManifest` throws on duplicate names before publish — verified by direct
read at `src/manifest.ts:91`–`src/manifest.ts:97`, with the error text "shot
names must be unique within a run". Gallery model validation rejects duplicates
again on load (`src/gallery/model.ts:147`, `src/gallery/model.ts:150`). A
manifest that reaches `compare` through normal channels cannot contain duplicate
names, so pairing does not need to defend against that case — it can rely on
`loadGalleryModel()` (`src/gallery/model.ts:311`).

**Missing for pairing:** no rename history, no stable per-shot UUID, no browser
label beyond the Playwright version, and no intrinsic PNG dimensions in the
manifest — dimensions and bytes are derived by reading the PNGs
(`src/gallery/model.ts:272`).

---

## 4. Pairing failure modes

| Case | Distinguishable? | Basis |
|---|---|---|
| Present in both | Yes | name match over `shots[]` (`src/manifest.ts:40`) |
| Added in B | Yes | set difference on `ShotEntry.name` (`src/manifest.ts:20`) |
| Removed in B | Yes | set difference, other direction (`src/manifest.ts:20`) |
| **Renamed A→B** | **No** | indistinguishable from remove+add; no lineage or stable id (`src/manifest.ts:19`) |
| Same name, changed viewport/variant | Yes | viewport, DSF, fullPage, spec all recorded (`src/manifest.ts:21`, `:23`) |
| Duplicate names in one run | N/A — unrepresentable | throws at assembly (`src/manifest.ts:91`), rejected on load (`src/gallery/model.ts:147`) |

**The rename gap is the one design consequence worth carrying into E4.P.** A
renamed shot will present as one removal plus one addition. Options: accept it
and document it (cheapest); or add a stable shot id to the manifest (invasive,
changes a serialized shape, would need an ADR).

This research recommends **accept the limitation, but do not label it
"removed"/"added" as the primary status.** Rename `theme-dark` → `dark-theme`
and a name-set compare computes one removal and one addition truthfully, yet the
human-facing badge would describe a single rename as two content events — the
software stating something false about what happened. The fix is copy, not
schema: the primary status for an unpaired shot should read **"unmatched by
name"**, with "renames appear this way" visible in the gallery itself. A stable
shot id stays out of scope; that is the unearned lock-in the standing brief
warns about, and the copy change costs nothing.

*(Redteam finding 2, accepted — the earlier draft handwaved this as "the human
already knows", which is not good enough for a user-visible label.)*

---

## 5. Gallery: reuse vs fork

Generation is: load one-run model → render HTML → atomic write of `gallery.html`
(`src/gallery/generate.ts:20`, `:24`, `:32`). The model seam is `GalleryModel` —
manifest, manifest byte length, specs, diagnostics (`src/gallery/model.ts:51`).

**There is no explicit template seam.** `renderGallery(model)` owns the document
shell, header, controls, content, footer, dialog, CSS, and JS in a single
function (`src/gallery/render.ts:251`, `:286`, `:324`). This is the central
structural finding for E4.P.

- **Reusable as-is:** escaping, number formatting, sibling hrefs, viewport/DSF
  labels, image placeholders, data-original download links, the bounded-decode
  card-loading script, and the shell/dialog/CSP (`src/gallery/render.ts:11`,
  `:25`, `src/gallery/assets.ts:167`).
- **Must fork or generalize:** `renderCard` is one-shot/one-column markup
  (`render.ts:107`); `renderSpec` groups by a single run's specs (`render.ts:226`);
  `viewportFilters` walks one `GalleryModel` (`render.ts:72`).

**Recommended change — deliberately not the "clean" one.** The tempting move is
to extract a shared document-shell renderer taking title / header facts / chips /
content, then have both gallery and compare call it (`render.ts:286`,
`render.ts:318`). **Do not start there.** That refactor rewrites shipped E3
output to serve exactly one new caller: an abstraction with one implementation
and one pressure point, which is the over-engineering pattern the standing brief
names. It also drags the "unviewed UI change does not ship" gate onto the plain
gallery, so the blast radius is the whole existing product for a payoff that is
currently hypothetical.

Start instead with **`renderCompare()` carrying its own shell**, reusing only the
already-pure helpers — escaping, number formatting, viewport/DSF labels
(`src/gallery/render.ts:11`, `:25`). Extract the shared shell *after* compare
exists and the duplication is visible and measurable. Duplication you can see
beats an abstraction you guessed at, and this ordering keeps E3's shipped gallery
untouched while E4 is still finding its shape.

*(Redteam finding 3, accepted — the earlier draft recommended the refactor
first.)*

---

## 6. ADR 0005 payload consequence

ADR 0005 commits to original PNG bytes embedded once as data URIs in
`gallery.html`, with video and trace as sibling links
(`docs/adr/0005-gallery-single-file-inline-originals.md:20`). It records a
60-shot synthetic corpus at roughly **35 MB** of HTML with bounded decode
(`:25`, `:28`).

**Its escape hatch, quoted in full** (verified by direct read, `:56`–`:58`): "A
hybrid/external gallery mode exists only as a named future escape hatch if
real-phone evidence ever defeats bounded decode; it must not be added
**silently**."

The final word is load-bearing and an earlier draft of this document dropped it,
which inverted the meaning. The ADR does not forbid the hatch — it forbids
opening it *without saying so*. Opening it is therefore available to E4 at the
cost of an explicit, argued ADR amendment, not blocked outright.

**Measured against the four real runs currently on disk:**

| Run | Shots | `gallery.html` bytes | Run dir |
|---|---|---|---|
| `…T03-34-54_46c4` | 5 | 2,933,832 | 5.0M |
| `…T03-34-56_a09b` | 1 | 784,990 | 1.4M |
| `…T03-34-57_4094` | 2 | 1,444,860 | 2.7M |
| `…T03-34-58_3f5a` (latest) | 2 | 1,446,076 | 2.7M |

Total `shots-output/` is 12M. Per-shot PNGs run 46,513–573,162 bytes.

**Paired projections** (additive, therefore an upper bound — a shared shell
should come in slightly under): `5+1` ≈ 3.72 MB, `2+2` ≈ 2.89 MB, `5+2` ≈ 4.38 MB.

**Extrapolated to ADR 0005's own corpus: a 60-vs-60 compare gallery is ≈ 70 MB
before compare metadata.** No hard browser-failure shot count was found in the
repo; E3.V verified bounded decode at 60 one-run shots and left real-device
memory pressure as residual risk (`docs/shotwright-746.3.4-verification.md:23`,
`:85`).

**How much this should gate E4.P — revised after redteam.** 70 MB is materially
past anything E3 validated, but the number is an inferred upper bound
extrapolated from a *synthetic* one-run corpus, and the real E4 corpus may be
nothing like it: the demo runs measured above are 1–5 shots, and a shared shell
should come in under additive.

So this is **not** a blocking ADR question for E4.P. What E4.P owes is a
**bounded acceptance check plus a stated deferral threshold**: "compare renders
the demo before/after pair" is sufficient for the epic's acceptance, and
large-corpus measurement becomes a named follow-up with a shot count at which it
must be revisited. E4.P should state that threshold explicitly rather than
either solving 70 MB up front or pretending it will not arrive.

*(Redteam finding 4, accepted — the earlier draft made this a hard "must be
settled in P, not I" gate, which would have stalled the plan on a number nobody
has yet needed.)*

---

## 7. CLI seam

- Verified: `src/cli.ts:2` reserves compare — `// shotwright CLI. E1 ships
  \`run\`; gallery/compare/trace/init land in E3+/E6.` Only `run`, `gallery`,
  and `init` are dispatched in `main()` today (`src/cli.ts:388`).
- A new subcommand needs: a usage string in the aggregate `USAGE`
  (`src/cli.ts:51`), a parser in the shape of `parseGalleryArgs`
  (`src/cli.ts:147`), an async command returning a numeric exit code like
  `gallery()` (`src/cli.ts:345`), and a dispatch arm in `main()` (`src/cli.ts:388`).
- Error convention: parsers throw, top level catches and exits 1
  (`src/cli.ts:413`); a command-level missing config prints and returns 1
  (`src/cli.ts:347`).
- Flag convention: shotwright flags precede Playwright passthrough for `run`,
  but `--only`, `--video`, and bare `--trace` are reclaimed after `--` with
  warnings (`src/cli.ts:67`, `:103`, and ADR 0006 at
  `docs/adr/0006-shotwright-flags-parse-after-separator.md:41`). `compare` has no
  passthrough, so it should not inherit the separator complexity — a point E4.P
  should state explicitly, given ADR 0006 exists precisely because that trap was
  sprung once already.

---

## 8. Test surface

- Units: `test/unit`, run by `pnpm run test` (`package.json:40`). Smoke:
  `test/smoke`, run by `pnpm run smoke` after build (`package.json:41`).
- Pairing tests belong beside the gallery suites — `gallery-resolve.test.ts:48`
  (run selection), `gallery-model.test.ts:60` (validation, duplicate names),
  `gallery-render.test.ts:137` (cards, data URIs, metadata).
- Parser tests extend `test/unit/cli.test.ts` (`:21`, `:133`, `:206`).
- Compare smoke extends `test/smoke/cli.test.ts`, whose `beforeAll` already
  builds four demo runs (`:907`) and whose demo smoke checks gallery presence and
  byte-exact originals (`:330`, `:520`).

**Concrete constraint, stated precisely.** `beforeAll` opens at
`test/smoke/cli.test.ts:907`, asserts `expect(runDirectories()).toHaveLength(4)`
at `:931`, and closes `}, 240_000)` at `:932` — so that assertion is *inside
setup*, verified by direct read of the block boundaries.

The consequence is therefore narrower than "any compare smoke breaks the suite":

- A compare test that runs **after** `beforeAll` and generates its own runs does
  **not** retroactively break line 931.
- It breaks only if runs are added **before** that assertion, or if some later
  assertion assumes exactly four run dirs.

Cheapest correct path for E4.I: **pair two of the four runs `beforeAll` already
creates.** If setup-time runs are added instead, line 931 and any downstream
count assumptions must be updated deliberately.

*(Redteam finding 5, accepted — an earlier draft of this document asserted the
suite "will break", which is an overclaim that could have scared E4.I away from
writing a high-signal smoke test.)*

---

## 9. The anti-golden-diff boundary, as testable invariant

Four checks a reviewer can apply to the E4.I diff to prove `compare` did not
become a gating tool:

1. **`compare` exits 0 whenever it renders.** Regardless of what it found —
   added, removed, or changed shots. Observable in the new command's numeric
   return, alongside `gallery()`'s convention (`src/cli.ts:345`, `:373`).
   Non-zero is reserved for "could not read a manifest / could not render."
2. **No `baseline`, `threshold`, `tolerance`, or `expected` in field names or
   flags.** Greppable. Current manifest fields contain no such vocabulary
   (`src/manifest.ts:19`, `:32`).
3. **Compare badges are `added` / `removed` / `paired`, never pass/fail.**
   Existing gallery precedent embeds no pass/fail status
   (`src/gallery/render.ts:302`).
4. **No test asserts that a pixel-difference result controls exit status.** The
   documented CI boundary is that artifact workflows fail for walkthrough or
   publication problems, never because pixels changed (`docs/design.md:110`, `:113`).

An independent review assessed the GitHub distinction from §0 and agreed it holds
for this codebase: a difference view is a review affordance; threshold-plus-exit-code
is the violation (`README.md:15`, `docs/design.md:34`).

---

## 10. Other findings

- The gallery server allowlist serves `/` and `/gallery.html` plus
  manifest-referenced screenshots, video, and trace — **not** `manifest.json`
  (`src/gallery/server.ts:122`, `:126`). Compare serving must either mirror that
  allowlist shape across two runs or avoid serving sibling files at all.
- The publish surface is `dist` and `templates` only (`package.json:15`), so
  compare code lives in package source, never in consumer templates
  (`docs/design.md:95`) — the thin-consumer invariant holds by construction here.

---

## 11. Open questions for E4.P

1. **Half-missing pairs — the highest-risk false-reporting case (§3, §10).**
   `loadGalleryModel()` does **not** drop a shot whose PNG cannot be read: it
   keeps the entry and records `imageError` as a diagnostic
   (`src/gallery/model.ts:321`–`:326`, verified by direct read). So a shot
   present by name in both runs but with an unreadable image on one side would
   be counted and badged **"paired"** while one visual side renders empty — the
   software asserting a comparison it did not actually make. E4.P must pin the
   exact status language and the counting rule for this case. *Raised by the
   redteam as the single missing question; it is the sharpest one in this list.*
2. **Payload deferral threshold (§6).** Not a blocking ADR question. E4.P owes a
   bounded acceptance check plus the shot count at which large-corpus
   measurement must be revisited.
3. **Run-arg surface (§2).** Basenames + `latest` only, or relax
   `validateRunId`? Recommendation: start strict — expanding later is
   backwards-compatible, tightening is not.
4. **Rename copy (§4).** Confirm "unmatched by name" as the primary status
   rather than "added"/"removed", with the limitation surfaced in the gallery.
5. **Diff view in or out of E4 scope (§0)?** Known to be guardable rather than
   forbidden — but the redteam's judgment, which this document adopts, is that
   pixel diff should stay **out of required scope**: side-by-side pairing alone
   satisfies the epic acceptance. E4.P should make that call explicit rather than
   let it drift in.

---

## 12. Verified vs inferred

**Verified by reading source:** run-id generation, manifest shape, duplicate-name
enforcement, gallery model/render/generate structure, CLI dispatch and
conventions, ADR 0005 constraints and escape-hatch text, test layout, the
philosophy statements, and the thin-consumer boundary. All carry file:line
citations above.

**Verified by running read-only commands:** `ls -la`, `du -ah`, `wc -c`, `stat`,
`rg`, `git check-ignore`, `git status`, and manifest reads. No runs were
regenerated; the four measured runs pre-existed this research.

**Independently spot-checked by the reviewer** (not taken on the
survey's word): `src/cli.ts:2`, `src/runs.ts:12`–`15`,
`src/manifest.ts:88`–`98`, `src/gallery/resolve.ts:28`–`39`,
`docs/adr/0005-…:54`–`57`, and `test/smoke/cli.test.ts:925`–`935`. Every cited
location said what the survey reported.

**Where that spot-check was nonetheless insufficient**, recorded because the
distinction matters: reading a line correctly is not the same as reasoning
correctly from it. The ADR text was read at `:54`–`:57` and still transcribed
into this document with its final word dropped; the smoke assertion was read at
`:931` and still produced a false conclusion about what would break, because the
enclosing `beforeAll` boundary was not checked until the redteam forced it. Both
defects survived a spot-check that "passed". The redteam gate, not the
spot-check, is what caught them.

**Inferred, not verified:** the recommended `compare A B` resolution policy, the
smallest-renderer-refactor shape, the additive paired-gallery byte projections
(upper bounds by construction), the 70 MB extrapolation to a 60-vs-60 corpus,
and the conclusion that no hard browser-failure threshold is documented anywhere
in the repo.

**Not obtainable:** the survey could not reach the beads DB from its
sandbox, so bead text was supplied in the prompt rather than read from the
board. No repo claim depends on it.

---

## 13. Redteam record (R→P gate)

An independent review pass examined this document against the code with a brief to
argue against it. Its verdict on the first draft was **not fit to gate**. Its
citation audit checked 30+ references and found the source citations sound, with
one exception noted below. Five findings were accepted and are folded into the
sections above; two were declined.

**Accepted and fixed:**

1. *FIX-NOW* — the document carried a machine-specific loopback endpoint into a
   committed file, against `docs/design.md:38` ("no host paths, LAN IPs, or
   personal data committed"). Removed. Worth recording that this is the second
   time a self-authored artifact in this repo has failed its own hygiene check.
2. *Rename labelling* — "the human already knows" was not good enough for a
   user-visible badge (§4).
3. *Shell refactor* — recommending the extraction first was over-engineering:
   one abstraction, one caller (§5).
4. *Payload* — a rough upper bound had been promoted into a hard planning gate
   (§6).
5. *Smoke overclaim* — "will break the existing suite" was false as stated (§8).

**Independently caught during fix-up, not by the redteam:** this document
truncated ADR 0005's escape-hatch quote, dropping the word "silently" and
inverting its meaning from "not without deliberation" into a flat prohibition
(§6). Corrected.

**Declined, with reasons** (recorded per the triage convention, not filed as
beads — neither names a concrete scenario reachable in this repo's real usage):

- *Basenames + `latest` is harmful lock-in.* It is strict, but reversible in the
  useful direction: accepting indexes or paths later expands the CLI surface,
  whereas tightening later would break callers. No schema or manifest change is
  implied. Declined.
- *Duplicate-name handling needs defending.* Enforced twice already
  (`src/manifest.ts:91`, `src/gallery/model.ts:147`); a duplicate cannot reach
  compare through normal channels. No change. Declined.

**On §0, adjudicated:** the redteam argued at full strength that the
difference-view/gating distinction is vocabulary theater — that a pixel-diff
panel imports the visual-regression mental model regardless of exit code, trains
reviewers to scan for red overlays instead of evaluating the UI, and makes the
*next* bead's threshold feel natural. It then judged that the distinction
survives, but narrowly, and that the hard line must be serialized and tested as
the absence of threshold/pass-fail/exit-code behaviour (§9). This document adopts
that judgment, and adopts the accompanying recommendation to keep pixel diff out
of E4's required scope.
