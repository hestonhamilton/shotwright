# E10 experiments — shotwright-746.28.1

All paths in this report are relative to the worktree. Commands in E1, E2, E4, and E5 ran from `local/exp-g8/` unless shown otherwise; E3 says which directory. Captured output containing an absolute worktree path is rendered with its worktree-relative suffix here. This rendering changes only the path prefix, not the message. The shell combined stdout and stderr except where E4 records them separately. Scratch files were written only under `local/`.

## E1 — G8: Playwright cleanup and config throw

### Setup

Created `local/exp-g8/package.json` (`{"type":"module"}`), `shots.config.ts` (`import { defineShotsConfig } from '../../dist/index.js'; export default defineShotsConfig();`), `shots/a.shots.ts` (navigates to `data:text/html,<h1>x</h1>`, calls `shot(page, 'a')`), `shots.throwing.config.ts` (logs `process.argv` and two environment values, then throws before calling the factory for a bare non-probe invocation), and `test-results/sentinel.txt`. The spec imports `../../../dist/capture.js`; its extra `..` is required because it is in `shots/`.

### Commands

| Command (from `local/exp-g8/`) | Exit |
|---|---:|
| `mkdir -p local/exp-g8/shots local/exp-g8/test-results local/exp-cjs` (worktree root) | 0 |
| Fixture write commands shown verbatim immediately below (worktree root) | 0 each |
| `printf 'sentinel\n' > local/exp-g8/test-results/sentinel.txt` (worktree root) | 0 |
| `node ../../node_modules/@playwright/test/cli.js test -c shots.config.ts` | 1 |
| `if test -e test-results/sentinel.txt; then echo 'sentinel=present'; else echo 'sentinel=absent'; fi` | 0 |
| `find test-results -maxdepth 3 -type f -printf '%P %s bytes\n' \| sort` | 0 |
| `if test -e shots-output; then find shots-output -maxdepth 2 -type f -printf '%P\n'; else echo 'shots-output=absent'; fi` | 0 |
| `printf 'sentinel\n' > test-results/sentinel.txt` | 0 |
| `node ../../node_modules/@playwright/test/cli.js test -c shots.throwing.config.ts` | 1 |
| `if test -e test-results/sentinel.txt; then echo 'sentinel=present'; else echo 'sentinel=absent'; fi` | 0 |
| `find test-results -maxdepth 3 -type f -printf '%P %s bytes\n' \| sort` | 0 |
| `node ../../node_modules/@playwright/test/cli.js test -c shots.throwing.config.ts --list` | 1 |
| `node ../../dist/cli.js run --config shots.config.ts` | 0 |
| `find shots-output -maxdepth 4 -type f -printf '%P %s bytes\n' \| sort` | 0 |
| `if test -e test-results/sentinel.txt; then echo 'sentinel=present'; else echo 'sentinel=absent'; fi` | 0 |

Fixture write commands (each exited 0):

```sh
cat > local/exp-g8/package.json <<'EOF'
{"name":"shotwright-exp-g8","private":true,"type":"module"}
EOF
cat > local/exp-g8/shots.config.ts <<'EOF'
import { defineShotsConfig } from '../../dist/index.js';
export default defineShotsConfig();
EOF
cat > local/exp-g8/shots.throwing.config.ts <<'EOF'
import { defineShotsConfig } from '../../dist/index.js';
console.log('CONFIG_ARGV=' + JSON.stringify(process.argv));
console.log('CONFIG_ENV=' + JSON.stringify({ SHOTWRIGHT_RUN: process.env.SHOTWRIGHT_RUN ?? null, SHOTWRIGHT_CONFIG_PROBE_FILE: process.env.SHOTWRIGHT_CONFIG_PROBE_FILE ?? null }));
if (process.env.SHOTWRIGHT_RUN !== '1' && !process.env.SHOTWRIGHT_CONFIG_PROBE_FILE) {
  throw new Error('experiment: bare Playwright config evaluation refused');
}
export default defineShotsConfig();
EOF
cat > local/exp-g8/shots/a.shots.ts <<'EOF'
import { test } from '@playwright/test';
import { shot } from '../../../dist/capture.js';
test('a', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>');
  await shot(page, 'a');
});
EOF
```

### Observations

