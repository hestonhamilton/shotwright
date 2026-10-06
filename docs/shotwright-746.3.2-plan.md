# shotwright-746.3.2 — E3.P: Gallery implementation plan

Plan date: 2026-07-29. Synthesized from a delegated plan draft (raw notes
archived outside the repo); builds on the committed, redteam-gated
research (`docs/shotwright-746.3.1-research.md`) and its owner decisions.
Mockups reviewed and signed off by the owner 2026-07-29 (see Decision record).
Redteam-gated (raw notes archived outside the repo): three fix-now corrections
applied (intrinsic status badge RT-1, unique temp files RT-2, byte-unique
synthetic corpus RT-3) plus RT-4/5/6 pins and the RT-7 signed-off composite
mockup; the `latest`-decoupling deviation was examined from both sides and
endorsed.

## Premise corrections (resolved before this plan binds)

1. **Manifest v1 cannot say a run failed.** No status field exists
   (`src/manifest.ts:32-40`); the reporter publishes every manifest and uses
   `result.status` only to gate `latest` (`src/reporter.ts:45-46,82-85`).
   "Not latest" ≠ failed. And a durable `gallery.html` cannot carry
   target-relative wording at all (redteam RT-1): a file stamped "latest"
   becomes false the moment a newer run advances the symlink, and
   target-dependent bytes would break deterministic regeneration. The badge
   baked into every gallery is therefore intrinsic and target-independent:
   **Published manifest · pass/fail status is not embedded**. How a run was
   *selected* (via `latest` vs explicit id, with the may-be-partial caution
   for explicit ids) is printed to the terminal by the `gallery` command,
   never written into the file.
2. **No parent-process `outputDir` resolver exists.** `opts.outputDir ??
   'shots-output'` resolves inside the consumer's config as Playwright
   evaluates it (`src/index.ts:20-24,37-41`); `run` only forwards `-c`
   (`src/cli.ts:51-87`). Gallery needs a config-probe contract (below).
3. **Research Q12 is about referenced files, not manifests.** A valid manifest
   + broken PNG → per-shot broken card. A missing/unparseable manifest has no
   trustworthy shot identities → fail before serving, never fabricate cards.
4. **The existing induced-failure smoke run is empty (`shots: []`).** E3's
   failed-run lane must capture one real shot then throw to prove a partial
   gallery (`test/smoke/cli.test.ts:137-178`).
5. **Artifact dedup can use only exact path equality.** Manifest v1 drops
   testId/title (`src/manifest.ts:19-30`); groups are labeled "shared by N
   shots by identical manifest path", never an invented test name.

## Decision record (owner, 2026-07-29)

| Decision | Choice |
|---|---|
| Visual direction | **Mockup A — spec workbench**: spec-first grouping, name/spec search, numeric viewport filter chips, expandable per-shot metadata, dedup'd artifact groups. The authoritative implementer reference is `docs/shotwright-746.3.2-mockups/signed-off-composite.html` (A's structure with every owner decision applied — redteam RT-7 found option A itself still contained rejected elements: theme toggle, localStorage, QR footer, no video layout, <44px targets); the three option files are the historical record |
| Theme | **System-only** `prefers-color-scheme`; no toggle, no localStorage |
| Video | **Inline `<video controls preload="metadata">` + download link**, dedup'd at group level |
| Terminal QR | **Omit** — zero runtime dependencies preserved; revisit from observed friction |
| `--open` | **Omit** — printed URLs; agent/CI-friendly |
| Failed-status badge | **No schema fork** — intrinsic in-file badge + terminal selection caution only (premise 1, RT-1) |

Carried from research (binding): original screenshots inline as data URIs;
lazy/bounded decode is load-bearing with a real-phone 60-shot V gate; video/
trace sibling links; loopback default + explicit `--lan`; no URL token; pure
manifest-v1 consumer; tsc-only build (ADR 0003).

## Product contract

### Generation pipeline — automatic and explicit

