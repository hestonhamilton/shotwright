# Mobile gallery run facts — verification

**Bead:** `shotwright-746.41` · **Phase:** V · **Date:** 2026-10-28 · **HEAD:** `61fd4fa`

## Method and evidence

`pnpm build` followed by two `pnpm run demo:shots` invocations produced real, passing Playwright runs with five shots each: `shots-output/2026-10-28T21-32-50_0e1d/` and `shots-output/2026-10-28T21-33-05_20d4/`. The built CLI's compare command generated `local/verify-746.41/compare.html` from those runs. Their captured pages were identical, so the compare reported five identical pairs. This verification uses **two real demo runs**, not compare fixtures. The first run's generated `gallery.html` is the gallery measured in Chromium.

The browser measurements are in ignored `local/verify-746.41/browser-results.json`; `browser.mjs` is the repeatable measurement script. All 11 screenshots listed below were opened and visually inspected. Screenshots and scratch files remain under gitignored `local/verify-746.41/`.

## Acceptance checklist

The plan's three Redteam disposition items amend the criteria: mobile media must show at least 120 px, the desktop 2 px oracle applies to the measured demo run for visual review rather than the test fixture, and no-JavaScript search and filters must start disabled.

| Plan criterion, as amended | Verdict and evidence |
| --- | --- |
| Real generated gallery shows the first card and at least 120 px of its `.media` within the initial 390×844 and 320×640 viewports, without scrolling. | **PASS.** At 390×844, card top **408.33 px**, media top 409.33 px, visible media **263.64 px**. At 320×640, card top **514.30 px**, media top 515.30 px, visible media **124.70 px**. Both card tops are below their viewport bottoms. Viewed `gallery-390x844.png` and `gallery-320x640.png`: the first screenshot preview is visibly present. The 320 px result has 4.70 px of margin over the amended threshold. |
| At 1280×800, facts are open, retain four columns, and the desktop arrangement does not visibly regress; the recorded 866.1 px demo baseline is a visual reference. | **PASS.** On load, the disclosure is open, its summary has `display: none`, all ten fact labels are visible, and the grid has four computed columns. The first card top is **866.09 px**, effectively the recorded 866.1 px baseline. Viewed `gallery-1280x800.png`. No absolute fixture pixel gate was used. |
| Four status badges stay visible without opening facts; all ten facts are reachable through “Run facts” with Tab, Enter, and Space; no-JavaScript mobile and desktop disclosures work; script-enabled desktop hides an already-open summary. | **PASS.** Both mobile sizes show all four badges and a 44 px summary. Chromium focused the summary and used Enter and Space to open and close it; ten fact labels became visible. At 320×640 and 1280×800 with JavaScript disabled, the summary starts closed and visible, receives keyboard focus, and opens to all ten rows. Desktop with script hides the summary while the facts are open. Viewed the two mobile open-facts screenshots and both no-JavaScript initial and open-facts screenshots. |
| A manual mobile toggle persists within the mobile side of 760 px; crossing the breakpoint restores the corresponding default; the page remains self-contained with CSP, inline CSS/JS, and embedded PNGs. | **PASS.** Chromium kept a manually opened disclosure open after a same-side resize to 700 px, opened it after crossing to 761 px from a manually closed state, and closed it after returning to mobile. The isolated copy `local/verify-746.41/isolated/gallery.html` loaded a 2,880×2,076 embedded image without sibling files; it contains the meta CSP, one inline style block, two inline scripts, and five embedded PNGs. External requests and page errors were both zero. |
| Compare, per-card metadata, viewer behavior, and the no-shot empty state remain intact. Search and filters are visible but disabled without JavaScript, then enabled when script binds. | **PASS.** The real compare command exited 0 and the viewed `compare-390x844.png` shows the five-identical count and the first pair. The full unit suite passed, including `gallery-compare-render.test.ts`, the five-shot metadata and empty-manifest cases in `gallery-render.test.ts`, and the viewer cases in `gallery-browser.test.ts`. On the real gallery, the script-enabled search and four filters were enabled; no-JavaScript search was disabled and zero filters were enabled at mobile and desktop widths. The no-JavaScript copy omits the promised `/` shortcut and “Original queued”; the placeholder says “Original available to download.” Viewed both no-JavaScript initial screenshots. |

## Visual observations

