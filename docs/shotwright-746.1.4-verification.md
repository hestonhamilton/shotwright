# shotwright-746.1.4 — E1.V Verify: end-to-end capture evidence

- **Doc:** verification (V phase)
- **Bead:** shotwright-746.1.4 · parent epic shotwright-746.1 (E1 Core capture package)
- **Date:** 2026-07-29
- **Verifies:** PR #2 (`feat/shotwright-746.1.3-implement-core-capture`, commit e99d6d2;
  originally PR #1 / 6e9a088 — renumbered after the 2026-07-29 history rewrite)

## Acceptance checklist (epic shotwright-746.1)

> *A consumer (the demo app) can pnpm add shotwright from git, write a `*.shots.ts`
> spec, run `shotwright run`, and get PNGs + manifest.json in `shots-output/<run>/`
> with `latest` symlink; `--only` filters writes; video/trace toggles work.*

- [x] **Consumer install** — verified against the *packed tarball* (`pnpm pack` →
  `pnpm add <tgz>` in a fresh scratch project), which is the same artifact a git
  dependency resolves to (`files: dist, templates`); the real git-URL install is
  re-proven by the E8 migrations. Bin + peer resolved from the consumer's
  `node_modules`, no shotwright-side Playwright leaked.
- [x] **Write a spec, run, get PNGs + manifest + `latest`** — both in-repo demo
  (2 specs, parallel workers) and scratch consumer (1 spec, `data:` URL, no
  webServer). Layout matches the contract exactly (listings below).
- [x] **`--only` filters writes** — consumer run with `--only skipme`: walkthrough
  ran (`1 passed`), exactly one shot written; manifest `flags.only: ["skipme"]`,
  `shots: ["hello-skipme"]`.
- [x] **Video toggle** — demo run `--only home --video`: real webm copied to
  `video/<testId>.webm`, path recorded on the entry, `flags.video: true`.
- [x] **Trace toggle** — consumer run `--trace`: `trace/<testId>.zip` in the run
  dir (listing below).
- [x] **Gates green** — typecheck clean; eslint + build + publint "All good!";
  27/27 unit tests; smoke 5/5 (incl. the parallel-worker manifest pin).

## Commands run (verbatim, output truncated)

```
$ pnpm run typecheck && pnpm run lint && pnpm run test
> tsc --noEmit
Running publint v0.3.22 for shotwright... All good!
 Test Files  6 passed (6)
      Tests  27 passed (27)

$ pnpm run smoke
 Test Files  1 passed (1)
      Tests  5 passed (5)

$ node dist/cli.js run --config demo/shots.config.ts --only home --video
shot home
  2 passed (621ms)
shotwright: 1 shot(s) → .../shots-output/2026-07-29T16-27-43_abc4
# manifest: flags {only:["home"],video:true}, entry video: "video/<testId>.webm"

# fresh consumer from the packed tarball
$ pnpm add -D <scratch>/shotwright-0.1.0.tgz @playwright/test@1.62.0
+ @playwright/test 1.62.0
+ shotwright 0.1.0
$ pnpm exec shotwright run --trace
shot hello
shot hello-skipme
  1 passed (567ms)
shotwright: 2 shot(s) → .../consumer/shots-output/2026-07-29T16-30-28_e484
$ find shots-output | sort
shots-output/2026-07-29T16-30-28_e484/manifest.json
shots-output/2026-07-29T16-30-28_e484/shots/hello.shots.ts/hello.png
shots-output/2026-07-29T16-30-28_e484/shots/hello.shots.ts/hello-skipme.png
shots-output/2026-07-29T16-30-28_e484/trace/676d…3bdb.zip
shots-output/latest

$ pnpm exec shotwright run --only skipme
  1 passed (455ms)
shotwright: 1 shot(s) → …
# manifest: {"flags":{"only":["skipme"],"video":false,"trace":false},"shots":["hello-skipme"]}
```

## Observations

- Playwright's `.last-run.json` is written into its outputDir *after* reporter
  `onEnd`; the `.pw` staging sweep therefore lives in `onExit`. Caught by the smoke
  test during I, fixed there (not a V-phase fix).
- The scratch consumer ran under pnpm 10.33 (vs 10.13 in-repo) — peer auto-install
  and bin resolution behaved identically.
- Demo captures (home, about, about-heading locator shot) delivered for owner
  eyeball review in-session — the repo's own "unviewed UI change does not ship"
  gate.

## Sign-off

- Verified by: delegated verifier, 2026-07-29
- Owner sign-off: pending at bead close (captures delivered; close of
  shotwright-746.1.4 constitutes sign-off)
