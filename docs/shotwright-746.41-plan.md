# Mobile gallery run facts — plan (shotwright-746.41)

Planned: 2026-10-28. This document specifies implementation; no source or tests changed in R/P.

## Goal

Show the first screenshot card within the initial 390×844 and 320×640 viewports while keeping run facts easy to reach, preserving the desktop arrangement, and keeping the generated gallery self-contained. Baseline card tops are 1420.2 px, 1594.2 px, and 866.1 px at 390×844, 320×640, and 1280×800 respectively (measurement method and ignored screenshots: `docs/shotwright-746.41-research.md`). The header and filters precede cards in the generated page (`src/gallery/render.ts:457-488`).

## Step list

1. **Header markup and responsive state — `src/gallery/render.ts`.** Keep all four status badges visible and in order (`src/gallery/render.ts:460-465`). Put the existing ten-cell `.runfacts` definition list inside a `<details class="run-facts-disclosure">` with a clear `<summary>Run facts</summary>` (`src/gallery/render.ts:467-478`). Emit no `open` attribute so a static file with JavaScript disabled has an operable closed disclosure. Add a small inline setup immediately after that element: `matchMedia('(max-width: 760px)')`, set `.open = !matches` initially, reset `.open` on its `change` event, then mark script readiness on the root element. Do not update state on ordinary resize or toggle events; manual mobile state lasts until a breakpoint crossing. Keep this setup under the existing meta CSP and in the standalone HTML (`src/gallery/render.ts:439-494`).
2. **Measured mobile compression — `src/gallery/assets.ts`.** Style the new summary as a visible 44 px target, with focus treatment inherited from existing rules (`src/gallery/assets.ts:22-25`, `src/gallery/assets.ts:117-120`). On script-enabled desktop only, hide the summary while the facts are open so the header height remains at its current baseline; on no-JS desktop, keep the summary visible so facts can be opened. Keep the existing four-column desktop definition list and two-column mobile list (`src/gallery/assets.ts:49-55`, `src/gallery/assets.ts:150-154`). Under the existing 760 px media query, reduce only the header/disclosure, controls, and spec spacing needed to clear the 320×640 fold; omit the mobile keyboard-hint line, leaving search/filter controls visible (`src/gallery/assets.ts:56-80`, `src/gallery/assets.ts:150-165`). Start from the browser prototype's 610.5 px card top at 320 px, then inspect a regenerated page. Do not alter card image loading, viewer, or compare gallery (`src/gallery/render.ts:125-145`, `src/gallery/render.ts:238-259`).
3. **Browser and static-output verification — `test/unit/gallery-browser.test.ts`.** Reuse its real gallery generation and Chromium setup (`test/unit/gallery-browser.test.ts:158-202`) and add one focused test with three contexts: 390×844, 320×640, 1280×800. Assert first `.card` `boundingBox().y < viewport.height` at both mobile sizes before scrolling, `.run-facts-disclosure.open === false` there, and `open === true` at desktop. At desktop assert the facts remain in the header and the first card top does not regress beyond a small pixel tolerance from the current baseline for that fixture. Cross the 760 px breakpoint in one context and assert the open state follows it; toggle manually on mobile with Enter and Space and assert the facts become visible. Create a `javaScriptEnabled:false` context and assert the summary can expose all ten fact rows by keyboard at mobile and desktop widths. Capture new mobile and desktop screenshots under ignored `local/` and inspect them. Run `pnpm run typecheck && pnpm run lint && pnpm run test` and the focused Chromium test. The test fixture's run ID/browser values differ from the measured demo run, so the final visual check must also use a newly generated demo gallery (`test/unit/gallery-browser.test.ts:191-201`, `src/gallery/render.ts:430-436`).

## Exact acceptance criteria