Bare runner: `Running 1 test using 1 worker`; `Error: shotwright: SHOTWRIGHT_RUN_DIR is not set — run specs via \`shotwright run\` (bare \`playwright test\` runs are not supported)`; `Error Context: test-results/a.shots.ts-a-shots/error-context.md`; `shotwright reporter: SHOTWRIGHT_RUN_DIR not set — skipping manifest assembly`. Inspection printed `sentinel=absent`, `.last-run.json 96 bytes`, `a.shots.ts-a-shots/error-context.md 4676 bytes`, and `shots-output=absent`.

Throwing config with `test`: `CONFIG_ARGV=["<node>","<worktree>/node_modules/@playwright/test/cli.js","test","-c","shots.throwing.config.ts"]`; `CONFIG_ENV={"SHOTWRIGHT_RUN":null,"SHOTWRIGHT_CONFIG_PROBE_FILE":null}`; `Error: experiment: bare Playwright config evaluation refused`. Inspection printed `sentinel=present` and the same earlier result files plus `sentinel.txt 9 bytes`.

Throwing config with `--list`: `CONFIG_ARGV=["<node>","<worktree>/node_modules/@playwright/test/cli.js","test","-c","shots.throwing.config.ts","--list"]`; the same `CONFIG_ENV` and error appeared. No test listing was printed.

Normal run: `shot a`; `1 passed (487ms)`; `shotwright: 1 shot(s) → local/exp-g8/shots-output/2026-10-22T18-26-29_9b9f`. Files: `gallery.html 50204 bytes`, `manifest.json 650 bytes`, `shots/a.shots.ts/a.png 21877 bytes`; `sentinel=present`.

### Answer

A factory that returns a normal config lets Playwright clean its default `test-results/` before the spec reaches `shot()` and fails. A top-level config throw prevented that cleanup in this run; it also blocked `--list`. `process.argv` exposed `--list`, while the two inspected environment values did not distinguish it. The normal shotwright run succeeded and wrote a manifest.

## E2 — G4/G3: reporter status, attachments, and sweep

### Setup

Added `shots/fail.shots.ts`: capture `before-fail`, then `expect(page.locator('h1')).toHaveText('y', { timeout: 500 })` against `<h1>x</h1>`. Added `spy-reporter.mjs`: `onTestEnd` prints test id, title, status, retry, duration, first error line, and each attachment's name, content type, and path relative to the run directory or body length. `onEnd` prints `FullResult.status`.

### Commands

| Command (from `local/exp-g8/`) | Exit |
|---|---:|
| Fixture write commands shown verbatim immediately below (worktree root) | 0 each |
| `node ../../dist/cli.js run --config shots.config.ts -- --reporter=./spy-reporter.mjs,list` | 1 |
| `find shots-output/2026-10-22T18-26-42_d44b -maxdepth 6 -type f -printf '%P %s bytes\n' \| sort` | 0 |
| `if test -e shots-output/2026-10-22T18-26-42_d44b/.pw/fail.shots.ts-fail-after-capture-shots/error-context.md; then echo 'error-context=present'; else echo 'error-context=absent'; fi` | 0 |
| `node ../../dist/cli.js run --config shots.config.ts -- --reporter=./spy-reporter.mjs,../../dist/reporter.js,list` | 1 |
| `find shots-output/2026-10-22T18-26-52_cdb4 -maxdepth 6 -type f -printf '%P %s bytes\n' \| sort` | 0 |
| `if test -e shots-output/2026-10-22T18-26-52_cdb4/.pw/fail.shots.ts-fail-after-capture-shots/error-context.md; then echo 'error-context=present'; else echo 'error-context=absent'; fi` | 0 |
| `node ../../dist/cli.js run --trace --config shots.config.ts -- --reporter=./spy-reporter.mjs,../../dist/reporter.js,list` | 1 |
| `find shots-output/2026-10-22T18-26-59_2fc1 -maxdepth 6 -type f -printf '%P %s bytes\n' \| sort` | 0 |
| `if test -e shots-output/2026-10-22T18-26-59_2fc1/.pw/fail.shots.ts-fail-after-capture-shots/error-context.md; then echo 'error-context=present'; else echo 'error-context=absent'; fi` | 0 |
| `node ../../dist/cli.js run --video --config shots.config.ts -- --reporter=./spy-reporter.mjs,../../dist/reporter.js,list` | 1 |
| `find shots-output/2026-10-22T18-27-05_d4d4 -maxdepth 6 -type f -printf '%P %s bytes\n' \| sort` | 0 |
| `if test -e shots-output/2026-10-22T18-27-05_d4d4/.pw/fail.shots.ts-fail-after-capture-shots/error-context.md; then echo 'error-context=present'; else echo 'error-context=absent'; fi` | 0 |