- `ShotwrightReporter.onEnd()` calls the gallery generator immediately after
  `publishManifest()` for **every** published manifest, passed or failed
  (`src/reporter.ts:45-82` ordering preserved). `latest` semantics are
  **unchanged from PR #4**: manifest published + `result.status === 'passed'`
  (`src/reporter.ts:82-85`). Gallery-generation failure does NOT block
  `latest` — the manifest is the run-completeness contract
  (`src/runs.ts:43-52`), the renderer is presentation, and `shotwright
  gallery` always regenerates on demand. (Deviation from the first draft,
  which coupled `latest` to gallery success; decoupled so a renderer bug
  cannot pin `latest` backward. Auto-generation failure on a passed run prints
  diagnostics to the run output and the run command exits nonzero.)
- `shotwright gallery [run-id]` re-reads manifest + PNGs and regenerates
  deterministic HTML before serving — the repair/update path.
- Generator: validate manifest v1 structurally; validate every relative path
  before filesystem access; read PNG signature/IHDR/byte length; base64-encode
  each original once. Intrinsic dims/bytes labeled **derived** (not manifest
  fields). Output via a **unique per-generation temp file** in the run
  directory (e.g. `.gallery.<pid>-<counter>.tmp`) + rename to
  `<runDir>/gallery.html`; each writer cleans only its own temp file. A fixed
  temp name is NOT safe here (redteam RT-2): unlike the manifest's single
  designated writer (`src/runs.ts:43-48`), the gallery has two legitimate
  concurrent writers (reporter auto-publish and a user-invoked `gallery`
  command), and a shared temp path makes the second rename fail. No
  timestamps/random IDs/fs paths in the HTML itself: identical inputs →
  identical bytes; concurrent generators are then safe last-writer-wins.
- Valid manifest + missing/corrupt referenced PNG: atomically publish a usable
  partial gallery (metadata kept, broken-reference card, diagnostics naming
  the run-relative path); explicit `gallery` serves it but exits 1 at
  shutdown. Missing video/trace → disabled/broken typed affordance +
  diagnostic. Nothing silently dropped.
- Missing/invalid-JSON/wrong-version manifest: exit 1, do not overwrite an
  existing gallery, do not serve (premise 3).

**Renderer shape:** internal TS modules under `src/gallery/` (model/
validation, PNG reading, HTML rendering, serving); CSS/browser-JS as readable
string constants. No browser build, template copy, or framework — build stays
tsc-only (`docs/adr/0003-tsc-only-build.md:15-21`), `dist/` already ships
whole (`package.json:15-18`): no `files`/`exports`/dependency change. Pack pin:
`pnpm pack --dry-run` inventory shows compiled gallery modules, no mockups.

### CLI surface

```text
shotwright gallery [run-id] [--config <path>] [--host <host>] [--port <port>] [--lan]
```

- `run-id` omitted → `<resolvedOutputDir>/latest` (last fully passed run);
  terminal prints "serving <run-id>, selected via latest (last fully passed
  run)". Explicit ID → one child dir; terminal prints the may-be-partial
  caution (premise 1). The served HTML carries only the intrinsic badge.
- `--config` defaults `shots.config.ts`, matching `run` (`src/cli.ts:15-26`);
  missing config = actionable exit 1.
- `--host` default `127.0.0.1`; `--port` default `0` (OS-assigned), validated
  integer 0-65535; `--lan` = `--host 0.0.0.0`, mutually exclusive with
  explicit `--host`.

**Config probe:** gallery resolves the consumer's Playwright peer from cwd
(existing resolver, `src/cli.ts:51-67`) and evaluates the consumer's config in
list mode with a private `SHOTWRIGHT_CONFIG_PROBE_FILE` env var pointing into
a unique temp dir. `defineShotsConfig()` in probe mode: computes the same
canonical `path.resolve(opts.outputDir ?? 'shots-output')` it uses for runs,
atomically writes it to the probe file, returns an empty test match with no
`webServer`, no run dir, no reporter side effects; run behavior otherwise
unchanged. Parent requires a successful probe + canonical absolute path,
cleans the temp dir in `finally`. A config that never calls
`defineShotsConfig()` → actionable exit, never assume `shots-output`.

**Run target containment:** explicit IDs are single basenames (no separators,
dots, NUL); resolved realpath must be an immediate child of the output
realpath; `latest` must be a symlink resolving to an immediate child
(missing/dangling/escaping fails closed); manifest `runId` must equal the
directory basename.