- `gallery-390x844.png` and `gallery-320x640.png`: status badges, summary, search, and the first screenshot media fit in the initial viewport. At 320 px the run ID and status wrap, but nothing is clipped. The viewport chips scroll horizontally; the result count remains legible.
- `gallery-390x844-facts-open.png` and `gallery-320x640-facts-open.png`: the focused summary has a visible blue outline; the ten facts occupy two columns with long browser text wrapping inside its cell.
- `gallery-1280x800.png`: the facts retain four columns and the summary consumes no desktop height.
- `gallery-nojs-320x640.png`, `gallery-nojs-1280x800.png`, and their `-facts-open.png` companions: the disclosure is operable and the no-JavaScript warning is readable. The filters look disabled. The mobile warning naturally pushes the card lower; the fold criterion applies to JavaScript-enabled output.
- `gallery-320x640-long-count.png`: the injected “1234 of 1234 shots shown” count does not overlap the search label or input; measured overlap is false for each. This checks the implementation-review geometry case beyond the ordinary five-shot demo count.
- `compare-390x844.png`: the real compare page shows the two run IDs, parity counts, and the first identical pair without clipping.

## Redteam findings resolution

| Finding | Resolution and pin |
| --- | --- |
| Plan redteam 1: no-JavaScript filters appeared usable. | Search and filter chips now render `disabled` and are enabled only when the gallery script binds them. `cdfaa52` implements this; `test/unit/gallery-browser.test.ts` checks both states. Direct Chromium measurement on the real gallery found zero enabled no-JavaScript filters at 320 px and desktop, while all four were enabled with script. |
| Plan redteam 2: a card-top threshold could certify only a sliver. | The criterion now requires at least 120 px of visible `.media`. `cdfaa52` adds the Chromium assertion; real output measured 263.64 px and 124.70 px, and both viewport screenshots were inspected. |
| Plan redteam 3: the desktop 2 px gate used the wrong run. | The fixture test now pins open facts, ten visible rows, four columns, and hidden summary without an absolute pixel oracle (`cdfaa52`). Real demo output measured a card top of 866.09 px against the 866.1 px demo baseline and its screenshot was inspected. |
| Implementation review 1: no-JavaScript copy promised `/` and “Original queued.” | `61fd4fa` leaves static copy truthful and adds the shortcut wording and queued state only after script binding. The no-JavaScript browser assertions pin both strings; direct real-page checks at mobile and desktop also pass. |
| Implementation review 2: long mobile result count geometry. | `61fd4fa` adds the 320 px long-count browser test. The real-page injected-count check measured no overlap with the label or input, and `gallery-320x640-long-count.png` was viewed. |

Orchestrator visual review reported no other findings. This verification found no new failing criterion.

## Commands run

All commands ran from this worktree. The npm cache for lint's pack step was kept under ignored `local/verify-746.41/npm-cache/`. Output is truncated here; the browser measurements and screenshots are under `local/verify-746.41/`.

```text
npm_config_cache="$PWD/local/verify-746.41/npm-cache" pnpm run typecheck && npm_config_cache="$PWD/local/verify-746.41/npm-cache" pnpm run lint && npm_config_cache="$PWD/local/verify-746.41/npm-cache" pnpm run test
  exit 0; typecheck and build passed; Prettier: All matched files use Prettier code style!; publint: All good!; attw: node16 ESM and bundler green; 23 test files passed; 633 tests passed, 1 skipped

pnpm exec vitest run test/unit/gallery-browser.test.ts
  exit 0; 1 test file passed; 16 tests passed

pnpm build && pnpm run demo:shots
  exit 0; 2 Playwright tests passed; 5 shots; first real run generated

pnpm run demo:shots
  exit 0; 2 Playwright tests passed; 5 shots; second real run generated

node dist/cli.js compare 2026-10-28T21-32-50_0e1d 2026-10-28T21-33-05_20d4 --config demo/shots.config.ts --output local/verify-746.41/compare.html
  exit 0; identical 5, similar 0, changed 0, gated 0

node local/verify-746.41/browser.mjs
  exit 0; measured gallery at 390×844, 320×640, 1280×800; no-JavaScript at 320×640 and 1280×800; captured and inspected 10 screenshots

isolated-copy Chromium check and 320 px injected long-count Chromium check
  exit 0; embedded image decoded; zero external requests and page errors; long count overlaps neither label nor input; captured and inspected one more screenshot
```

## Sign-off

**Overall verdict: PASS.** All amended plan acceptance criteria pass on a newly generated real gallery, a real two-run compare, the full test suite, and inspected Chromium screenshots. The 320 px media margin above the 120 px threshold is narrow (4.70 px) but passes the specified criterion. No source or test file, board entry, or git history was changed in this phase.
