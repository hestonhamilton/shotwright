# Mobile gallery run facts — research (shotwright-746.41)

Read and measured: 2026-10-28. Scope: the ordinary generated gallery. This phase changed no source or tests.

## Context and constraints

The gallery is a standalone HTML document with inline styles and script, a meta CSP permitting those inline blocks and `data:` images, and no network connection (`src/gallery/render.ts:439-494`). The run header places status badges, ten run facts, and then filters before the spec and card grid (`src/gallery/render.ts:457-488`). The mobile stylesheet keeps the facts in a two-column grid (`src/gallery/assets.ts:49-55`, `src/gallery/assets.ts:150-160`). The first card is rendered inside that grid after the spec header (`src/gallery/render.ts:150-171`, `src/gallery/render.ts:238-259`). The design requires self-contained, phone-friendly, throwaway review artifacts rather than golden-image gating (`docs/design.md:21-38`, `docs/design.md:70-85`). The owner specified the viewport targets, public-path rule, and R+P-only scope; no further kickoff choice is needed.

## Reproduction and measurements

`pnpm build` passed (`tsc -p tsconfig.build.json`). `pnpm run demo:shots` generated a five-shot gallery from the demo specs, through the package build and CLI. The run includes real Playwright captures and a browser executable observation; the latter makes the Browsers fact unusually tall on narrow screens (`src/gallery/render.ts:430-436`, `src/gallery/render.ts:473`). I opened its `gallery.html` as a `file:` URL in headless Chromium at device scale factor 1, with JavaScript enabled. Measurements use `getBoundingClientRect()` before scrolling. Screenshots are saved as `local/gallery-current-390x844.png`, `local/gallery-current-320x640.png`, and `local/gallery-current-1280x800.png`; raw geometry is in `local/gallery-current-measurements.json`. These local files are ignored evidence, not committed deliverables.

| Viewport | Header height | Facts height | Filters height | Spec header height | First card top | Card top minus fold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 390×844 | 958.2 px | 693.7 px | 261.3 px | 145.8 px | 1420.2 px | +576.2 px |
| 320×640 | 1132.2 px | 867.7 px | 261.3 px | 145.8 px | 1594.2 px | +954.2 px |
| 1280×800 | 523.5 px | 355.7 px | 185.9 px | 85.8 px | 866.1 px | +66.1 px |

The figures are for this generated demo run, not a universal layout bound. At 390 px and 320 px, the header alone extends past the fold. The ten fact cells and their long browser executable string dominate it; dates and version text wrap more at 320 px (`src/gallery/render.ts:467-478`, `src/gallery/assets.ts:49-55`, `src/gallery/assets.ts:150-154`). Below that, the sticky filters, their keyboard hint, and the spec header add more height (`src/gallery/render.ts:480-484`, `src/gallery/render.ts:254-259`, `src/gallery/assets.ts:56-80`). At 1280 px the card is also just below the fold, so the requested desktop criterion should preserve layout rather than promise an above-fold desktop card.

## Options

| Option | Benefit | Cost / no-JS behavior |
| --- | --- | --- |
| **Recommended — native `<details>` around run facts, plus small mobile spacing changes** | Preserves the data and semantic disclosure; a visible summary stays operable without JavaScript. All status badges stay in their current row. | Static HTML cannot give `<details>` two initial `open` values by viewport using CSS alone. Emit it closed, then use the existing permitted inline script to open it on desktop and on breakpoint changes. Without JS it remains closed on both sizes, but facts are one keyboard action away. At 320 px, the disclosure alone is insufficient: prototype card top was 764.5 px. |
| CSS-only reflow or visual clipping | No new script; can reduce gaps and cell padding. | Ten facts and the long browser path still occupy many lines. `display:none` or height clipping would hide facts without an accessible way to reveal them. CSS alone cannot toggle the semantic `open` attribute. |
| Move facts after the grid | First card arrives sooner without disclosure state. | Changes desktop information order and makes run provenance harder to find after many shots. Keyboard and no-JS access remain, but the facts are far from the header. |