Fixture write commands (each exited 0):

```sh
cat > local/exp-g8/shots/fail.shots.ts <<'EOF'
import { expect, test } from '@playwright/test';
import { shot } from '../../../dist/capture.js';
test('fail after capture', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>');
  await shot(page, 'before-fail');
  await expect(page.locator('h1')).toHaveText('y', { timeout: 500 });
});
EOF
cat > local/exp-g8/spy-reporter.mjs <<'EOF'
import path from 'node:path';
export default class SpyReporter {
  onTestEnd(test, result) {
    const runDir = process.env.SHOTWRIGHT_RUN_DIR;
    const attachments = result.attachments.map((item) => ({
      name: item.name,
      contentType: item.contentType,
      ...(item.path ? { path: runDir ? path.relative(runDir, item.path) : item.path } : {}),
      ...(item.body ? { bodyLength: item.body.length } : {}),
    }));
    console.log('SPY_TEST=' + JSON.stringify({
      id: test.id,
      title: test.title,
      status: result.status,
      retry: result.retry,
      duration: result.duration,
      error: result.error?.message?.split('\n')[0] ?? null,
      attachments,
    }));
  }
  onEnd(result) { console.log('SPY_END=' + JSON.stringify({ status: result.status })); }
}
EOF
```

### Observations

