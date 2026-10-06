# shotwright-746.2.4 — E2.V Verification: demo app end to end

- **Doc:** verification (V phase)
- **Bead:** shotwright-746.2.4 · parent epic shotwright-746.2 (E2 Demo app)
- **Date:** 2026-07-29 · branch `feat/shotwright-746.2.1-research-demo-app` @ `28b3489`
- **Provenance:** evidence collected by a delegated verifier (dossier archived
  outside the repo); captures eyeballed and verdicts
  owned by the reviewer.

## Verdicts

| Epic acceptance criterion | Verdict |
|---|---|
| Full capture set from a fresh clone with only `pnpm install` + browser install | **PASS** (browser-cache caveat below) |
| Example specs double as living documentation | **PASS** (rationale below) |

| Supporting check | Verdict |
|---|---|
| Gates: `pnpm run typecheck && pnpm run lint && pnpm run test` | **PASS** — publint "All good!", 27/27 units |
| `pnpm run demo:build` — both HTML entries in `demo/dist/` | **PASS** — vite 8.1.5, 22 ms |
| `pnpm run smoke` — hardened four-run matrix | **PASS** — 5/5, 5.9 s wall (10 s budget) |
| Pack excludes `demo/`; `engines.node` unchanged `">=20"` | **PASS** |
| Captures visually inspected | **PASS** — all 5, by the reviewer (provenance below) |

## Fresh-clone proof (binding sequence from the plan)

Port 4173 verified free; disposable clone of the branch; `pnpm install`
(lockfile already current — resolved 141, downloaded 0); Chromium installed to a
writable cache (Chrome for Testing 151.0.7922.34); then:

```console
$ CI=1 pnpm run demo:shots
Running 2 tests using 2 workers
  2 passed (1.4s)
shotwright: 5 shot(s) → …/shots-output/2026-07-29T19-19-21_d593
```

Manifest v1, flags `{only: [], video: false, trace: false}`, exactly the five
planned rows — `about-desktop` 1440×960, `mobile-layout` 390×844, `form-filled`
1440×960, `modal-open` 1440×960 fullPage:false (locator), `theme-dark` 1440×960
— every PNG signature-valid and 46 KB–573 KB. Scratch clone and cache cleaned;
port free afterward.

**Browser-cache caveat:** the verification sandbox's default Playwright cache
was read-only, so the install leg used a `PLAYWRIGHT_BROWSERS_PATH` override
while the capture run resolved a pre-existing default-cache Chromium. Both legs
are individually proven (the install command works; the capture run works), but
a jointly browser-clean host has not executed the sequence end to end. E7's CI
runners (clean by construction) will close that residual; on a clean host the
default cache serves both legs with no override.

## Flag independence

Pinned by the smoke matrix (four runs, each asserting exact manifest
cardinality, on-disk-artifact set equality, magic bytes, and size floors;
video/trace pairs additionally assert unique paths and distinct file contents —
PNGs are signature/size-checked but not pairwise content-compared):

| Run | Result |
|---|---|
| unfiltered `--workers=2` | 5 shots, both specs, sorted manifest |
| `--only theme-dark` | exactly 1 shot; walkthrough still ran prior states |
| `--only form-filled,about-desktop --video` | 2 shots, 2 distinct WebM, traces null |
| `--only theme-dark,mobile-layout --trace` | 2 shots, 2 distinct ZIP traces, videos null |

## Captures visually inspected (2026-07-29)

**Provenance:** inspected by the reviewer, not a
human; from primary-checkout run `2026-07-29T18-54-43_77be`, not the disposable
fresh-clone run (whose artifacts were cleaned before inspection — the fresh
clone builds identical page sources at the same commit). Human review happens
at the PR gate.

All five captures were inspected: form filled with legible labels and balanced
hero; modal locator-crop tight around the native dialog with the copied values
visible; dark theme high-contrast with the toggle label flipped to "Use light
theme"; about page clearly three-column at desktop and single-column at
390×844. The font stack is system-only, which removes the
webfont-installed-or-not variable; actual faces and metrics still differ by
host OS, as system stacks always do.

## Living-documentation assessment (carried from the dossier)

Both specs (quoted in full in the archived dossier) use only the documented
public bare import `shotwright/capture`, the public `shot`/`walkthrough` API,
and semantic Playwright locators (`getByLabel`, `getByRole`); no repo-relative
or `dist/` imports, no private API, no implementation detail. No
shotwright-facing line is uncopyable — routes, labels, and visible text are
necessarily demo-specific and adapt to the consumer's own app.

## Anomalies and notes

- **`--` footgun in `demo:shots` (documented, not a defect).** `pnpm run
  demo:shots -- --only x` fails: pnpm forwards the literal `--`, and the CLI —
  by design — routes everything after `--` to Playwright. The correct form is
  `pnpm run demo:shots --only x` (verified: yields `flags.only=["theme-dark"]`,
  1 shot). Consumer-facing docs (E6) should show the no-`--` form; `--` remains
  reserved for Playwright passthrough (e.g. `pnpm run demo:shots -- --workers=2`
  routes `--workers=2` to Playwright, which is the intended use).
- **`pnpm exec shotwright` does not run from the package's own checkout** (bin
  linking applies to dependents, not self). Repo-internal entry points are the
  `demo:*`/`smoke` scripts; consumers get the real bin. Expected, noted for E6
  docs.
- **Sandbox-only:** the delegated verifier's default Playwright browser cache
  was read-only, requiring `PLAYWRIGHT_BROWSERS_PATH` override; environmental,
  not a repo issue.

## Environment

Node v24.16.0 · pnpm 10.13.1 · Playwright 1.62.0 · Vite 8.1.5 · Debian Linux
x86_64. Note: primary dev/verify ran on Node 24; the documented contributor
floor is ≥20.19 (ADR 0004) and the published `engines` remains `>=20`.

## Redteam ledger

Gate run 2026-07-29, one pass. Findings A1 (browser-cache confound in the
fresh-clone proof), A2 (inspection provenance), A3 (content-distinctness scope),
A4 (font-consistency overclaim), and B1 (living-doc rationale not carried into
the tracked doc) — all accepted as honest-writing corrections and applied above.
Declined by the redteam itself after independent reproduction: the `--` footgun
reclassification (sound), "full capture set must include video/trace" (the R/P
artifacts operationalize the set as the five PNGs), and the Node 24 caveat
(already recorded). Doc hygiene verified clean.

## Follow-ups

- `shotwright-746.2.5` (P3): smoke pins for `latest`-after-failure and child
  stderr surfacing (from the I-phase redteam, practical-bite accepted).
- E6 docs: record the `--` footgun and self-checkout bin note above.