### Read-only serve design

`node:http` (Node ≥20 floor, `package.json:11-13`), no dependency. Startup
builds an exact URL→canonical-file allowlist: `/` and `/gallery.html`, plus
each valid manifest-referenced PNG/video/trace. `manifest.json`, dotfiles,
directory listings, and everything else: 404. Lookup is exact-key against the
allowlist — request paths are never concatenated to the filesystem. Startup
rejects absolute/scheme/NUL/dot-segment/backslash manifest paths and realpath
escapes.

- GET/HEAD only; 405 + `Allow: GET, HEAD` otherwise.
- Exact MIME + `Content-Length`; `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff` everywhere.
- `Accept-Ranges: bytes`; single byte range → 206 + `Content-Range`;
  malformed/multiple/unsatisfiable → 416. (Video seeking requires ranges,
  research §3.)
- Graceful SIGINT/SIGTERM close; no daemonize, no mutation endpoints.
- Default bind `127.0.0.1:0`, print `Local:` URL + a `--lan` hint. `--lan`:
  print `Local:` plus LAN URLs chosen deliberately (redteam RT-6: a naive
  "every non-internal private IPv4" enumeration on a docker-using host prints
  ~ten unreachable bridge URLs): suppress interfaces matching known virtual
  patterns (`docker*`, `br-*`, `veth*`, `virbr*`, plus link-local 169.254/16
  and CGNAT 100.64/10), print remaining private-IPv4 addresses as `LAN:` —
  and when more than one survives, order physical-looking interfaces first
  and label the rest `Candidate:`. Never print `0.0.0.0`. Always follow with
  the warning: **Anyone on this network can view these captures until you
  stop the server.** Interface-filter rules are unit-tested against fixture
  interface tables (including a docker-shaped one).

### Gallery HTML architecture (per signed-off mockup A + system theme)

- Spec-first grouping preserving manifest sort (`src/manifest.ts:102-113`);
  numeric viewport chips + name/spec search; expandable metadata; dedup'd
  artifact groups placed after each spec's shots.
- **Inline + bounded decode:** each PNG appears exactly once as a
  `data:image/png;base64,` URI on that shot's download anchor. Cards start as
  aspect-ratio placeholders with explicit derived width/height; browser JS
  inserts an `<img>` (from the in-document URI) as a card approaches the
  viewport, with `loading="lazy"`, `decoding="async"`, alt text. At most
  **three** live overview image nodes (+1 pinned 1:1 inspection node) —
  ESTIMATE, unfrozen until the phone V gate; far nodes are removed (metadata/
  placeholder/anchor stay). No `IntersectionObserver` → first shot loads +
  per-card ≥44px "Load screenshot" button. No JS → metadata, placeholders,
  and data-URI download anchors still work; `<noscript>` notice explains.
- **Safe rendering:** validate whole manifest; escape `& < > " '` for all
  consumer-controlled strings (names/specs originate in consumer code,
  `src/capture.ts:30-45`); no raw manifest JSON, no `innerHTML`; sibling
  links percent-encoded per segment with the warning **requires this gallery
  beside the run directory**; restrictive meta CSP (default/connect/object/
  base disabled; img `data:`; media same-origin; only the intentional inline
  style/script).
- **Accessibility/responsive:** h1/h2/h3 hierarchy, skip links, landmarks,
  meaningful alt, visible focus, keyboard-complete dialog with focus return,
  ≥44px touch targets, `prefers-reduced-motion`, system dark mode, one-column
  390px layout with no page-level horizontal overflow (1:1 surface pans
  internally; native pinch preserved).

## Step list (I lands as one bead PR; steps are review checkpoints)

1. ~~Owner UI gate~~ — **done 2026-07-29** (Decision record).
2. Deterministic model/renderer + automatic publish + reporter integration;
   renderer/injection/corrupt-reference/determinism/no-JS/accessibility/
   image-window unit + browser tests.
3. Gallery CLI parsing, config probe in `defineShotsConfig()`, canonical
   output/run resolution, latest/explicit labels; unit + custom-output smoke.
