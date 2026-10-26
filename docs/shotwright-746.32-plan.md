# E11 consumer follow-up — implementation plan

**Bead:** `shotwright-746.32.3` · **Phase:** Plan · **Date:** 2026-10-26

## Goal and decisions

Deliver A3, B1, N1, A1, A2, A4, N2 and `shotwright-746.11` in one 0.3.0 release. D3/D4 remain declined; D1/D2/N3 remain outside scope (`docs/shotwright-746.32-research.md`). Keep measured compare verdicts and the review-first default. Implementation beads below are proposals only.

Manifest additions stay optional v2 fields: old v2 readers get explicit unavailable/default values; v1 retains its unknown-outcome adapter (`src/gallery/model.ts:152-186`). Validate present fields strictly. Existing `Manifest` has neither title path nor provenance (`src/manifest.ts:55-69`); the compare result has counts and a gate (`src/gallery/model.ts:520-535`).

| Manifest field | Meaning; old-v2 reader default |
|---|---|
| `tests[].titlePath` | Nonempty ancestor-to-leaf titles, excluding root/project/file; leaf equals `title`. Default `[title]`. W1 owns schema and reader. |
| `environment` | Platform plus Linux os-release ID/VERSION_ID only when both parsed; default `null`. |
| `browsers` | Sorted one row per captured project: name/version/channel and `executable`; default `[]`. Conflicting or missing observed values are `null`, never guessed. An unset channel can be `null` while name/version are known. |
| `browsers[].executable` | Local Chromium on Linux only: managed cache-relative path or override basename, plus SHA-256 of the **running browser process's executable image** read through procfs. Default `null`. Firefox/WebKit, macOS/Windows, remote/connected browsers, and any failed PID binding, liveness check or read: `null`; name/version remain recorded. |
| `runError` | One `{code,message}` structural assembly diagnostic, sanitized to exclude host paths; default `null`. Only late duplicate recovery sets it. |

Per-capture observation comes from `page.context().browser()`; aggregate only matching observations by the test's project. Missing browser, remote connection, or conflicting rows leave uncertain fields unavailable. Do not serialize the absolute executable path, command-line arguments, usernames, or os-release free text. The reader must distinguish unknown from known equal. Shot/test links and project fields already exist (`src/manifest.ts:20-38`).

| Compare JSON addition | Meaning; older default |
|---|---|
| `settings.ignore` | Sorted exact artifact keys; `[]`. |
| `settings.strict` | Strict gate for similar; `false`. Existing threshold stays `0.1` unless selected. |
| `pairs[].ignored` | Selection only; `false`. Measured state and diagnostic remain. |
| `gate.measuredNonParity` / `ignoredNonParity` / `nonParity` | All measured non-parity / ignored measured non-parity / gated non-parity plus unignored similar when strict. Derive older values from counts / `0` / existing gate. |
| `provenance` | Advisory `known-fields-differ`, `unavailable`, or `no-known-difference`; older default `unavailable`. Never an image verdict or gate input. |

`--ignore` is repeatable and exact: split at canonical `.shots.ts/`, since artifact names may contain `/`; reject unmatched keys. It selects artifacts only, including changed/added/removed/unreadable. Strict includes unignored similar in the gate without calling it measured non-parity. Compare known corresponding provenance fields; known inequality wins, otherwise missing required values mean unavailable, otherwise say **no known difference**, never rendering equivalence. `generate-compare.ts` already recalculates `gate.nonParity` after hydration (`src/gallery/generate-compare.ts:221-223`); W2 retains a regression pin for all final counts after hydration.

## W3 executable observation experiment

Installed Playwright is **1.64.1** (`package.json:62`; `local/probe-cdp-effects.jsonl`). Probe: `browser.newBrowserCDPSession()` then `Browser.getBrowserCommandLine`; its `arguments[0]` is the observed executable. Unredacted six launch command lines are in `local/probe-cdp-effects-debug.log` and CDP arrays in `local/probe-cdp-effects.jsonl` (local only). Relevant command-line excerpts, with absolute paths intentionally replaced:

| Launch | Default command-line excerpt | CDP without flag | With explicit flag |
|---|---|---|---|
| Managed headless shell 156.0.8078.4 | `chrome-headless-shell ... --headless --no-sandbox --user-data-dir=… --remote-debugging-pipe --no-startup-window` | Refused: `--enable-automation not set` | `arguments[0]` is headless-shell binary |
| Managed headed Chromium 156.0.8078.4 under Xvfb | `chrome ... --no-sandbox --user-data-dir=… --remote-debugging-pipe --no-startup-window --ozone-platform=x11` | Same refusal | `arguments[0]` is full Chromium binary |
| Installed `channel: 'chrome'` 153.0.8010.36, headless | `chrome ... --headless --no-sandbox --user-data-dir=… --remote-debugging-pipe --no-startup-window` | Same refusal | `arguments[0]` is channel binary |

