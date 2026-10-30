# shotwright-746.65 — GitHub Releases for published versions (Plan)

## Goal and premise re-check

Add a repeatable **manual, post-publish** GitHub Release step to `docs/release-runbook.md`. The Release body is the published tag's own `CHANGELOG.md` version section; the next published stable version becomes GitHub Latest, while a `next` prerelease cannot move Latest. Backfill `v0.6.0` only. This plan implements the owner's decisions and the research redteam amendments (`docs/shotwright-746.65-research.md:81-87`).

The premise still holds on this branch: the real workflow ends with `npm publish` and has no Release job (`.github/workflows/release.yml:284-303`, `.github/workflows/release.yml:373-384`); the runbook stops its tag procedure before outside verification (`docs/release-runbook.md:413-439`). `CHANGELOG.md` contains a `## 0.6.0` section bounded by `## 0.5.0` (`CHANGELOG.md:3-14`), and the local `v0.6.0` tag peels to the version merge commit (read-only `git rev-parse 'v0.6.0^{}'` on 2026-10-29). Research's dated remote check found an empty Releases list and `/releases/latest` returning 404 (`docs/shotwright-746.65-research.md:14-16`). Recheck remote state immediately before the backfill; if a Release already exists, verify it rather than recreate it.

The current two-job permission boundary must stay intact (`.github/workflows/release.yml:11-24`, `.github/workflows/release.yml:75-84`), as must the protected `v*` tag and template pin (`docs/release-runbook.md:413-437`, `templates/github/shotwright.yml:12-17`, `scripts/sync-template-pin.mjs:28-59`). This is release metadata, not a change to the package, gallery, screenshot capture, or run publication semantics (`docs/design.md:30-38`, `docs/design.md:63-87`). ADR 0012 keeps Changesets for reviewed versions and an explicit npm publish (`docs/adr/0012-release-tooling-changesets-and-gitleaks.md:22-26`); ADR 0010 as amended by 0011 keeps npm as the package channel (`docs/adr/0010-distribution-public-npm-package.md:1-9`, `docs/adr/0011-source-repository-goes-public.md:35-43`). No new ADR or component choice is needed.

## Numbered implementation steps

1. **Document the post-tag procedure in one runbook change.** Extend `docs/release-runbook.md` immediately after the protected-tag and template-pin checklist at lines 413-437 and before §2.5 at line 439. Name the successful *real* Release workflow run ID and version/tag as explicit inputs. Require `gh api` to inspect that run's `conclusion == success`, `event == workflow_dispatch`, workflow path/name, head branch `main`, and successful `Publish to npm` job; compare the npm version and relevant dist-tag with the intended version (`docs/release-runbook.md:390-411`, `.github/workflows/release.yml:59-84`, `.github/workflows/release.yml:284-303`, `.github/workflows/release.yml:373-384`). Obtain the **remote annotated tag's peeled commit**, not just its ref's tag-object SHA, and compare it byte-for-byte with that run's `head_sha`; abort on absent, ambiguous, or mismatched evidence. `--verify-tag` remains an additional existence guard, not the identity proof. **Pin:** a documented shell comparison with an explicit nonzero mismatch path, plus a V-phase deliberate wrong-SHA dry exercise; no `gh release create` may follow that failed check.

2. **Pin changelog extraction and classification in the same runbook section.** Read `CHANGELOG.md` at the verified tag commit, never the operator's current checkout (`CHANGELOG.md:3-14`). Extract exactly one `## <version>` heading and all lines up to, but excluding, the next `## ` heading; preserve internal blank lines and Markdown, normalize only terminal newlines, and fail if the heading is missing, repeated, or has no substantive body. Use a temporary notes file under `$TMPDIR`, with cleanup after success or failure. For stable, first confirm npm's `latest` dist-tag equals the version and use `gh release create <tag> --verify-tag --title <tag> --notes-file <file> --latest`. For `next`, confirm npm's `next` dist-tag equals the prerelease version, record the current npm `latest` stable version, and use `--prerelease --latest=false`; GitHub Latest must still name the stable Release (`docs/release-runbook.md:409-410`, `docs/release-runbook.md:458-465`, `docs/shotwright-746.65-research.md:84-87`). Attach no assets; the workflow's tarball is a temporary run artifact (`docs/release-runbook.md:340-351`) and npm is the package channel (`docs/design.md:30-38`). **Pin:** locally run the documented extractor against `v0.6.0` and compare it with the `CHANGELOG.md:3-13` source block; exercise missing, duplicate, and empty sections with scratch fixtures. The commands must give the same notes independent of the current checkout.