- On a newly generated real gallery with JavaScript enabled and no scroll, the first card's top edge is **strictly below 844 px at 390×844 and below 640 px at 320×640**. Record the numeric top edge and screenshots for each size. The baseline is documented in `docs/shotwright-746.41-research.md`.
- At 1280×800, the facts are open on load, retain their current four-column presentation, and the first card top is no lower than its measured 866.1 px baseline plus a 2 px rendering tolerance. The 760 px breakpoint matches the existing mobile CSS (`src/gallery/assets.ts:49-55`, `src/gallery/assets.ts:150-165`).
- All four status badges remain visible without opening facts; every original run fact remains available through one named summary (`src/gallery/render.ts:460-478`). On mobile, the summary works with Tab, Enter, and Space. With JavaScript disabled, it still opens at mobile and desktop widths. On script-enabled desktop, it is hidden while facts are already open, matching the current header height.
- A manual mobile toggle is respected while the viewport remains on one side of 760 px; crossing the breakpoint sets the corresponding mobile/desktop default. The generated page remains a single HTML file with its current meta CSP, inline CSS/JS, and embedded screenshot images (`src/gallery/render.ts:439-494`).
- No change to compare, per-card metadata, screenshot viewer behavior, or the no-shot empty state (`src/gallery/render.ts:158-170`, `src/gallery/render.ts:408-414`, `src/gallery/render.ts:491-494`).

## Acceptance mapping

| Step | Acceptance bullets covered |
| --- | --- |
| 1 | Visible status badges; all facts reachable; no-JS fallback; responsive state; standalone output |
| 2 | Mobile card top; desktop fact grid; existing controls and card behavior |
| 3 | Numeric viewport checks; keyboard/no-JS checks; desktop regression; visual review; quality gates |

## Risks and rollback

- **320 px margin is finite.** The browser prototype put the card at 610.5 px, about 29.5 px before the fold; unusually long run IDs, error banners, extra viewport filters, or localized text may exceed it (`src/gallery/render.ts:459-466`, `src/gallery/render.ts:368-379`). Pin the named acceptance on the real demo run and fixture; treat further content variants as a separate issue unless this implementation visibly regresses them.
- **Disclosure defaults depend on inline script for desktop.** The current CSP allows it (`src/gallery/render.ts:444`, `src/gallery/render.ts:493-494`); pin desktop load and no-JS behavior in the browser test. Rollback is removal of the wrapper/setup and mobile overrides, restoring the present header markup and CSS.
- **Mobile keyboard hint is omitted for space.** Search and filter controls remain present (`src/gallery/render.ts:480-484`). Verify the summary and controls are visible and keyboard operable in rendered Chromium before handoff.

## Open questions for the owner

None. This is a reversible gallery layout change and introduces no dependency or foundational decision.

## Self-review

- **Measured-or-flagged:** pass. Baselines and the 602.7 px prototype are measured; acceptance thresholds are explicit.
- **Derived-value semantics:** pass. Card top is the first `.card` viewport `y` before scrolling; an empty run has no card and is excluded from that assertion (`src/gallery/render.ts:408-414`).
- **Emergent structure:** pass. One header disclosure contains the original ten facts with unchanged fact order; status badges remain outside it (`src/gallery/render.ts:460-478`).
- **Batch/concurrency:** not applicable; no new data writes or asynchronous work.
- **Inherited constraints grounded:** pass. The plan uses the existing 760 px CSS breakpoint and inline CSP (`src/gallery/assets.ts:150-165`, `src/gallery/render.ts:444`). Step 3 pins their generated-file behavior.

## Redteam disposition (2026-10-28)

1. **No-JS filters appear usable — accepted, fix now.** Filter chips render enabled (`src/gallery/render.ts:369-378`) though they only work once the script binds (`src/gallery/assets.ts:255`). This predates this bead (shotwright-746.40 disabled the openers and Load screenshot but missed the chips and search). Add to Step 1: render the filter chips and search input `disabled` and enable them where the script binds them; Step 3 asserts both states.
2. **Card-top threshold can certify a sliver — accepted.** Replace "first `.card` top < viewport height" with: the first card's `.media` element shows at least 120 px of its height inside the initial viewport at 390×844 and 320×640, and the viewport screenshot is inspected.
3. **Desktop 2 px gate tied to the wrong run — accepted.** Drop the absolute desktop pixel oracle from the test. At 1280×800 assert the disclosure is open, its summary is not rendered (`display: none`), and all ten fact rows are visible; the demo-run measurement (866.1 px) is used only for visual review in verification.