The requested `--` passthrough form worked. In every run the failing test had `id=73945c29f907fb4bafcb-7027fc5a79a3c5eb4f69`, `title="fail after capture"`, `status="failed"`, `retry=0`, first error line `Error: expect(locator).toHaveText(expected) failed` (the spy's raw JSON included ANSI color codes), and `SPY_END={"status":"failed"}`. Durations were 683, 705, 725, and 723 ms respectively. The passing test had `status="passed"`, `retry=0`, no error, and no attachments in plain runs.

| Run | Failing test attachments in `onTestEnd`, in order | Playwright terminal line | Result after run |
|---|---|---|---|
| Spy + list | `error-context`, `text/markdown`, `.pw/fail.shots.ts-fail-after-capture-shots/error-context.md` | `Error Context: shots-output/2026-10-22T18-26-42_d44b/.pw/fail.shots.ts-fail-after-capture-shots/error-context.md` | `error-context=present` |
| Spy + shotwright + list | same attachment | `Error Context: shots-output/2026-10-22T18-26-52_cdb4/.pw/fail.shots.ts-fail-after-capture-shots/error-context.md` | `error-context=absent` |
| `--trace` + all three reporters | `error-context` as above; `trace`, `application/zip`, `.pw/fail.shots.ts-fail-after-capture-shots/trace.zip` | `Error Context: shots-output/2026-10-22T18-26-59_2fc1/.pw/fail.shots.ts-fail-after-capture-shots/error-context.md` | `error-context=absent` |
| `--video` + all three reporters | `video`, `video/webm`, `.pw/fail.shots.ts-fail-after-capture-shots/video.webm`; `error-context` as above | `Error Context: shots-output/2026-10-22T18-27-05_d4d4/.pw/fail.shots.ts-fail-after-capture-shots/error-context.md` | `error-context=absent` |

The plain run with only the spy and list reporters had `.pw/.last-run.json`, `.pw/.../error-context.md`, two `.sidecar/*.json` files, and the two captured PNGs; it had no manifest or gallery. Including shotwright's reporter yielded these trees (file sizes omitted here):

```text
2026-10-22T18-26-52_cdb4/
  gallery.html
  manifest.json
  shots/a.shots.ts/a.png
  shots/fail.shots.ts/before-fail.png
2026-10-22T18-26-59_2fc1/
  gallery.html
  manifest.json
  shots/a.shots.ts/a.png
  shots/fail.shots.ts/before-fail.png
  trace/73945c29f907fb4bafcb-7027fc5a79a3c5eb4f69.zip
  trace/b713bd177a50729823ec-158f6319eff9db90303c.zip
2026-10-22T18-27-05_d4d4/
  gallery.html
  manifest.json
  shots/a.shots.ts/a.png
  shots/fail.shots.ts/before-fail.png
  video/73945c29f907fb4bafcb-7027fc5a79a3c5eb4f69.webm
  video/b713bd177a50729823ec-158f6319eff9db90303c.webm
```

### Answer

Playwright reports a failed result with an `error-context` markdown attachment; trace and video modes add their respective attachments. The list reporter prints `.pw` attachment paths, but shotwright's reporter sweeps `.pw` after copying trace/video artifacts, so the printed error-context path no longer exists after completion. Explicitly replacing the configured reporter prevents that sweep and manifest assembly.

## E3 — G13e: CommonJS `require()`

### Setup

Packed the worktree into `local/exp-cjs/shotwright-0.1.1.tgz`, extracted it to `local/exp-cjs/node_modules/shotwright/`, and wrote `index.cjs` with the requested two `require()` calls and `console.log(typeof sw.defineShotsConfig, typeof cap.shot)`. Added `local/exp-cjs/package.json` with name `shotwright-cjs-experiment` and `type: commonjs` to make this a distinct consumer package. Before that boundary, Node's package self-reference resolved `shotwright` to the parent worktree, so the first two executions did not test the tarball.

### Commands

| Command | Exit |
|---|---:|
| `pnpm pack --pack-destination local/exp-cjs/` (worktree root) | 0 |
| `mkdir -p local/exp-cjs/node_modules/shotwright` (worktree root) | 0 |
| `tar -xzf local/exp-cjs/shotwright-0.1.1.tgz -C local/exp-cjs/node_modules/shotwright --strip-components=1` (worktree root) | 0 |
| Fixture write commands shown verbatim immediately below (their respective directories) | See commands below |
| `node --version` (worktree root) | 0 |
| `node index.cjs` (from `local/exp-cjs/`, before consumer package boundary) | 0 |
| `node --no-experimental-require-module index.cjs` (same) | 1 |
| `node -p "require.resolve('shotwright')"` (same, before boundary) | 0 |
| `node index.cjs` (same, before boundary) | 0 |
| `node --no-experimental-require-module index.cjs` (same, before boundary) | 1 |
| `node -p "require.resolve('shotwright')"` (same) | 0 |
| `node index.cjs` (same) | 0 |
| `node --no-experimental-require-module index.cjs` (same) | 1 |

Fixture write commands:

```sh
cat > local/exp-cjs/index.cjs <<'EOF'
const sw = require('shotwright');
const cap = require('shotwright/capture');
console.log(typeof sw.defineShotsConfig, typeof cap.shot);
EOF
```

That command exited 0 from the worktree root. The first attempted consumer boundary command was run from `local/exp-cjs/` and exited 1:

```sh
cat > local/exp-cjs/package.json <<'EOF'
{"name":"shotwright-cjs-experiment","private":true,"type":"commonjs"}
EOF
```

The corrected command, from `local/exp-cjs/`, exited 0:

```sh
cat > package.json <<'EOF'
{"name":"shotwright-cjs-experiment","private":true,"type":"commonjs"}
EOF
```

### Observations

`node --version` printed `v24.16.0`. `pnpm pack` printed `package: shotwright@0.1.1` and `shotwright-0.1.1.tgz`. After the consumer package boundary, `require.resolve('shotwright')` printed `local/exp-cjs/node_modules/shotwright/dist/index.js`. `node index.cjs` printed `function function`; stderr was empty, with no warning. `node --no-experimental-require-module index.cjs` printed `Error [ERR_REQUIRE_ESM]: require() of ES Module local/exp-cjs/node_modules/shotwright/dist/index.js from local/exp-cjs/index.cjs not supported.` and `Node.js v24.16.0`; it failed on the first `require()`.

### Answer

On Node v24.16.0 with its default require(esm) behavior, a CommonJS consumer can require both packed entry points and gets functions. With require(esm) disabled, the first require fails with `ERR_REQUIRE_ESM`; this flag demonstrates the compatibility boundary but is not a separate Node version test.

## E4 — G13c: probe noise

### Setup

Used the E1 consumer and its successful run. The separate-stream captures are `local/e4-compare.stdout`, `local/e4-compare.stderr`, `local/e4-gallery.stdout`, and `local/e4-gallery.stderr`.

### Commands

| Command (from `local/exp-g8/`) | Exit |
|---|---:|
| `node ../../dist/cli.js compare nonexistent-a nonexistent-b --config shots.config.ts` | 1 |
| `timeout 5s node ../../dist/cli.js gallery --config shots.config.ts` | 124 (timeout after serving) |
| `node ../../dist/cli.js compare nonexistent-a nonexistent-b --config shots.config.ts > ../e4-compare.stdout 2> ../e4-compare.stderr; echo "compare_exit=$?"` | 0; printed `compare_exit=1` |
| `timeout 3s node ../../dist/cli.js gallery --config shots.config.ts > ../e4-gallery.stdout 2> ../e4-gallery.stderr; echo "gallery_exit=$?"` | 0; printed `gallery_exit=124` |
| `cat ../e4-compare.stdout` | 0 |
| `cat ../e4-compare.stderr` | 0 |
| `cat ../e4-gallery.stdout` | 0 |
| `cat ../e4-gallery.stderr` | 0 |
| `wc -c ../e4-compare.stdout ../e4-compare.stderr ../e4-gallery.stdout ../e4-gallery.stderr` | 0 |
| `sed -n '1,20p' ../e4-compare.stdout` | 0 |
| `sed -n '1,20p' ../e4-compare.stderr` | 0 |
| `sed -n '1,20p' ../e4-gallery.stdout` | 0 |
| `sed -n '1,20p' ../e4-gallery.stderr` | 0 |

### Observations

Compare stdout, from Playwright's probe:

```text
Listing tests:
Total: 0 tests in 0 files
```

Compare stderr, from shotwright:

```text
shotwright gallery: run "nonexistent-a" is missing or unreadable: local/exp-g8/shots-output/nonexistent-a
```

Gallery stdout contained the same two probe lines, then shotwright's own lines:

```text
shotwright gallery: selected run 2026-10-22T18-27-49_902f via latest (last fully passed run)
shotwright gallery: serving 2026-10-22T18-27-49_902f
Local: http://127.0.0.1:34583/
Use --lan for phone access.
```

The captured gallery stderr was empty. The gallery process was stopped by `timeout` after it had begun serving; its exit 124 is from that stop, not a startup failure.

### Answer

Both `compare` and `gallery` print Playwright's two `--list` lines to stdout before shotwright's own output. The missing-run diagnostic is on stderr; the gallery's selection and server messages are on stdout.

## E5 — G13f: default `shot()` capture extent

### Setup

Added `shots/tall.shots.ts`: a 3000 px high div, then `shot(page, 'full')`, `page.screenshot({ path: 'local-viewport.png' })`, and `page.screenshot({ path: 'local-full.png', fullPage: true })` in that order. Used `--grep 'tall page'` to avoid the intentional failing spec.

### Commands

| Command (from `local/exp-g8/`) | Exit |
|---|---:|
| Fixture write command shown verbatim immediately below (worktree root) | 0 |
| `node ../../dist/cli.js run --config shots.config.ts -- --grep 'tall page'` | 0 |
| `wc -c shots-output/2026-10-22T18-27-49_902f/shots/tall.shots.ts/full.png local-full.png local-viewport.png` | 0 |
| `cmp -s shots-output/2026-10-22T18-27-49_902f/shots/tall.shots.ts/full.png local-full.png; echo "full_cmp_exit=$?"` | 0; cmp 0 |
| `cmp -s shots-output/2026-10-22T18-27-49_902f/shots/tall.shots.ts/full.png local-viewport.png; echo "viewport_cmp_exit=$?"` | 0; cmp 1 |
| `file shots-output/2026-10-22T18-27-49_902f/shots/tall.shots.ts/full.png local-full.png local-viewport.png` | 0 |

Fixture write command (worktree root; exit 0):

```sh
cat > local/exp-g8/shots/tall.shots.ts <<'EOF'
import { test } from '@playwright/test';
import { shot } from '../../../dist/capture.js';
test('tall page', async ({ page }) => {
  await page.goto('data:text/html,<div style="height:3000px">tall</div>');
  await shot(page, 'full');
  await page.screenshot({ path: 'local-viewport.png' });
  await page.screenshot({ path: 'local-full.png', fullPage: true });
});
EOF
```

### Observations

Run: `shot full`; `1 passed (846ms)`; run directory `shots-output/2026-10-22T18-27-49_902f`. `wc -c` reported 65,325 bytes for both shotwright's `full.png` and `local-full.png`, and 21,420 bytes for `local-viewport.png`. `full_cmp_exit=0`; `viewport_cmp_exit=1`. `file` reported 2880 × 6032 PNGs for shotwright and explicit full-page captures, versus 2880 × 1920 for the viewport capture.

### Answer

For this tall page, default `shot()` produced a full-page PNG byte-identical to Playwright's explicit `fullPage: true` screenshot and different from the viewport screenshot.
