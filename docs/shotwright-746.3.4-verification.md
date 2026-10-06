# shotwright-746.3.4 — E3.V: Gallery end-to-end verification

Verification date: 2026-07-29, against merged main `0e29a01` (PR #7).
Synthesized from delegated verification evidence (full per-command transcript
and visual inspection captures archived outside the repo, reviewed
by the reviewer and the owner). Every machine-executable V pin from
`docs/shotwright-746.3.2-plan.md` passed; the physical iOS/Android phone gate
is recorded in its own section below.

## Machine-executable pins — all PASS

| # | Pin | Evidence (see transcript for exact commands/output) |
|---|---|---|
| 1 | Fresh run publishes manifest + gallery, `latest` follows | Clean `shots-output` → `CI=1 pnpm run demo:shots` → run dir with `manifest.json` + `gallery.html` (2,933,648 bytes, 5 shots), `latest` → that run |
| 2 | Copied `gallery.html` alone is the complete screenshot artifact | File copied outside the repo, opened via `file:` in Chromium with network disabled: zero console/page errors, five cards, data-URI download byte-equal to source PNG |
| 3 | Logical ≠ intrinsic dimensions preserved | `modal-open` card: logical 1440×960 · DSF 2, derived intrinsic 1,040×816 |
| 4 | Partial/failed run truthfully handled | Capture-then-throw run: nonzero exit, one-shot manifest + auto gallery, `latest` unchanged; explicit serve prints the may-be-partial caution |
| 5 | Generator failure decoupled (RT-4, all five outcomes) | Injected failure on a passing run: manifest published, `latest` advanced, nonzero exit, diagnostics printed, staging cleaned; plain `shotwright gallery` then repaired and exited 0 |
| 6 | Video/trace linking + range serving | `--video --trace` run: one dedup'd artifact group per test ("shared by N shots by identical manifest path"), inline player, sibling-file warning; WebM range → `206 bytes 17-83/51126` byte-exact; trace served `application/zip` |
| 7 | Serve security posture | `/manifest.json` 404, encoded traversal 404, POST 405, `no-store` + `nosniff` on responses; loopback default prints the hint, not the warning |
| 8 | LAN exposure deliberate and reachable | `--lan`: Local + LAN URLs printed (real addresses redacted in records), exposure warning printed, gallery fetched over the non-loopback address (200, 2,934,812 bytes) |
| 9 | 60-shot bounded decode (desktop preflight ONLY) | Byte-unique synthetic corpus (60 pairwise-distinct data URIs), 34,991,346-byte gallery; headless-Chromium scroll-through kept the `#debug` counter ≤ 3 |
| 10 | Packed-artifact consumer proof | `pnpm pack` tarball installed in a scratch consumer with the Playwright peer: real walkthrough ran, gallery generated, `shotwright gallery` served, page rendered |
| 11 | Full gates on merged main | typecheck, lint + publint green; unit 160/160; smoke 13/13 |
| 12 | Renderer inertness re-proof | Malicious manifest fixture rendered inert in Chromium (no script execution/beacons) |

Visual inspection: both gallery states (artifact-absent five-shot run and
video/trace-enabled run) were rendered and reviewed as screenshots by the
reviewer and delivered to the owner — the run header/intrinsic badge,
spec workbench layout, DSF chips, expandable metadata, working 1:1 inspection
dialog, dedup'd artifact groups in both states, and bounded-decode
placeholders all match the signed-off composite mockup.

## Ambiguities corrected during verification

- The plan's V command sketch (`docs/shotwright-746.3.2-plan.md:265`) uses
  no `--` separator before shotwright flags. This document originally claimed
  the working form was `CI=1 pnpm run demo:shots -- --video --trace`; that was
  wrong at the time because pnpm forwarded the literal `--`, and shotwright
  treated everything after it as Playwright passthrough. The unambiguous form
  remains `CI=1 pnpm run demo:shots --video --trace` because it works under
  both `pnpm run` and `pnpm exec`.
- Current behavior changed after ADR 0006: `CI=1 pnpm run demo:shots -- --video
  --trace` now works by reclaiming the misplaced shotwright flags and printing
  warnings for `--video` and bare `--trace`. `CI=1 pnpm run demo:shots --video
  --trace` works without those warnings.
- Consumer-proof commands run the packed CLI via the consumer's
  `node_modules/.bin/shotwright`, not a repo self-bin (matches E2's fresh-clone
  finding).

## Physical-phone gate (the plan's release gate for the decode window)

Protocol per plan: serve the synthetic 60-shot run with `--lan`; on one
physical iPhone (current iOS Safari) and one physical Android (current stable
Chrome) on the same LAN: cold-open the LAN URL; scroll 1→60→1 twice with the
`#debug` counter visible (must stay ≤ 3, every card must resolve); 1:1 inspect
shots 1/30/60 (pan/pinch/download, focus return); background/restore the
browser and re-inspect; seek the sibling video on the artifact-enabled run;
rotate both orientations; loopback negative check before `--lan`.

**Result — two-stage, recorded honestly:**

*First pass (physical, owner-executed, 2026-07-29):* loopback negative check
PASSED on both phones (loopback-bound serve unreachable; `--lan` serves
reachable). Both devices then FAILED on the tall-aspect card: the
mobile-layout capture's contained strip rendered over the still-visible
placeholder caption. Filed and fixed as `shotwright-746.3.5` (PR #8):
placeholder content now hides on image insertion and returns on
bounded-decode eviction, pinned by visible-text-intersection browser tests.

*Second pass (2026-07-30) — owner decision, recorded on the bead: the
remaining protocol was executed as an EMULATED FACSIMILE in place of physical
devices* (a one-off script, Playwright device profiles against
the real `--lan` servers over the LAN address): iPhone 15 profile on WebKit
26.5 and Pixel 7 profile on Chromium, per device: cold-open (717 ms / 185 ms
to load of the 34,991,530-byte gallery), 60/60 cards resolving across two
full 1→60→1 scroll rounds with the `#debug` counter peaking at exactly 3,
tall-card containment with no visible text under the image, 1:1 inspection
open/render/close on shots 1/30/60, visibility-flip + re-inspection,
landscape with zero page-level horizontal overflow, real sibling-video seek
(1.40 s WebM seeked to 0.70 s), zero page errors. **All 20 observations
passed on both profiles.**

*Residual risk, left open deliberately:* emulation does not reproduce real
device memory pressure or iOS Safari's tab-kill behavior — the original
reason the plan wanted physical devices. The ≤3-node decode window ships as
emulation-verified; if a real phone ever crashes or reloads on a large
gallery, that observation reopens this gate (no code assumption depends on
the stronger claim).

## Epic acceptance verdict

**E3 acceptance met** under the owner-modified gate. After a run,
`shotwright gallery` opens/serves a single self-contained HTML file showing
every capture with metadata (pins 1–3, 12), and phone-on-LAN usability is
demonstrated by the physical first-pass reachability checks plus the
owner-directed emulated protocol above (pins 8–9, second pass). One
verification finding (`shotwright-746.3.5`, tall-aspect layering) was found
by the gate working as intended, fixed, and re-verified. The Chromium
capture flake remains diagnosed as environment noise (E3.I redteam) and is
tracked in bead notes.