None of the three default launches passed `--enable-automation`. With the flag, text, form controls, and scrollbar page PNG hashes matched the corresponding defaults **3/3** for headless shell and **3/3** for Chrome channel (`local/probe-cdp-effects.jsonl`). In headed mode, default screenshots succeeded, but the flag-on screenshot failed with `Page.captureScreenshot: Unable to capture screenshot` under Xvfb; headed byte equivalence and any browser-chrome infobar remain unverified. `navigator.webdriver` was `true` in all six launches. Browser page screenshots do not show browser chrome, so this probe cannot rule out a headed infobar. Earlier measured streaming hash of a **197.9 MiB** headless-shell binary took **251.4 ms** (`local/e11-p-redteam.md`).

**Decision (owner, 2026-10-26, after prior-art research):** do not inject `--enable-automation`; shotwright never changes consumer launch arguments (`src/index.ts:25-31`, `:67-86`). Observe instead: CDP `SystemInfo.getProcessInfo` on a `browser.newBrowserCDPSession()` returns the `type: browser` PID without the flag; on Linux, the procfs executable link for that PID is the exact image the browser process loaded. A follow-up probe on 1.64.1 resolved the correct binary for managed headless shell, managed headed Chromium, `channel: 'chrome'`, explicit `executablePath`, and two concurrent launches (each CDP session returned its own PID). Hash by opening the procfs executable link, so the bytes are the running image even if the file on disk was replaced; check the PID is alive and still a child of this worker before and after the read. Then resolve the link target only to classify it: managed when under the actual Playwright browsers cache root (honouring `PLAYWRIGHT_BROWSERS_PATH`) and no explicit override is configured, recording the cache-relative path; otherwise overridden, recording basename only. `SystemInfo` is an experimental CDP domain, so W3a carries a Playwright-upgrade regression pin; any empty response, missing browser PID, failed liveness, or unreadable link yields `unavailable`. No `BrowserType.executablePath()` inference: it names the full Chromium binary while the headless shell actually runs. A worker-local promise cache keyed by PID-resolved file identity avoids re-hashing (measured 251.4 ms for a 197.9 MiB headless shell); no cross-worker claim protocol. `SystemInfo.getInfo.commandLine` (a fallback for macOS/Windows) and `Browser.getBrowserCommandLine` (needs the flag) are declined for now: the first is an unparsed experimental string untestable on the Ubuntu-only CI, the second would require changing launch flags.

### Prior art (read 2026-10-26)