3. **Make creation, retry, and verification unambiguous.** Before create, query the tag-specific Release. If one exists, compare its body and `prerelease` value with the expected notes/classification, and verify Latest through `GET /repos/{owner}/{repo}/releases/latest`; exit successfully only if all expected state matches, otherwise stop for investigation rather than overwrite. If absent, create once with the flags from step 2; then perform those same checks, confirm its `tagName`, and recheck the remote tag's peeled commit. Do not treat `target_commitish` as the tag's commit: the tag ref is authoritative. For stable, Latest must be this tag. For `next`, Latest must remain the recorded stable tag. Use `gh release view <tag> --json body,isPrerelease,tagName` only for fields it actually offers; do **not** request nonexistent `isLatest` (`docs/shotwright-746.65-research.md:85-87`). Document retry after a tag push or a partial CLI failure: rerun checks, then create only if absent. Document that there is no transaction across npm, git, and GitHub; a failed Release step leaves a published package and protected tag requiring this retry (`docs/release-runbook.md:390-422`). **Pin:** V-phase read-only calls compare the API body to the expected notes file and `/releases/latest` tag to the expected stable tag; a second execution of the read-only preflight reports the existing Release without mutating it.

4. **Backfill only `v0.6.0` after the runbook implementation is reviewed and landed.** Use the same procedure with `v0.6.0` and its successful real publish run ID, and confirm npm `latest` is `0.6.0` before passing `--latest` (`CHANGELOG.md:3-14`, `package.json:1-3`, `docs/shotwright-746.65-research.md:14-16`). If the live registry has advanced, do not mark this older tag Latest; stop and record the divergence as an open release-policy decision before any write. Do not create Releases for older tags. **Pin:** V records the publish run ID/head SHA, peeled tag SHA, npm dist-tag, exact body comparison, `prerelease == false`, and Latest API result. The backfill is a remote write performed by the orchestrator/operator under its authorization, not by this Plan phase.

Each step is one reviewable runbook/backfill slice; steps 1-3 can land in one docs PR. No workflow, template, source, test, or other runbook edits are part of this bead (`.github/workflows/release.yml:11-24`, `templates/github/shotwright.yml:12-17`).

## Changeset decision

**No changeset.** The diff changes only the operator procedure and GitHub Release metadata. It adds no package behavior or consumer-facing versioned surface; the current `minor` and `patch` changelog entries describe shipped package behavior (`CHANGELOG.md:3-12`). The `.changeset` configuration generates the changelog and does not commit versions automatically (`.changeset/config.json:3-4`); the Version PR already generates the changelog from package changes, and publishing remains a separate explicit action (`docs/release-runbook.md:255-268`, `docs/adr/0012-release-tooling-changesets-and-gitleaks.md:22-26`). Historical changesets for the 0.6.0 upload mode and init script changes used `minor` and `patch` respectively (read-only `git show 2ddbafd -- '.changeset/*.md'` and `git show fa8c926 -- '.changeset/*.md'`); both describe package behavior visible at `CHANGELOG.md:5-12`. If a changeset is required by a later review rule, the proposed fallback is `patch` with wording: “Document GitHub Release creation for published versions.” That would unnecessarily bump npm for a documentation-only procedure, so it is declined here.

## V-phase checks

- Inspect the runbook diff and assert only `docs/release-runbook.md` changed in I; ensure tag protection, template pin, and workflow permissions are untouched (`docs/release-runbook.md:413-437`, `templates/github/shotwright.yml:12-17`, `.github/workflows/release.yml:107-117`, `.github/workflows/release.yml:297-303`). Run `pnpm run typecheck && pnpm run lint && pnpm run test` per `CLAUDE.md:46-47`; run `pnpm exec prettier --check docs/release-runbook.md` if the standard lint excludes Markdown.
- Execute the local, read-only extraction and guard exercises from steps 1-2. Record command and expected/actual results in `docs/shotwright-746.65-verification.md`, including a wrong-SHA refusal, a missing/duplicate/empty section refusal, and the `v0.6.0` exact notes comparison.
- After the authorized backfill, inspect the GitHub Release page in a browser at desktop and phone widths and compare visible title, notes, prerelease badge, and Latest badge with the API checks. This task changes no gallery or demo UI; the project's UI viewing gate is at `CLAUDE.md:107-108`.
- Verify remotely that only `v0.6.0` was backfilled, its tag still peels to the publish run SHA, its notes equal the tagged changelog block, it has no uploaded assets, and `/releases/latest` returns `v0.6.0` if npm `latest` remains `0.6.0`. For a future `next` release, use a documented dry exercise of flag choice now; execute tag-specific and Latest checks on the first real prerelease.

## Risks and rollback

