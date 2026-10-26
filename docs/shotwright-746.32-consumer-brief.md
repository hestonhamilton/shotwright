# shotwright: open fixes after 0.2.0

Input document for epic `shotwright-746.32` (E11). Second brief from an external consumer.

Consumer: a nested npm Playwright package (@playwright/test 1.64.0, Node 24.14.1). Every item
reproduced on **0.2.0**, 2026-10-26. 0.2.0 closed G1-G12 and most of G13; nothing below blocks adoption.

| # | Fix | Severity |
|---|---|---|
| A3 | Spec identity comes from the file that *called* `walkthrough()`, so table-driven specs break | friction |
| B1 | A shot name repeated in one spec overwrites the first PNG, then fails the run with no manifest | friction (bug) |
| A1 | Binary artifacts are always `changed` (workbook timestamps), so `--fail-on-change` cannot gate them | friction |
| N2 | Gallery cards don't show the full test title, so a table row can't be identified | friction |
| A2 | Pixel threshold fixed at 0.1; `similar` passes the gate | nice-to-have |
| N1 | `artifact()` refuses `a/b` names, and the error calls it a "shot name" | nice-to-have |
| N3 | README doesn't say `-- -g` selects tests (and must be unanchored at the start) | nice-to-have |
| D1 | `runs` and `compare` errors are prefixed `shotwright gallery:` | nice-to-have |
| D2 | Migration guide says the init template pins `@v0.1.1`; it pins `@v0.2.0` | nice-to-have |
| D3 | `engines: node >=20` without a `require` export condition; `require(esm)` needs 20.19+ / 22.12+ | nice-to-have |
| D4 | A bare `playwright test -c shots.config.ts` refuses with a full stack trace | nice-to-have |

## A3. Tests registered from a helper break `shot()` and `artifact()`

```ts
// shots/helpers/table.ts
export function table(rows: string[]) {
  for (const r of rows) walkthrough(r, async ({ page }) => { await page.setContent(`<h1>${r}</h1>`); await shot(page, r); });
}
// shots/t.shots.ts
table(['a', 'b']);
```

`npx shotwright run -- shots/t.shots.ts`

- **Actual:** every test fails with `shotwright: unsupported spec match helpers/table.ts`, and the reporter throws the
  same error in `onEnd`. `test.info().file` is the declaring file, not the loaded spec.
- **Fix:** derive the spec from the loaded file: `test.info().titlePath[0]` in `shot()` and `artifact()`, and the root
  file suite in the reporter.
- **Workaround:** the loop stays in each `.shots.ts`, and the helper runs inside each test.

## B1. A repeated shot name inside one spec fails late

```ts
walkthrough('one', async ({ page }) => { await page.setContent('<h1>x</h1>'); await shot(page, 'dup'); });
walkthrough('two', async ({ page }) => { await page.setContent('<h1>y</h1>'); await shot(page, 'dup'); });
```

- **Actual:** both tests pass, and `shots/a/dup.png` holds the second image. Then `assembleManifest` throws
  `duplicate shot name "dup" in a.shots.ts`: exit 1, no manifest, no gallery, and `runs` shows `incomplete`.
- **Fix:** refuse the repeat inside `shot()`, as `artifact()` already does. Or still publish a manifest and gallery
  that carry the run error.
- **Workaround:** never save under a fixed name from a helper that every test calls.

## A1. `--fail-on-change` can't gate a spec that writes workbooks

Run a spec that writes `.xlsx` artifacts twice, then `npx shotwright compare <a> <b> --fail-on-change`.

- **Actual:** the run shows many identical pairs and several changed workbooks, then exits 1. The workbooks differ in
  embedded creation metadata.
- **Fix:** an exact, repeatable artifact selector such as `compare --ignore <spec/name>`; selected pairs stay visible
  with their measured state and the gate summary says how many were ignored.
- **Workaround:** a shell sheet-XML diff, or writing a second, normalised `text/xml` artifact.

## N2. Gallery cards can't identify a table row

- **Actual:** a card shows the shot name, spec, test status and `checked`, but no test title.
- **Fix:** show and search the full test title, including its `describe` path, on each card.
- **Workaround:** shot names carry the row key.

## A2. Fixed pixel threshold

- **Fix:** `compare --threshold <n>`, and `--strict`, under which only `identical` passes.

## N1. Artifact subpaths

- `artifact('sub/x.txt', …)` throws `invalid shot name "sub/x.txt" — it contains a slash`.
- **Fix:** allow relative subpaths, validated like spec paths. At least say "artifact name".

## N3. Selecting tests

- `-- -g '^b$'` finds no tests, while `-- -g 'b$'` works, because Playwright matches the full title path.
- **Fix:** a README line: `--only` selects which shots are written, and `-- -g <title>$` selects which tests run.

## D1-D4. Messages and docs

- **D1:** `compare --last latest` before any passed run prints `shotwright gallery: latest is missing`, and a failing
  probe under `runs` prints `shotwright gallery: config probe failed`. Use each command's own name.
- **D2:** `docs/shotwright-746.28-migration.md` says the template is "currently `@v0.1.1`". Update it to `@v0.2.0`.
- **D3:** narrow `engines` to `^20.19.0 || >=22.12.0`, or add a `require` condition.
- **D4:** replace the config-load stack trace with one line naming `shotwright run`.

## A4. Cross-environment compares give no warning

- **Actual:** runs on different Linux distributions with the same browser revision change text pairs. A form page has
  many changed glyph pixels despite unchanged layout, and different fallback fonts shift table columns. Nothing says
  the environments differed.
- **Fix:** record a render fingerprint in the manifest: platform and release, browser and version, and a hash of the
  font list. compare shows a "different environments" banner, and writes it to compare.json, when A and B differ.
- **Workaround:** a compared pair comes only from the consumer's CI workflow; local runs use Playwright's image plus
  the CI font set.

## Follow-up (2026-10-26)

- **A1/A2 and F1:** The consumer withdrew A1/A2 into a request for review-based
  baselines: approve a run, compare against it by default, record per-pair
  accept/deny decisions, and gate on those decisions. W2 shipped `--ignore`,
  `--threshold`, and `--strict` anyway as refinements of the existing opt-in
  compare gate. F1 is declined in [ADR 0024](adr/0024-review-based-baselines-declined.md).
- **A4:** The render-environment warning was restated and is already planned.
  Recording the distribution ID and version covers the reported cross-system
  case; browser and font provenance remain part of the broader design work.
- **A5:** `shot()` should pass `animations`, `caret`, `mask`, and `style` through
  to Playwright screenshot capture, preserving `page.screenshot()` defaults.
  In particular, `page.screenshot()` already defaults `caret` to `'hide'`.