No reviewed public tool hashes the browser binary. Cypress exposes an absolute browser `path` ([Cypress.browser](https://docs.cypress.io/api/cypress-api/browser)); Playwright reports and traces carry browser name, version and platform but no executable path or digest ([Browser](https://playwright.dev/docs/api/class-browser), [reporters](https://playwright.dev/docs/test-reporters)); Puppeteer exposes the launched `ChildProcess` ([Browser.process](https://pptr.dev/api/puppeteer.browser.process)); Argos screenshot metadata records browser name/version only ([Argos metadata](https://github.com/argos-ci/docs/blob/main/docs/sdks-reference/screenshot-metadata.md)); WebDriver capabilities take a binary path as input, not as an observed output ([ChromeDriver capabilities](https://developer.chrome.com/docs/chromedriver/capabilities)). `--enable-automation` changes browser behaviour ([Chrome tooling flags](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md)); Lighthouse removes Puppeteer's default flag ([Lighthouse + Puppeteer](https://github.com/GoogleChrome/lighthouse/blob/main/docs/puppeteer.md)), and a user report ties its removal in Playwright 1.60 to a changed login flow ([playwright#42379](https://github.com/microsoft/playwright/issues/42379)). No tool was found injecting it for observability. CDP method contracts: [SystemInfo](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/), [Browser](https://chromedevtools.github.io/devtools-protocol/tot/Browser/).

## Steps and sequencing

The shared compare interface is **`src/gallery/model.ts` `CompareGenerationResult` and `ComparePairState`**, plus W2's additive gate shape. W2 owns those compare types; W1 owns `src/gallery/model.ts` manifest reader changes. Agree the interface before parallel edits, keep changes on separate branches, and integrate the shared file at merge. W1 owns `titlePath` field and reader default; W4 can render against that agreed contract. W3a and W3b are separate PRs/beads. Shared-file integrations still require rebasing and review; they are not dependency edges.

1. **W1.1 — A3/N1 identity and safe paths.** Update `src/capture.ts`, `src/reporter.ts`, `src/manifest.ts`, `src/gallery/model.ts`. Derive canonical loaded `.shots.ts` spec from `TestInfo.titlePath[0]` and reporter file suite rather than declaration location (`src/capture.ts:76-79`, `src/reporter.ts:60-65`). Permit artifact-only relative subpaths; reject absolute, dot, empty, backslash, NUL and unsafe parent traversal at write and read (`src/manifest.ts:130-160`, `src/gallery/model.ts:270-315`). Add `tests[].titlePath` from reporter suite ancestors; validate leaf and older-v2 `[title]`. Pin helper-registered files, symlink swap, file-directory collision, nested read, title order and legacy default in capture/manifest/gallery unit and consumer smoke tests. Amend ADR 0021.
2. **W1.2 — B1 early collision.** In `src/capture.ts`, exclusively create the **final PNG with `wx`** before capture; screenshot to a buffer with explicit `type: 'png'`, then write those exact bytes through the claimed fd and close it. A second `(spec,name)` claimant fails its test and cannot alter the first PNG. Failed-attempt cleanup removes only its own claimed file. Pin byte identity, parallel workers/two projects, failed screenshot, symlink swap, crash leaving incomplete run, sequential duplicate and CLI `--retries=2`. Preserve final-attempt selection: attempt 0 capture followed by failed attempt 1 must not publish attempt 0 as final; a retry encountering the prior claim fails clearly until ownership is proved. Keep assembly duplicate defense (`src/manifest.ts:214-227`). Stage/hard-link publication is deferred unless these pins fail. CI is Ubuntu-only; package declares no OS restriction (`package.json:1-65`).
3. **W1.3 — B1 late duplicate recovery.** In `src/manifest.ts` and `src/reporter.ts`, when older sidecars contain a late duplicate, retain unambiguous rows, omit the ambiguous capture, write one sanitized `runError`, and derive one effective `failed` status. Feed that status to manifest, gallery, run list and `latest` promotion (`src/reporter.ts:135-180`, `src/runs.ts:113-130`). Pin a Playwright-passed run with late duplicate, preserved unaffected rows, failed status everywhere and unchanged `latest`. Malformed sidecar remains an honestly incomplete run; no general quarantine. A single field fits the one-diagnostic scope.
4. **W2.1 — A1 exact ignore and final counts.** W2 owns `src/cli.ts`, compare files and `src/gallery/model.ts` compare types. Add exact artifact ignore, measured/ignored/gated counts and visible diagnostics. Pin changed/added/removed/unreadable, typo rejection, final JSON/HTML/terminal/exit counts after forced hydration-to-unreadable, and viewed demo screenshot. Amend ADR 0022. The initial gate calculation is followed by the existing post-hydration recalculation (`src/gallery/generate-compare.ts:125-130`, `:221-223`).
5. **W2.2 — A2 threshold and strict.** Add CLI `--threshold 0..1` and `--strict`; preserve default threshold and report-only behavior (`src/gallery/compare-model.ts:192-202`, `src/cli.ts:403-415`). Pin similar-only strict gate, JSON, terminal, HTML and exit with/without `--fail-on-change`; view screenshot. Extend ADR 0022.
6. **W3a — A4/`746.11` observation and schema.** In capture fixture, observe the **actual page browser** via `page.context().browser()`; for local Chromium on Linux, get the browser PID from CDP `SystemInfo.getProcessInfo` and hash its procfs executable image as decided above. Record name/version even when executable is unavailable; Firefox/WebKit, non-Linux and remote browsers record executable unavailable. Add OS and browser manifest fields, worker-local promise cache, conflict aggregation, strict reader/old-v2 defaults, portable classification and no-host-path pins. Test: managed headless shell identified (not the full-Chromium `executablePath()` proxy), headed, explicit `executablePath` override, channel if installed, two concurrent browsers in one worker, two workers/projects, dead or foreign PID → unavailable, empty CDP response → unavailable, no leaked path/command line in manifest/HTML/JSON, and a launch-args pin proving shotwright adds nothing to the consumer's launch. Add ADR 0023 (carrying the prior art above) and changeset; no gallery presentation in this PR.
7. **W3b — provenance presentation.** Add advisory compare JSON and gallery/compare banners from W3a fields. Pin known difference, missing field, equal known values, unchanged image verdict/gate, HTML escaping and viewed screenshots. Extend ADR 0023.
8. **W4 — N2 render title context.** In `src/gallery/render.ts`, show full `titlePath` on every card and use the same text for search (`src/gallery/render.ts:108-117`, `:143-159`). Pin nested describe, escaping, old-v2 leaf fallback and viewed screenshot. W1 owns schema/reader; W4 is render-only.

Each PR updates README as needed and gets a distinct minor changeset; combined release target is 0.3.0. Each ADR includes prior-art links/read date or an explicit absence statement. Each code PR runs `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run smoke`, targeted pins and the leak gate. UI PRs view generated screenshots before shipping.

## Risks and rollback

| Risk | Deterministic pin / owner | Rollback |
|---|---|---|
| `wx` claim leaves partial bytes or blocks retry | W1.2 crash, cleanup, byte and final-attempt tests | Revert W1 B1 change as a unit; never promote damaged run. |
| Late duplicate could retain ambiguous evidence or promote `latest` | W1.3 Playwright-passed duplicate integration | Revert W1.3; keep run incomplete. |
| Nested path races a symlink | W1.1 swapped-parent and file collision smoke | Retain single-segment artifact restriction. |
| Counts diverge after hydration | W2.1 forced unreadable final output test | Revert W2 additions. |
| Executable hash suggests stronger proof or leaks path; experimental CDP domain changes | W3a PID-binding, liveness, path-leak and Playwright-upgrade pins; 251.4 ms baseline | Emit unavailable; remove advisory fingerprint. |
| Advisory sounds like image equivalence | W3b known/missing/equal wording and gate tests | Revert presentation only. |

## Acceptance mapping and proposed beads

| Bead / step | Acceptance and required pins | Blocked by |
|---|---|---|
| W1 — E11.I capture identity, paths, collision, title schema; W1.1–W1.3 | A3/N1/B1; `titlePath` writer/default; byte-identical claim, retry ownership, late duplicate effective status; ADR 0021 | `shotwright-746.32.3` |
| W2 — E11.I compare ignore, threshold and strict; W2.1–W2.2 | A1/A2; final hydration counts, exact artifact ignore, strict similar, viewed UI; ADR 0022 | `shotwright-746.32.3`; agreed `CompareGenerationResult`/`ComparePairState` interface |
| W3a — E11.I observe browser and executable identity; W3a | A4/`shotwright-746.11`; Linux Chromium CDP PID + procfs observation, no launch-arg changes, portable hash, unavailable elsewhere, OS/browser schema, conflict and old-v2 pins; ADR 0023 | W1 manifest schema; coordinate `shotwright-746.11` ownership |
| W3b — E11.I advisory provenance UI; W3b | A4 advisory compare/gallery, no gate effect, viewed UI | W3a and W2 compare interface |
| W4 — E11.I render card title context; W4 | N2 full title/search and old-v2 fallback, viewed UI | W1 `titlePath` field and reader default |

A later Verify bead checks combined changesets, UI views, named pins and full gates. No push, merge or bead closure is in this plan.

## Revision after redteam

Corrected the post-hydration gate claim; replaced process-wide `spawn` interception with public Chromium CDP and honest hash semantics; removed cross-worker hash claims and staging/hard-link publication; narrowed recovery to late duplicates; split W3 and relaxed W2/W4 sequencing. Declined a v3 manifest bump because optional fields with strict present validation and older-v2 defaults fit ADR 0021 (`docs/adr/0021-shot-identity-and-manifest-v2.md:12-28`). Declined automatic flag injection because default launches omit it and headed screenshot/infobar equivalence is unverified; consumer launch ownership remains intact (`src/index.ts:25-31`, `:67-86`). A follow-up prior-art pass found the flag-free CDP PID + procfs route, which the owner adopted.

## Open questions

None. The executable-observation route was decided by the owner on 2026-10-26 (Linux Chromium via CDP browser PID and procfs; no launch-flag changes).

## Self-review

| Lens | Result |
|---|---|
| Measured or flagged | Pass: six launch probes, six headless PNG matches and 251.4 ms hash baseline; headed flagged unverified. |
| Derived values | Pass: effective status, measured/ignored/gated counts and unavailable/known provenance defined. |
| Emergent structure | Pass: one row per captured project, conflict-to-unavailable and exact artifact keys pinned. |
| Batch/concurrency | Pass: `wx` ownership, failed-attempt cleanup and worker-local promise cache pinned. |
| Inherited constraints | Pass: post-hydration gate, consumer config ownership and optional v2 schema checked against code. |