| Risk | Control and rollback |
|---|---|
| Wrong commit or changelog version | Stop before create unless peeled remote tag SHA equals successful publish-run `head_sha`, npm version/dist-tag matches, and the tagged changelog block is unique and nonempty (steps 1-2). A protected tag must not be moved (`docs/release-runbook.md:413-429`). |
| Partial success or concurrent operators | Recheck tag-specific Release immediately before create; a duplicate-create failure is followed by read-only verification. Never replace a mismatching existing Release automatically. The remote create is not atomic with publish/tag push (steps 1-3). |
| Incorrect Latest/prerelease classification | Pass explicit flags and compare Latest API before/after; do not backfill as Latest if a newer stable is published (steps 2-4). If metadata alone is wrong, correct the Release through a separately reviewed manual action; do not repoint the protected tag (`docs/release-runbook.md:424-429`). |
| Wrong public notes or accidental asset | Exact notes comparison and no positional asset arguments (steps 2-3). If a newly created Release is wrong, stop and have the owner review a targeted edit or deletion; neither changes the npm package, and deletion must not be used to conceal a bad publish (`docs/release-runbook.md:6-9`). |

## Considered and declined

- Workflow automation or a third privileged job: owner chose a manual post-publish step; the current publish job has only `id-token: write` and no checkout (`.github/workflows/release.yml:284-303`).
- Creating a tag implicitly through `gh release create`, moving protected tags, or changing the template pin: these break the existing tag identity/consumer contract (`docs/release-runbook.md:413-437`, `templates/github/shotwright.yml:12-17`).
- Generated release notes or current-branch changelog: neither pins the body to the published version's reviewed Changesets section (`CHANGELOG.md:3-14`, `docs/release-runbook.md:264-268`).
- Attached npm tarball/checksum and older backfills: excluded by the owner decision; npm remains the package distribution channel (`docs/design.md:30-38`, `docs/shotwright-746.65-research.md:64-69`).

## Acceptance mapping

| Acceptance criterion | Steps and evidence |
|---|---|
| Next release has a GitHub Release with notes matching its `CHANGELOG.md` section | Steps 1-3; V exact body comparison and Release page inspection. |
| Creation is documented and repeatable in `docs/release-runbook.md` | Steps 1-3; V local guard exercises and retry preflight. |
| `v0.6.0` has a backfilled Release | Step 4; V remote tag/run, body, classification, Latest, and no-assets checks. |
| Tag protection and template pin unchanged | Steps 1-4; V diff review and remote peeled-tag check. |

## Self-review

| Lens | Result and pin |
|---|---|
| Measured or flagged | Pass. No performance or scale estimate drives this plan; live remote state is explicitly rechecked in step 4. |
| Derived-value semantics | Pass. Notes include one exact version section, with only terminal newlines normalized; missing, duplicate, and empty fail. Stable and `next` have explicit Latest semantics (steps 2-3). |
| Emergent structure | Pass. One Release per published tag, existing older tags remain tag-only, and the Release does not mutate the tag (steps 3-4). |
| Batch/concurrency | Pass with named pin. npm → tag push → Release is a nontransactional sequence; existing Release preflight and read-only retry checks cover interruption and duplicate operators (step 3). |
| Inherited constraints grounded | Pass. The two-job workflow, protected-tag runbook, template pin, and `0.6.0` changelog were checked at the anchors above; SHA equality is pinned in step 1. |

## Open questions

None for implementation. If npm `latest` advances before the `v0.6.0` backfill, recommend stopping the backfill until the owner decides how an older stable Release should be classified; do not silently move GitHub Latest backwards.

## Redteam amendments (2026-10-29)

A plan redteam returned "proceed with changes" and confirmed every `gh` flag and REST field cited. Adopted:

1. **An existing Release counts as complete only if it is right (fix now).** Before declaring success on a retry, require `draft == false`, an empty `assets` array, the intended title, the expected body, and the expected prerelease/Latest state. `GET /releases/tags/{tag}` returns published releases only, so a 404 does not prove that no draft exists: list releases to rule out a draft. Create only on confirmed absence; stop on any API, authorisation or network error.
2. **Check the notes before publishing.** Add a pre-publish checklist item: `CHANGELOG.md` at the commit to be published has a `## <version>` section (especially for `next` prereleases; the `v0.1.0-rc.1` commit had no CHANGELOG). Keep the post-publish check too.
3. **Extraction tests cover the edges.** Exercise a section that ends at EOF (`## 0.1.0` today), a literal prerelease heading such as `## 0.7.0-next.0`, and match the version as literal text so dots are not regex wildcards.
4. **Peel annotated tags fully.** Follow tag objects to a commit and fail on any unexpected object type; `target_commitish` is not proof of identity.
5. **Declined:** phone-width inspection of GitHub's Release page. This bead changes runbook text and Release metadata, not shotwright UI; one visible-page check plus the API comparisons suffice.
