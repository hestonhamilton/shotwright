# ADR 0025 — Off-GitHub run storage is a deferred, opt-in S3-compatible publish

- **Status:** accepted
- **Date:** 2026-10-29
- **Bead:** `shotwright-746.64`
- **Phase the decision landed in:** R

## Context

Private-repo artifacts share the account's Actions and Packages allowance: 500 MB
on Free and 1 GB on Pro, with overage at $0.25 per GB-month. Community reports say
uploads stop account-wide when the quota is hit. One sillysnippets run is about
120 MB, and it stores every screenshot twice: inlined in the 69 MB gallery and
again under `shots/`. At 7-day retention, 5 modestly active private consumers
need about 5.6 GB. The owner asked how mature projects host CI reports off
GitHub. Full analysis: [`docs/shotwright-746.64-research.md`](../shotwright-746.64-research.md).

## Decision

Do not build off-GitHub storage yet. Land `shotwright-746.57` (embedded downscaled
previews) and `shotwright-746.62` (upload modes, leaner retention) first; they
remove the quota cliff at 5 consumers. When a trigger below fires, build exactly
this:

1. An optional `storage-url` input on the reusable workflow
   (`s3://bucket/prefix`), with `SHOTWRIGHT_STORAGE_ENDPOINT` (optional),
   `SHOTWRIGHT_STORAGE_ACCESS_KEY_ID` and `SHOTWRIGHT_STORAGE_SECRET_ACCESS_KEY`
   secrets. The design is provider-agnostic; Cloudflare R2 is the documented
   recipe.
2. When set, the workflow uploads `gallery.html` and a single archive of the run
   directory to a **private** bucket. It presigns both for
   `min(retention-days, 7)` days and links them in the job summary. Upload runs
   in the workflow (AWS CLI), never in the CLI.
3. When unset, or when secrets are unavailable (fork PRs), the workflow uploads
   the GitHub artifact as today and gates nothing.
4. Expiry is mandatory. The documented setup includes a prefix-scoped lifecycle
   rule, and storage without one is outside the artifacts-only contract.

Build when any one of these holds: after 746.57 and 746.62 land, shotwright
artifacts stay above 80 % of the included allowance for a billing month, or a
quota-hit error occurs; a reviewer without repository access must open a gallery;
GitHub's `archive: false` single-file view proves unable to render the gallery
and phone review from CI is requested; or five or more private consumers are
active. Then file one feature bead for the workflow, template, README and a
recorded run per destination.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| **A (chosen): defer; pre-decided opt-in S3 publish with presigned self-contained gallery** | Near-zero cost (R2 has free egress and a 10 GB-month free tier); a no-login phone link; GitHub fallback; no new runtime dependency | Presigned links are bearer tokens and public in a public repo's summary; one more credential set per consumer | — |
| B: build it now | Ends quota exposure today | Every input is permanent API (ADR 0007); costs are cents at current scale; size and retention work may suffice | No reachable scenario demands it yet |
| C: GitHub Pages or Cloudflare Pages | Familiar; browsable | Public unless on Enterprise Cloud; Cloudflare caps files at 25 MiB (the gallery is 69 MB); no native expiry; deploy history | Wrong tool for throwaway, private runs |
| D: self-hosted store (Garage, SeaweedFS, RustFS) | No third party | Upkeep; GitHub-hosted runners cannot reach a LAN store; links fail off the LAN; MinIO CE is archived | Reachable through A's endpoint secret; not a package feature |
| E: Cloudflare Access as the default gate | Identity-bound and revocable; relative links work | Needs a domain on Cloudflare and a Zero Trust org per owner | Kept as a documented option, not the default |
| F: hosted review service (Argos, Chromatic) | Full review UI | Managed baselines and verdicts | Declined by ADR 0024 |
| G: upload from the CLI through an S3 SDK | Works from local machines | Extends ADR 0019's runtime allowlist; credentials enter the test process | No gain over a workflow step |

## Consequences

- The self-contained gallery becomes a hosting asset as well as a review choice:
  one object, one signature, viewable anywhere. `746.57` should reduce size with
  embedded previews. A relative-image gallery would break presigned access and
  GitHub's single-file view, and it would require relaxing the `img-src data:`
  CSP.
- Video, trace and compare stay relative siblings, reached through the run
  archive.
- In a public repository, a presigned link in the job summary is public until it
  expires. The template must say so.
- Future work must not add bucket storage without expiry. That would create the
  durable run storage ADR 0024 declined.
- `docs/design.md` §3.5 gains "or to an S3-compatible bucket when configured" only
  when this is built.

## Prior art and currency

Read 2026-10-29.
[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) (page
updated 2026-10-26): $0.015/GB-month Standard, free egress, and a free 10 GB-month,
1 M Class A and 10 M Class B each month, Standard only.
[R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
last 1 second to 7 days, work only on the S3 endpoint, and are "bearer tokens".
[R2 lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
expire by prefix within about 24 hours.
[R2 with Cloudflare Access](https://developers.cloudflare.com/r2/tutorials/cloudflare-access/)
needs a custom domain and a Zero Trust org, which is
[free under 50 users](https://www.cloudflare.com/plans/sase-zero-trust.md).
[Playwright's CI guide](https://playwright.dev/docs/ci-intro) publishes reports
to object storage keyed by run and attempt, and notes that fork PRs lack secrets.
[Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md)
offers public links deleted "after a few days", with a self-hosted server for
access control.
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
gives the allowances and the $0.25/GB-month overage.
[GitHub's 2026-02-26 changelog](https://github.blog/changelog/2026-02-26-github-actions-now-supports-uploading-and-downloading-non-zipped-artifacts/)
adds single-file, in-browser-viewable artifacts.
[Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
set 25 MiB per file, and
[private GitHub Pages](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)
requires Enterprise Cloud.
[B2](https://www.backblaze.com/cloud-storage/pricing) costs $6.95/TB-month.
Maintenance signals, checked through the GitHub API and crates.io:
`minio/minio` is archived with a last release on 2025-10-15. Garage 2.5.0
(AGPL-3.0, 2026-10-24), SeaweedFS 4.51 (Apache-2.0, 2026-10-25) and RustFS 1.0.4
(Apache-2.0, 2026-10-25) are active. AWS CLI 2.38.5 ships on GitHub's Ubuntu
24.04 image (Apache-2.0). `lost-pixel/lost-pixel` is archived.

## Reversal

Supersedes nothing. It extends, and does not amend, ADR 0005 (self-contained
gallery) and ADR 0007's input bar: `storage-url` is pre-justified only by the
triggers above. Revisit this ADR if GitHub changes its artifact allowance or
billing, if R2's free tier or egress terms change, or if `746.57` chooses relative
originals as the default.
