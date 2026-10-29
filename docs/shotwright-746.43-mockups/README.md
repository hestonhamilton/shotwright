# Compare interaction mockups

Open any HTML file directly in a browser. All are self-contained and use generated SVG illustrations, inline CSS/JS, and no network access. The range inputs work with pointer, Tab, arrow keys, Home and End. The dialog examples use Escape to close. These are interaction sketches, not screenshot or pixel-scale proofs.

- [Option A — inline](option-a-inline.html): A mode switcher appears in the pair card, making overlay controls visible during scanning.
- [Option B — dialog](option-b-dialog.html): The card stays compact; “Inspect A/B together” opens side by side, swipe and onion modes with a zoom toggle. Recommended for this P3 bead.
- [Option C — both](option-c-both.html): A quick card overlay and a full dialog share the same modes, at the cost of repeated controls.

The grey examples show how size-changed, one-sided and unreadable pairs should be explained; they are deliberately illustrative rather than interactive cases. The proposed production layout must reuse each image URI already serialized in the compare page (`src/gallery/render-compare.ts:58-66`); these SVG illustrations do not model generated HTML byte cost.