4. Read-only server: allowlist, containment, GET/HEAD/MIME/headers/ranges,
   URL printing, loopback/LAN, cleanup; protocol/security tests.
5. Real-corpus + failure smoke (below); full gates + pack inventory.
6. V-only physical-phone gate (below). V does not fix in place; failures
   reopen I (RPIV contract).

## Assumption → proof pins

| Assumption | I pin | V pin |
|---|---|---|
| Copied gallery.html contains every original | Fixture: one PNG-derived data URI per shot; display needs no sibling PNG | Copy HTML alone to temp dir; open offline; inspect/download all five |
| Bounded rendering prevents shot-60 eager decode | Browser test: 60-card scroll keeps ≤3 overview `<img>` + all 60 anchors | Physical iOS/Android scroll protocol; node counter never exceeds bound |
| Logical ≠ intrinsic dimensions | IHDR tests incl. modal-open 1440×960@2 → 1040×816 | Five-shot smoke asserts the real mismatch |
| Injection-safe renderer | Fixtures: `<script>`, quotes, `</style>`, bidi, malicious paths → inert text + CSP | Malicious fixture in Chromium: zero page errors/requests |
| Artifact dedup by path equality only | Fixture: one pair across 3 shots → one group labeled by path | Video/trace smoke confirms dedup + sibling warning |
| Auto gallery for passed AND failed manifests | Reporter tests: both statuses → atomic gallery; latest gates on passed only | Passed run + capture-then-throw run both have galleries; latest stays passed |
| Decoupled generator failure leaves the run contract intact (RT-4) | Process-level test with injected auto-generation failure asserts all five outcomes together: manifest stays published, passed status still advances `latest`, CLI exits nonzero, diagnostics retained, reporter staging cleaned | Same injected failure via the smoke harness; then `shotwright gallery` repairs the run |
| Custom outputDir discoverable without running | Probe unit: canonical value, no side effects; parser rejects missing probe | Smoke config with temp outputDir; `gallery --config` finds latest |
| Resolution cannot escape output/run | Unit matrix: absolute/dots/separators/dangling-latest/encoded traversal | Server smoke: traversal variants → 404, no leaked paths |
| Range serving media-correct | Parser + byte-exact unit tests | Real WebM range request; phone seek |
| Loopback safe default; LAN deliberate | Bind/URL/warning tests; no token | Phone unreachable before `--lan`, reachable after |
| No package topology change | publint + pack inventory; no new deps/files/exports | Packed tarball install in consumer smoke shape; gallery runs |
| Broken references visible and loud | Broken-card fixture + diagnostics; bad manifest never publishes/serves | Smoke deletes a PNG post-publish; regeneration shows card, exit 1 |

## Test matrix

- **Unit/browser lanes:** CLI parsing (defaults/conflicts/invalid); config
  probe (default/custom/cleanup/no-defineShotsConfig); manifest model
  (invalid JSON/version/shape, empty, mismatched runId, nullables); PNG model
  (signature/IHDR/truncation/containment); renderer (determinism, five/empty/
  broken states, ordering, filters, escaping, dedup, labels); headless
  Chromium (no console errors, dark mode, 390px overflow, keyboard/dialog,
  no-JS anchors, bounded nodes over 60 cards); server (allowlist, traversal,
  405/404, headers, range matrix, signal cleanup, URL formatting).
- **Five-shot smoke:** after `CI=1 pnpm run demo:shots`: run dir has atomic
  `manifest.json` + `gallery.html`; Chromium sees five headings + five data
  anchors; all metadata matches manifest/files; all-null artifact state
  stated once; `gallery --config demo/shots.config.ts --port 0` resolves
  latest, regenerates identical bytes, serves `/` with required headers,
  404s unlisted paths; video-run WebM range returns exact 206 slice; full
  gates + `pnpm pack --dry-run` green.
- **Failed-run lane:** induced spec captures one shot then throws
  (extends `test/smoke/cli.test.ts:137-183` pattern): CLI exits nonzero; new
  run has one-shot manifest + auto gallery; `latest` unchanged; explicit
  `gallery <id>` shows the shot, the in-file intrinsic badge, and prints the
  may-be-partial caution to the terminal.
