---
name: shots-harness
description: Use when capturing Playwright-powered UI walkthrough artifacts with shotwright for human review.
---

# shots-harness

Use shotwright for review artifacts, not assertions. Captures are regenerated,
gitignored output for a human to inspect; do not turn them into golden-diff gates.

## Capture

Run all walkthroughs:

```bash
pnpm shots
```

Filter written screenshots by shot-name substring:

```bash
pnpm shots --only home
```

The walkthrough still runs; `--only` gates which `shot()` calls write artifacts.

Capture video and trace artifacts:

```bash
pnpm shots --video --trace
```

Pass Playwright test flags after shotwright flags:

```bash
pnpm shots -- --workers=1
pnpm shots --video -- --workers=1
pnpm shots -- --trace retain-on-failure
```

If `--only`, `--video`, or a bare `--trace` appears after `--`, shotwright
applies it and removes it from Playwright passthrough with a warning. Playwright
also owns `--trace <mode>`, so `pnpm shots -- --trace retain-on-failure` leaves
that pair in passthrough for Playwright.

Do not run these specs with bare `playwright test`. `shot()` expects the
environment contract created by `shotwright run`.

## Gallery

Build and serve the latest successful run:

```bash
pnpm shots:gallery
```

Serve for phone review only when needed:

```bash
pnpm shots:gallery --lan
```

Loopback serving is the default. `--lan` exposes the captures to anyone on the
network until the server stops, so use it deliberately.

`gallery.html` embeds the original screenshot bytes, so that one file is the
complete screenshot review artifact. Video and trace files stay beside it in the
run directory; moving `gallery.html` away breaks those links. Serve the run
directory when video or trace review matters.

## Project Notes

Add project-specific capture notes below this line. `shotwright init` never
overwrites an existing `SKILL.md`; when guidance changes, it writes a `.new`
sibling for manual review.