The recommended prototype was an in-browser DOM/CSS experiment on the generated file; it did not edit package code. With the facts collapsed and no other changes, first card top was 764.5 px at both mobile widths. Keeping every status badge visible, hiding the mobile-only keyboard hint, and tightening mobile header/controls/spec spacing put the card at **610.5 px** on 320×640 and **586.3 px** on 390×844. On script-enabled desktop, hiding the summary while facts are open kept the card exactly at its **866.1 px** baseline. The corresponding screenshots are `local/gallery-prototype-final-*.png`. The summary must remain visible when JavaScript is disabled, even on desktop, so the CSS should hide it there only after script setup marks the document ready. The keyboard hint is explanatory text, while the search and filters themselves remain visible controls (`src/gallery/render.ts:480-484`); omitting only the mobile hint is a layout tradeoff to verify visually.

## Prior art and currency

- [MDN, `<details>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details), read 2026-10-28: a native summary exposes a disclosure, and the Boolean `open` attribute determines whether its contents show. This supports closed HTML as the no-JS fallback; CSS can style state but cannot assign the attribute.
- [WHATWG HTML Standard, interactive elements](https://html.spec.whatwg.org/multipage/interactive-elements.html), read 2026-10-28: `details` has specified `open`-attribute change behavior. This supports changing `.open` from a small script rather than hiding the definition list with CSS.
- [WAI-ARIA APG, Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/), read 2026-10-28: Enter and Space are the expected disclosure keys. Native `<summary>` should be tested with both, including JavaScript disabled.
- [MDN, MediaQueryList](https://developer.mozilla.org/en-US/docs/Web/API/MediaQueryList), read 2026-10-28: `matchMedia()` plus a `change` listener detects crossing the breakpoint. This allows initial desktop open state and responsive transitions without a resize handler on every pixel.
- [MDN, CSP `script-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src), read 2026-10-28: `script-src 'unsafe-inline'` permits an inline script. The gallery already uses that policy and inline runtime (`src/gallery/render.ts:444`, `src/gallery/render.ts:493-494`); this scoped change needs no external asset or wider CSP.

## Recommendation

Use one native run-facts disclosure immediately after the visible status row. Render it closed, open it at desktop width with a short inline `matchMedia` setup adjacent to the header, and update it only when crossing the same 760 px breakpoint as the mobile CSS (`src/gallery/assets.ts:150-165`). Preserve the user's manual mobile toggle until the breakpoint changes. Hide the summary on script-enabled desktop while the facts are open, but leave it available for desktop no-JS. Keep all ten fact rows and all status badges in their existing order (`src/gallery/render.ts:460-478`). Apply only the mobile spacing needed to put the card top below 640 px on the measured real run, and verify 390 px and 320 px with Chromium. Do not change the compare gallery, card metadata disclosure, screenshot viewer, data model, or artifact order.

## Open questions

None for this scoped P3 change. The desktop no-JS fallback is a closed disclosure; the facts remain available through its summary.

## Self-review

- **Measured-or-flagged:** pass. All layout numbers above came from the generated demo gallery or the explicitly labeled DOM prototype.
- **Derived-value semantics:** pass. “Card top” is the first `.card` viewport top before scrolling; “minus fold” subtracts viewport height. An empty run has no first card and uses its existing empty state (`src/gallery/render.ts:408-414`).
- **Emergent structure:** pass. The disclosure owns one ten-row definition list; status badges stay before it and filters stay after it (`src/gallery/render.ts:460-484`).
- **Batch/concurrency:** not applicable; generated HTML has a single local script and no new persistence.
- **Inherited constraints grounded:** pass. The current inline CSP and mobile breakpoint are present in source (`src/gallery/render.ts:444`, `src/gallery/assets.ts:150-165`).
