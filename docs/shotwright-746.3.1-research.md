# shotwright-746.3.1 — E3.R: Gallery shape research

Research date: 2026-07-29. Synthesized from a delegated grounding survey (raw
findings archived outside the repo, with fuller
per-claim citations); repo claims verified against `51d2bc5`, except failed-run
reporter semantics which reflect PR #4 (`250d438`, landed mid-phase). Ecosystem
claims web-checked 2026-07-29. Redteam-gated (raw notes
archived outside the repo); corrections applied and two decisions escalated
to the owner are recorded inline. Research only — no code changed.

## Binding constraints

- Captures are regenerated, gitignored review artifacts — no golden-diff gating
  (`README.md:13-25`, `docs/design.md:30-38`).
- Consumers stay thin; review machinery ships in the package
  (`docs/design.md:21-23,95-97`).
- Epic acceptance: after a run, `shotwright gallery` opens/serves a **single
  self-contained HTML file** showing every capture with metadata, usable from a
  phone on the LAN.
- **Self-contained semantics — owner decision, 2026-07-29** (the epic text
  alone does not settle this; the survey flagged it and the redteam confirmed):
  original-resolution screenshots are inlined as data URIs, so `gallery.html`
  alone is the complete *screenshot* review artifact; video/trace bytes stay
  sibling files with typed links (consistent with the epic's "links to
  videos/traces" wording). Consequences P must own: copying `gallery.html` off
  the run directory carries all screenshots but breaks video/trace links (the
  gallery should say so on those links), and inline originals make lazy decode
  load-bearing — P must pass a real-phone test with a synthetic 60-shot corpus
  before pinning size thresholds, with a clearly named external/hybrid mode as
  the escape hatch only if that test fails.

## 1. Manifest v1 — the gallery's entire input

The manifest is the public tooling contract
(`docs/shotwright-746.1.1-research.md:70-99`). Run-level: `manifestVersion`,
`runId`, `startedAt`, `finishedAt`, `shotwrightVersion`, `playwrightVersion`,
`flags`, `shots`. Per shot: `name`, `spec`, `file`, `viewport`,
`deviceScaleFactor`, `fullPage`, `capturedAt`, `durationMs`, `video`, `trace`
(`src/manifest.ts:14-40`).

Semantics the gallery must respect:

- `viewport`/`deviceScaleFactor` are nullable; they are **logical** values, not
  image dimensions — a locator capture in the demo corpus is a 1040×816 PNG
  under a 1440×960@2 viewport. Intrinsic pixel dimensions and byte size are
  not manifest fields; the generator derives them from the PNGs
  (`src/manifest.ts:19-30`, `src/capture.ts:47-64`).
- `fullPage: false` does not distinguish locator from clip captures
  (`src/capture.ts:22-28,47-53`).
- `durationMs` is the screenshot call only, not walkthrough duration.
- `video`/`trace` are **per Playwright test result**, copied once as
  `video/<testId>.<ext>` and repeated verbatim on every shot from that test
  (`src/reporter.ts:33-59`, `src/manifest.ts:102-107`). `testId`/test title are
  not in the manifest, so path equality is the only grouping signal — the
  gallery must dedupe identical artifact paths, not render N identical links.
- Shots sort by `(spec, capturedAt, name)`; empty successful runs write
  `shots: []`; only a run containing `manifest.json` is complete
  (`src/manifest.ts:102-113`, `src/runs.ts:43-60`).
- **Failed-run semantics (landed in PR #4, main `250d438`, during this
  research phase — bead shotwright-746.2.5):** every run, passed or failed,
  assembles artifacts and publishes `manifest.json`; only the `latest` symlink
  is gated on a fully passed run (`src/reporter.ts:82-85`). So `gallery`'s
  default (`latest`) always resolves to a fully passed run, while an explicit
  run-id can target a partial/failed run — which is a complete, reviewable run
  directory the gallery must render, not an error case.
- Manifest v1 has **no** project/browser/device label despite multi-project
  config support (`src/index.ts:33-35,56-65`), and shot names are globally
  unique per run (`src/manifest.ts:91-101`). Viewport grouping is therefore
  numeric-only in E3.

## 2. Measured corpus and single-file size math

Five-shot demo corpus (`CI=1 pnpm run demo:shots`, run
`2026-07-29T20-33-16_ecfe`): PNGs total 2,178,396 bytes; manifest 2,155 bytes.
Base64 inlining ([RFC 4648 §4](https://www.rfc-editor.org/rfc/rfc4648#section-4))
added 726,140 bytes on the measured corpus (~33.33%; per-file padding makes it
marginally more than exactly 1/3): 2.77 MiB single-file payload for five
shots; extrapolated ~16.6 MiB at 30 shots, ~33.2 MiB at 60.

- Compressed size is **not** the cliff: per-image data-URL caps are 512 MB in
  Chromium/Firefox
  ([MDN data URL length limits](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/data#length_limitations),
  checked 2026-07-29), far above any shot.
- The real phone cliff is eager decode: ~467 MiB RGBA working set at 30 shots,
  ~934 MiB at 60 — first-order width×height×4 estimates, not measured browser
  memory. A single-file gallery is viable **only** with explicit intrinsic
  `width`/`height` attributes and lazy/on-demand image decode
  ([web.dev browser-level lazy loading](https://web.dev/articles/browser-level-image-lazy-loading#give_your_images_dimension_attributes));
  an all-eager gallery is not a credible phone design past ~30 shots.
- Playwright 1.62 (the pinned version, `package.json:45-51`) added WebP
  screenshots
  ([1.62 release notes](https://playwright.dev/docs/release-notes#version-162)),
  but the capture writer hard-codes `.png` (`src/capture.ts:41-44`) — format
  changes are out of E3 scope.

**Decision for P (owner-decided, see Binding constraints):** inline original
PNGs as data URIs, lazy-decoded; video/trace stay sibling files with typed
links. Hybrid/external mode only as an explicitly named escape hatch if
real-phone testing of a synthetic 60-shot corpus fails.

## 3. Video and trace linking

- Video: render `<video controls preload="metadata">` from the sibling path
  when non-null, plus a download link. Serving needs correct MIME and HTTP
  byte ranges (206) for seeking
  ([MDN range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)).
  Never inline video bytes. Playwright video is off by default and run-flag
  gated here ([Playwright video docs](https://playwright.dev/docs/videos);
  `src/cli.ts:23-39`, `src/index.ts:50-55`).
- Trace: `trace.playwright.dev` loads local zips client-side (bytes stay in
  the browser) but requires internet and HTTP(S)
  ([trace viewer docs](https://playwright.dev/docs/trace-viewer#opening-trace-viewer),
  checked 2026-07-29); pointing it at a LAN URL hits CORS plus Chromium Local
  Network Access permission gating
  ([Playwright issue #38207](https://github.com/microsoft/playwright/issues/38207),
  [PR #38221](https://github.com/microsoft/playwright/pull/38221)) — a
  `?trace=http://<LAN>` link as the only affordance would be deceptively
  broken. Allure's fetch-and-`postMessage` handoff
  ([Allure attachment docs](https://allurereport.org/docs/attachments/#playwright-traces))
  is the proven one-tap pattern, relevant to E5. E3 ships trace **download +
  visibility**; a one-tap LAN trace viewer belongs to E5
  (`docs/design.md:120-127`).
- The default demo run has both flags false and all artifact values null — the
  gallery's zero-video/zero-trace state is the common case, and E3's test
  corpus needs at least one `--video`/`--trace` run for the linked state.

## 4. Serve command

Ecosystem conventions, all checked 2026-07-29: Playwright `show-report`
defaults to localhost:9323 with `--host`/`--port`
([reporter docs](https://playwright.dev/docs/test-reporters#html-reporter),
[CLI docs](https://playwright.dev/docs/test-cli#show-report)); Vite preview
defaults to 4173, `--host` for LAN
([Vite preview options](https://vite.dev/config/preview-options.html));
Monocart has separate show/serve commands and CORS-for-trace guidance
([Monocart trace serving](https://github.com/cenfun/monocart-reporter#view-trace-online));
Expo prints server URL + terminal QR for phone workflows
([Expo CLI docs](https://docs.expo.dev/more/expo-cli/#server-url)):

1. `shotwright gallery [run-id]` — resolves the run (default `latest`),
   regenerates `gallery.html` from `manifest.json`, serves only that run
   directory. Matches the designed CLI (`docs/design.md:49-55`).
   **Output-dir resolution is part of the command contract**: consumers can
   configure any `outputDir` (`src/index.ts:20-24,37-40`) and `run` already
   takes `--config` (`src/cli.ts:23-26,40-43`) — a gallery hard-coded to the
   default `shots-output/` cannot find those runs. P must pin the mechanism
   (evaluate `--config` like `run` does, and/or accept an explicit run path).
2. Node built-in HTTP server; no new runtime dependency for static serving
   (Node ≥20 baseline, `package.json:11-14`).
3. Loopback default; explicit `--lan` (= `--host 0.0.0.0`), plus `--host`/
   `--port`. OS-assigned port by default, actual port printed.
4. Print loopback + every viable private-IPv4 LAN URL (never `0.0.0.0`); QR
   for the LAN URL when unambiguous.
5. Security posture: read-only GET/HEAD allowlist (gallery + manifest-referenced
   files), realpath + traversal rejection, no directory listing, no daemonize,
   `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, prominent
   "anyone on this network can view" warning on LAN exposure. Manifest strings
   are consumer-controlled data (`src/capture.ts:31-45`) and must be
   HTML-escaped, never interpolated as markup. Captures can contain
   confidential data
   ([OWASP MASWE-0055](https://mas.owasp.org/MASWE/MASVS-PLATFORM/MASWE-0055/))
   — exposure must be deliberate. **Random URL token: owner decided against
   (2026-07-29)** — loopback default + explicit `--lan` with warning is the
   posture; a token is neither authentication nor encryption and is not worth
   the URL/QR friction. Revisit only on a demonstrated problem.
6. **Renderer/packaging shape is a reserved P decision** — the design doc
   explicitly leaves "inline HTML generation vs built asset" to E3 planning
   (`docs/design.md:131-135`), and ADR 0003 constrains the build to tsc-only
   unless a bundling need is measured
   (`docs/adr/0003-tsc-only-build.md:17-21`). A template/browser asset outside
   `dist/` would change `package.json` `files`, build steps, and pack smoke —
   a TS string-renderer keeps the tsc-only build. P must decide with that cost
   on the table.

## 5. Ecosystem: copy / don't copy

All checked 2026-07-29:

- **Playwright HTML reporter**
  ([docs](https://playwright.dev/docs/test-reporters#html-reporter)):
  self-contained *folder*, not file. Copy: manifest-driven navigation, serve
  conventions, empty state. Don't copy: pass/fail centricity, retries,
  assertion stacks, attachment topology.
- **Monocart** (2.12.2,
  [npm](https://www.npmjs.com/package/monocart-reporter),
  [README](https://github.com/cenfun/monocart-reporter#output)): single HTML
  but attachments stay relative files. Copy: fast grouping/filtering, metadata
  near the artifact, trace-failure guidance. Don't copy: tree grid,
  plugin/custom-column platform, trends.
- **Allure**
  ([single-file warning](https://allurereport.org/docs/v2/view-report/#open-a-single-html-file)):
  single-file mode exists but is warned against at scale; its hosted-trace
  handoff (fetch zip, `postMessage` bytes to viewer) is the proven one-tap
  pattern — relevant to E5, not E3. Copy: typed artifact links, always a
  download fallback.
- **Argos** ([npm](https://www.npmjs.com/package/@argos-ci/playwright)) /
  **Playwright snapshots**
  ([docs](https://playwright.dev/docs/test-snapshots)): golden-diff tools;
  validate the metadata set but their baselines/gating are explicitly out of
  scope.

## 6. Inputs for the P-phase mockups (uiux-mock)

Metadata available without schema change: run header (id, times, versions,
flags, counts); per shot: name, spec, viewport+DSF (nullable), fullPage,
capture time, screenshot duration, artifact availability; derived: intrinsic
dimensions, byte size (must be labeled derived).

Decision points the mockups must surface for owner sign-off (not settled
here): primary grouping (spec vs numeric-viewport, toggle?), overview render
strategy within the inline-originals decision (native lazy vs JS on-demand
insertion vs virtualization), 1:1 pixel inspection path on phone, metadata
density visible-vs-expandable, dedup'd artifact link placement, filtering
affordances at 30-60 shots, dark mode (system-only vs toggle;
[MDN prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-color-scheme)),
touch ergonomics
([WCAG 2.2 24px minimum targets](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)),
empty/broken-file states, run-header density.

## Wrong-premise flags (all against current code)

1. "Videos/traces per capture" is misleading — per test result, path-repeated
   per shot, with no test label in the manifest (see §1).
2. The default demo corpus contains **no** videos/traces (all null).
3. Manifest "dimensions" are logical viewport only; PNG intrinsic size differs
   (locator captures especially).
4. Multi-project consumers can't be labeled in v1, and same-name shots across
   projects fail assembly (`src/manifest.ts:91-101`) — viewport grouping is
   numeric-only until a schema decision, which E3 does not make.
5. Literal "everything inline" conflicts with the designed sibling `video/`,
   `trace/` layout (`docs/design.md:70-80`), and the epic text alone does not
   pin the semantics — resolved by explicit owner decision (see Binding
   constraints), not by inference from the epic wording.
6. The hosted trace viewer cannot transparently fetch private-LAN URLs (CORS +
   Local Network Access) — one-tap trace is not free.

## Open questions → disposition

| # | Question | Disposition |
|---|---|---|
| 1 | Meaning of "self-contained" | **Owner-decided 2026-07-29** (recorded on bead): original screenshots inline; video/trace sibling links; phone test gates thresholds (see Binding constraints). |
| 2 | Manifest schema expansion (project labels, intrinsic dims) | **Out of E3 scope** — pure manifest-v1 consumer. If planning proves a field is load-bearing, that's an owner fork. |
| 3 | Numeric-only viewport grouping acceptable? | To mockups + owner sign-off. |
| 4 | Which lazy/on-demand render strategy survives a real 60-shot phone test | P must include a synthetic-corpus phone test before pinning thresholds. |
| 5 | Size-warning threshold / `--external` escape hatch | P decides from the phone test; escape hatch only if needed, explicitly named. |
| 6 | Generate gallery.html on every successful run vs only via `gallery` | P decides; design layout already shows `gallery.html` in-run (`docs/design.md:70-80`). |
| 7 | LAN opt-in vs default | Research recommends loopback default + explicit `--lan`; P confirms. |
| 8 | Terminal QR: in E3? dependency allowed? | To mockups/owner question set. |
| 9 | Trace UX split E3/E5 | E3 = visible download; one-tap viewer = E5 (per design doc). |
| 10 | Inline video playback in E3 vs link-only | To mockups; `<video>` from sibling path is cheap, recommend include. |
| 11 | Phone support floor | P pins: current iOS Safari + Android Chrome, verify on real devices. |
| 12 | Missing/corrupt referenced file behavior | P decides; research recommends broken-card + nonzero exit, never silent drop. |
| 13 | Dark-mode persistence | To mockups. |
| 14 | Random URL token on `--lan` | **Owner-decided 2026-07-29: no token** (see §4.5). |
| 15 | `outputDir`/`--config` resolution for `gallery` | P pins the contract (see §4.1); E3 must not hard-code the default output dir. |
| 16 | Renderer: TS string template vs built asset | Reserved to P by `docs/design.md:131-135` under ADR 0003's tsc-only constraint (see §4.6). |

## Recommended shape (input to P; owner-decided points marked above)

Generate `gallery.html` from a complete manifest; inline manifest data, CSS/JS,
and original screenshots (lazy-decoded, explicit dimensions) so the file alone
satisfies portable screenshot review; keep video/trace as sibling artifacts
with typed, dedup'd links. Group/filter on manifest-v1 facts only. Serve one
run read-only from a built-in Node server: loopback default, explicit `--lan`,
OS port, printed URLs (+QR), range support, exposure warning. Trace one-tap
stays in E5.