- **Synthetic 60-shot corpus:** test-only Node fixture generator (not
  npm-shipped) derives 60 **byte-unique** valid PNGs from the five real ones
  (redteam RT-3: identical data URIs let browsers share cached/decoded
  resources, so a ×12-copy corpus can pass the phone gate without testing the
  production shape) — each copy gets a uniquely-varied valid ancillary chunk
  so every data URI is distinct while dimensions and compressed-size
  distribution stay measured-real. 60 unique names, real per-shot metadata,
  deterministic timestamps, null artifacts; records actual generated HTML
  bytes.

**Physical-phone V gate:** one current-iOS-Safari iPhone + one current-Chrome
Android phone on the serving LAN (versions recorded at test date; emulation is
preflight only). Instrumentation and executability pins (redteam RT-5):

- **Node counting:** the gallery ships a debug overlay enabled by opening the
  URL with `#debug` — a fixed-position live counter of overview `<img>` nodes
  (driven by the same insertion/removal code, no separate bookkeeping). The
  phone protocol reads it on-screen; no remote inspector required. The
  overlay is inert without the fragment and adds no state.
- **Video-seek step:** the synthetic corpus has null artifacts, so the seek
  observation runs against a separate artifact-enabled run: `CI=1 pnpm run
  demo:shots -- --video`, then serve that run explicitly.
- **Loopback negative check:** serve default (no `--lan`) first and confirm
  the phone cannot reach either printed URL; then restart with `--lan` and
  confirm reachability.

Per device: cold-open printed LAN URL (record bytes, time-to-first-shot, any
memory warning/reload/crash); scroll 1→60→1 twice (every card resolves; the
`#debug` counter never exceeds 3 overview nodes); 1:1 inspect shots 1/30/60
with pan/pinch/download + focus return; background/restore + re-inspect; seek
the real sibling video on the artifact-enabled run; rotate both orientations
(no overflow/covered controls/hover-only actions). **Pass** = all observations
on both devices. **Fail** = reopen I to tune the decode window; if bounded
originals still can't pass, stop for the owner fork to a named
`--external`/hybrid mode. No thresholds frozen from extrapolation.

## Risks

| Risk | Prevention | Rollback |
|---|---|---|
| Phone memory despite inlining | Bounded nodes + two-device physical gate | Tune window in reopened I; owner fork to named hybrid mode; never silent externalization |
| Config probe couples to Playwright evaluation | Private empty probe branch; smoke on real TS config | Explicit output-dir override flag only via owner sign-off |
| Renderer bug degrades passed runs | Gallery decoupled from `latest`; diagnostics + nonzero exit; independent regen path | Fix renderer; `latest` contract untouched |
| Consumer strings execute | Structural validation, context escaping, CSP, malicious fixtures | Disable filtering JS, keep escaped static HTML |
| LAN leaks captures | Loopback default, explicit `--lan` + warning, exact allowlist, no-store | Stop server; loopback unaffected |
| Range bugs | Pure parser + byte-exact tests + real WebM seek | `Accept-Ranges: none` full-download as temporary I rollback |
| Status overclaim | Labels tied to resolvable facts only | Schema status = owner fork, never inference |

## Scope fence — E3 does not add

One-tap/bundled trace viewing (E5); frame picking (E5); comparison/diffs/
history/golden gating (E4/never); manifest v1 fields; screenshot re-encoding/
thumbnails/WebP; auth/TLS/tunnels/tokens/QR; `--open`; browser framework/
bundler/copied assets/service worker/localStorage; size warnings or hybrid
mode ahead of phone evidence.

## Acceptance mapping

| Epic acceptance clause | Where proven |
|---|---|
| "single self-contained HTML file showing every capture with metadata" | Renderer pins + copied-file offline V |
| "gallery opens/serves" after a run | Auto-publish reporter tests + `gallery` smoke |
| "usable from a phone on the LAN" | `--lan` serve smoke + physical two-device V gate |
| Bead: mockups + owner sign-off | `docs/shotwright-746.3.2-mockups/` + Decision record above |
| Bead: assumptions pinned to verification | Assumption → proof table |
