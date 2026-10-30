# shotwright-746.64 — off-GitHub storage for run galleries: research

- **Bead:** `shotwright-746.64` (R phase; research only, no code)
- **Read and observed:** 2026-10-29
- **Related:** `shotwright-746.57` (output sizes), `shotwright-746.62` (upload modes and retention)
- **Decision record:** [ADR 0025](adr/0025-off-github-run-storage-is-an-opt-in-s3-compatible-publish.md) (accepted)

## 1 · Question and constraints

Each private consumer's run artifacts count against the owning account's shared
Actions-artifact and Packages storage. One consumer project's run is about 120 MB, of
which `gallery.html` is about 69 MB (`shotwright-746.57`). The bead asks how mature
projects host CI reports and media off GitHub, and what shotwright should do as
adoption grows.

Constraints from this repository:

- **Review artifacts, not assertions; output is throwaway** (`docs/design.md` §2).
  Any storage must expire. Durable run storage is the precondition ADR 0024
  declined to build review-based baselines on, so it must not appear by accident.
- **Artifacts-only CI by default** (`docs/design.md` §3.5). The reusable workflow
  uploads the current invocation's run directory and gates nothing.
- **Self-contained gallery** (ADR 0005): screenshots are inlined as `data:` URIs.
  The gallery's CSP is `img-src data:` with `media-src 'self'`
  (`src/gallery/render.ts:443`), and compare's CSP has `img-src data:` and no
  media source (`src/gallery/render-compare.ts:202`). Video and trace are
  relative sibling links that need the run folder.
- **Consumers stay thin**, and the reusable workflow's input surface is
  deliberately small. ADR 0007 requires a concrete, reachable scenario for each new
  input.
- **The runtime dependencies are a reviewed allowlist** (ADR 0019 amendment,
  2026-10-22): `pixelmatch` and `pngjs` only. An S3 SDK in the CLI would extend it.

The size arithmetic matters later. Base64 inflates bytes by 4/3, so a 69 MB
gallery carries about 52 MB of PNG. The run directory holds those PNGs again
under `shots/`, so **the uploaded run stores every screenshot twice**
(69 + 52 ≈ 121 MB, matching the measured 116–122 MB).

## 2 · What GitHub gives today

| Property | GitHub artifact (current workflow) | Source |
|---|---|---|
| Included storage, private repos | Free 500 MB, Pro 1 GB, Team 2 GB, Enterprise Cloud 50 GB, shared with Packages, per account | GitHub Actions billing docs |
| Billing | Hourly GB-hour accrual; overage **$0.25 per GB-month**; binary GB | same |
| At the allowance | Community reports say uploads fail with "Artifact storage quota has been hit" for the whole account, and usage recalculates only every 6–12 hours. GitHub's docs do not say how a $0 budget interacts with this. | community discussion #169789 |
| Who can open it | `artifact-url` works only for logged-in users, so the viewer needs a GitHub login and read access to the repository. In a public repo that means any logged-in user. | `actions/upload-artifact` README; GitHub download docs |
| Format | A zip by default. Since 2026-02-26, `upload-artifact@v7` with `archive: false` uploads **one** file unzipped, and GitHub says such files are viewable in the browser, "including on mobile", naming "simple HTML files (without links to CSS or JS)". | GitHub changelog 2026-02-26 |
| Retention | 1–90 days (`retention-days`); the workflow defaults to 7 | upload-artifact README; `.github/workflows/shotwright.yml` |
| Fork PRs | Works without secrets | — |

The `archive: false` row changes the picture. A self-contained `gallery.html` is
exactly the "simple HTML file" GitHub describes, so it could become viewable on a
phone on GitHub itself. **Unverified:** whether GitHub's viewer runs the
gallery's inline script under its CSP, and how it handles a 69 MB file. That is
one experiment for `shotwright-746.62`, because it needs a pushed workflow run.

## 3 · How mature projects host CI reports off GitHub

| Pattern | Example | What it shows |
|---|---|---|
| Object-storage static site keyed by run | Playwright's CI guide, "Publishing report on the web": upload `playwright-report` to an Azure Storage static website under a folder named for the run ID and attempt, then print the URL. It notes this fails for fork PRs, which get no secrets. | This is the canonical pattern. It needs one credential set, a per-run prefix, a link in the summary and a fallback for forks. |
| Split report and attachments | Playwright `attachmentsBaseURL`, "only needed when you upload report and `data` separately to different locations"; `doNotInlineAssets` for strict-CSP hosting | Mature reporters let the heavy media live apart from the page. That is the relative-originals question in `746.57`. |
| Free public links that expire | Lighthouse CI `temporary-public-storage`: reports on GCS, "automatically deleted after a few days", and you must be "OK with your reports being available to anyone on the internet with the link"; `lhci` server for access control or longer retention | This is a precedent for public links that expire, with an explicit warning, and for a self-hosted server when access control matters. |
| Pages-style hosting | Allure-style `gh-pages` publishing; Cloudflare Pages previews | Common for public OSS, but see §3.2. |
| Hosted review services | Argos, Chromatic | Ruled out by ADR 0024: managed baselines and verdicts. Lost Pixel's repository is archived (`archived=true`, last push 2026-04-22, checked through the GitHub API). That confirms the market churn the bead mentions. |

### 3.1 · Object storage (S3 API)

| Provider | Storage | Egress | Free tier | Notes |
|---|---|---|---|---|
| **Cloudflare R2**, confirmed on Cloudflare's page (last updated 2026-10-26) | $0.015/GB-month Standard; $0.01 Infrequent Access | **Free** (S3 API, Workers, r2.dev) | **10 GB-month storage, 1 M Class A, 10 M Class B per month; Standard only** | Class A $4.50/M, Class B $0.36/M; deletes free; IA has a 30-day minimum and a retrieval fee, so it is wrong for throwaway runs |
| Backblaze B2 | **$6.95/TB-month** (≈ $0.007/GB) | Free up to 3× average stored, then $0.01/GB | First 10 GB free | Class A/B/C calls free on pay-as-you-go; no minimum duration. |
| AWS S3 Standard | not rendered on AWS's page during this read; the commonly published us-east-1 figure is $0.023/GB-month (secondary) | first 100 GB/month free, then charged | — | GET $0.0004/1k (AWS page). Supports GitHub OIDC, so it needs no long-lived secret. |

All three support prefix-scoped expiry. R2 lifecycle rules delete objects N days
after upload, scoped to a prefix, "typically … within 24 hours", with up to
1,000 rules per bucket.

Upload tooling: GitHub's Ubuntu 24.04 runner image ships **AWS CLI 2.38.5**
(runner-images README, read 2026-10-29; upstream tag 2.39.2, Apache-2.0,
actively released). Cloudflare documents the AWS CLI against R2 with
`--endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com` and region `auto`,
including `aws s3 presign … --expires-in`. rclone (MIT, v1.75.2 on 2026-10-09)
is the usual portable alternative. `aws4fetch` (MIT, last release 2024-08) is
small but quiet, so it is not a dependency to adopt.

### 3.2 · Pages-style static hosting

- **GitHub Pages:** the site is limited to 1 GB with a soft 100 GB/month bandwidth
  limit, and **private Pages needs GitHub Enterprise Cloud**. On every other plan
  the site is public. A `gh-pages` branch also keeps every deploy in history,
  which goes against throwaway output, and expiry would be hand-written pruning.
- **Cloudflare Pages:** at most 20,000 files and **25 MiB per file**, with 500
  builds a month on Free. Today's 69 MB gallery **does not fit**. A gallery with
  embedded previews (§5) would fit, but every run becomes a deployment, expiry is
  not native, and previews are public unless Access is added.
- Pages-style hosts deploy sites. They are not a lifecycle-managed store for
  throwaway runs, so they lost early.

### 3.3 · Self-hosted S3-compatible stores

| Store | Licence | Latest release (read 2026-10-29) | Signal |
|---|---|---|---|
| MinIO CE | AGPL-3.0 | RELEASE.2025-10-15; repository **archived** (last push 2026-04-24) | Maintenance mode from Dec 2025, binaries stopped, and CVEs reported against the final community release. **Disqualified.** |
| Garage (Deuxfleurs) | AGPL-3.0 | 2.5.0, 2026-10-24 (crates.io) | Active; built for small self-hosted deployments |
| SeaweedFS | Apache-2.0 | 4.51, 2026-10-25 | Active, large project |
| RustFS | Apache-2.0 | 1.0.4, 2026-10-25 | Active; reached 1.0 recently, so it has a short track record |

The owner's forge runner can reach a store on the same host. **GitHub-hosted
runners cannot** without public ingress or a tunnel. Presigned links from a LAN
store open only where the reviewer can reach that host, so a phone off the LAN
cannot open them. Making the store public puts an attack surface on the owner's
own machine. A provider-agnostic S3 design (§6) supports a self-hosted store via
the endpoint input without extra work, so self-hosting is a consumer's
deployment choice, not a package feature.

## 4 · Access control for screenshots of private apps

Screenshots, videos and traces can show anything an authenticated flow displayed
(README "CI"; template comment).

| Mechanism | Who can open | Phone and no-login | Revocation | Setup per consumer | Relative links work |
|---|---|---|---|---|---|
| GitHub artifact (today) | Logged-in users with repository read access | Needs a GitHub login; zip unless `archive: false` | Delete the artifact | None | Inside the zip after extraction |
| **Presigned URL, private bucket** | **Anyone holding the URL**: R2 says to "treat presigned URLs as bearer tokens" | **Yes, it opens directly** | Delete the object or revoke the signing token | Bucket, lifecycle rule, scoped token | **No.** Each object needs its own signature, and relative fetches do not carry it |
| Cloudflare Access on a custom domain | Identity-policy members | Login through the IdP | Change the policy | Zero Trust org (free under 50 users, then $7/user/month), domain on Cloudflare, custom domain on the bucket, r2.dev disabled | Yes, because the cookie authorises same-origin fetches |
| WAF HMAC token (R2 custom domain) | Token holders | Yes | Rotate the HMAC key | Cloudflare **Pro plan or above** | Per-URL token |
| Public bucket or r2.dev | Everyone | Yes | Delete the object | Least | Yes. r2.dev is rate-limited and "intended for non-production traffic" |

Details that matter:

- R2 presigned URLs last **1 second to 7 days**, work only on the S3 endpoint
  (`<ACCOUNT_ID>.r2.cloudflarestorage.com`), not on custom domains, and support
  GET, HEAD, PUT and DELETE. The 7-day ceiling matches the workflow's
  `retention-days` default of 7.
- **Where the link is written decides who sees it.** In a private repo the job
  summary is visible only to repository readers, the same audience as the
  artifact, but the URL can be forwarded. In a **public** repo the summary is
  public, so a presigned link is effectively public until it expires. That matches
  today, since any logged-in user can download a public repo's artifact.
- Access-gated hosting is the only option that is both identity-bound and keeps
  relative links working. It costs a domain and a Zero Trust org per owner. That
  setup is fine to document, but too heavy as the default for a thin consumer.

## 5 · Cost model at 5 and 20 consumers

Steady-state stored GB = consumers × runs per month × (retention days ÷ 30) ×
run size. Two activity levels: **modest**, 40 runs a month (about 2 per working
day), and **busy**, 150 a month. The worst case assumes every consumer is
private. GitHub figures assume the Pro 1 GB allowance and paid overage. R2
figures are Standard storage with the 10 GB free tier. Operations stay negligible
because 150 runs × 20 consumers × about 130 objects is 390 k Class A, below the
1 M free tier, and drops to 2 objects a run if the run directory is uploaded as one
archive.

**Today: 120 MB per run, 7-day retention**

| | Stored | GitHub (Pro) | R2 | B2 |
|---|---|---|---|---|
| 5 consumers, modest | 5.6 GB | ≈ $1.15/mo, **5.6× the allowance** | $0 | $0 |
| 5 consumers, busy | 21 GB | ≈ $5.00/mo | ≈ $0.17/mo | ≈ $0.08/mo |
| 20 consumers, modest | 22.4 GB | ≈ $5.35/mo | ≈ $0.19/mo | ≈ $0.09/mo |
| 20 consumers, busy | 84 GB | ≈ $20.75/mo | ≈ $1.11/mo | ≈ $0.51/mo |

**Reduced: about 20 MB per run, 3-day retention.** This assumes `746.57` embeds
downscaled previews and `746.62` uploads the gallery alone with a shorter
retention. The 20 MB is an assumption to be measured in `746.57`: 52 MB of PNG
at roughly 25 % as WebP previews, base64-inflated, is about 17 MB. If `746.57`
instead keeps originals as relative files, the run is about 55 MB, and the
figures below scale by about 2.75×.

| | Stored | GitHub (Pro) | R2 |
|---|---|---|---|
| 5 consumers, modest | 0.4 GB | $0 (within 1 GB) | $0 |
| 5 consumers, busy | 1.5 GB | ≈ $0.13/mo | $0 |
| 20 consumers, modest | 1.6 GB | ≈ $0.15/mo | $0 |
| 20 consumers, busy | 6 GB | ≈ $1.25/mo | $0 |

Reading the model:

1. **The dollar amounts are small everywhere.** Even the worst cell is about $21 a
   month. Money is not the forcing function.
2. **The real risk is the quota cliff.** Today, 5 modest private consumers
   already need 5.6× the Pro allowance. Without paid overage, uploads stop for
   the *whole account*, including unrelated projects and Packages, and usage
   recalculates only after 6–12 hours.
3. **`746.57` plus `746.62` remove the cliff at 5 consumers and nearly at 20.** The
   biggest lever is not uploading every screenshot twice. Off-GitHub storage buys
   headroom on top, plus the no-login phone link.

## 6 · Fit with the self-contained gallery and the artifacts-only contract

- **A self-contained gallery is what makes presigned access work.** One object
  takes one signature, and the gallery opens on any device without a login. A
  gallery that loads relative images would break under presigned URLs, because
  sibling fetches carry no signature. It would also break in GitHub's
  `archive: false` single-file view and as a copied file. It would need a CSP
  change from `img-src data:` to `'self'`. It would work only with local serve or
  Access-gated hosting.
- **Implication for `746.57`:** reduce size by **embedding downscaled previews**,
  and keep originals available in the run archive and through local serve. Do
  not make relative originals the default. If relative originals ever ship, they
  are a served-mode option only, and ADR 0005's "hybrid/external gallery" escape
  hatch must be taken explicitly. This research supports `746.57`'s option (a)
  and gives a hosting reason for it.
- **Video, trace and compare** are already relative siblings. Under presigned
  hosting they would need their own signed links, so publishing the run directory
  as **one archive object** with its own presigned link is simpler. That is the
  same "download the run" flow the artifact gives today.
- **Artifacts-only still holds.** A bucket is another destination for the same
  throwaway artifacts. The workflow still gates nothing and computes nothing.
  The new obligation is **mandatory expiry**: the bucket must have a lifecycle
  rule, and the docs must say that storage without expiry is outside the
  contract. That keeps this from becoming the durable run storage ADR 0024
  declined.
- `docs/design.md` §3.5 says the workflow "uploads the current invocation's
  directory". If built, it should say "to a GitHub artifact, or to an
  S3-compatible bucket when configured".

## 7 · Consumer surface, if built

The aim is one input plus credentials, with the GitHub artifact as the fallback.

**Reusable workflow** (`.github/workflows/shotwright.yml`):

- Input `storage-url`, for example `s3://bucket/prefix`. Empty, the default,
  keeps today's artifact path unchanged. That is the fallback.
- Secrets `SHOTWRIGHT_STORAGE_ENDPOINT` (optional; the R2 or self-hosted endpoint,
  which names the account ID), `SHOTWRIGHT_STORAGE_ACCESS_KEY_ID` and
  `SHOTWRIGHT_STORAGE_SECRET_ACCESS_KEY`. "A bucket URL plus one secret" is not
  achievable with SigV4 without a non-standard combined secret, because the key
  pair is two values. The honest minimum is **one input plus a key pair**. AWS
  consumers could later use OIDC with no stored secret, but that is not needed
  first.
- Steps when `storage-url` is set: upload `gallery.html` with
  `Content-Type: text/html`; upload a `tar.gz` of the run directory; presign both
  with an expiry of `min(retention-days, 7)` days; write both links to the job
  summary. Use the AWS CLI preinstalled on GitHub-hosted runners. On other runners,
  such as the forge, install a pinned, checksum-verified CLI the same way ADR 0019
  installs OSV-Scanner.
- **Fallback when secrets are missing**, as in fork PRs (which Playwright's guide
  flags) or a misconfiguration: upload the GitHub artifact and write a notice
  rather than failing the run. That keeps artifacts-only true.
- The upload modes from `746.62` (`always | on-failure | never`) apply to both
  destinations. This bead should not add a second mode switch.

**CLI:** no change. Uploading in the workflow keeps the package free of an S3
SDK and of the ADR 0019 allowlist change it would need, and keeps credentials out
of the consumer's Playwright process. `shotwright compare` already accepts a
downloaded run path (ADR 0024).

**Template** (`templates/github/shotwright.yml`): a commented `storage-url` and
secrets-mapping block, plus notes: create a prefix-scoped lifecycle rule; disable
r2.dev; scope the token to object read and write on one bucket; in a public repo,
presigned links in the summary are public until they expire. Add the private-repo
allowance comment that `746.62` already owes.

**README:** a short "Off-GitHub storage" subsection under CI with the R2 recipe as
the worked example. Mention the Cloudflare Access option for teams that need an
identity gate.

## 8 · Options and recommendation

| Option | Verdict |
|---|---|
| **A. Land `746.57` and `746.62` first. Pre-decide an opt-in, provider-agnostic S3-compatible publish in the reusable workflow (R2 documented, private bucket, presigned self-contained gallery plus run archive, artifact fallback), and build it on a measured trigger.** | **Recommended** |
| B. Build the S3 publish now | Lost. At today's 1–3 consumers the cost is cents. `746.57` and `746.62` remove the quota cliff at 5 consumers. Every input is permanent API under ADR 0007. The `archive: false` experiment could make GitHub alone sufficient for phone review. |
| C. GitHub Pages or Cloudflare Pages | Lost. Pages is public unless on Enterprise Cloud, Cloudflare caps files at 25 MiB, there is no native expiry, and every run becomes a deploy in history. |
| D. Self-hosted store (Garage, SeaweedFS, RustFS) as the shotwright answer | Lost as a package feature: upkeep, GitHub-hosted runners cannot reach it, and links do not work off the LAN. Still reachable through A's endpoint secret for an owner who wants it. MinIO is disqualified (archived). |
| E. Cloudflare Access as the default gate | Lost as the default: it needs a domain plus a Zero Trust org per owner. Kept as a documented option. |
| F. Hosted review service (Argos, Chromatic) | Lost under ADR 0024; that market churns (Lost Pixel archived). |
| G. Upload from the CLI with an S3 SDK | Lost. It extends the ADR 0019 runtime allowlist and moves credentials into the test process, with no gain over a workflow step. |

**Triggers for building A** (any one):

1. After `746.57` and `746.62` land, the account's shotwright artifact storage
   stays above **80 % of the included allowance** across a billing month, or any
   consumer hits "Artifact storage quota has been hit".
2. A consumer needs a reviewer **without repository access** to open a gallery.
3. The `746.62` experiment shows GitHub's `archive: false` view cannot render the
   gallery, *and* phone review from CI is requested.
4. Five or more private consumers are active.

If built, file one feature bead under the `shotwright` umbrella (label `ci`) covering the workflow
steps, the template block, the README recipe and a recorded CI run for each
destination.

## 9 · Open items handed on

- **Experiment for `746.62`:** upload `gallery.html` with `archive: false` and
  check on desktop and phone whether GitHub's viewer runs the gallery's inline
  script, how it treats the CSP, and how it handles 69 MB versus about 20 MB.
- **Measurement for `746.57`:** the real per-run size with embedded previews
  replaces this doc's 20 MB assumption.
- Not read in this pass: Netlify and Vercel limits. They are Pages-style hosts and
  would lose for the same reasons as §3.2.

## Prior art and currency

All read 2026-10-29.

- Cloudflare R2 pricing (page last updated 2026-10-26): <https://developers.cloudflare.com/r2/pricing/>
- R2 presigned URLs (last updated 2026-10-26): <https://developers.cloudflare.com/r2/api/s3/presigned-urls/>
- R2 public buckets, r2.dev limits and custom domains (last updated 2026-09-25): <https://developers.cloudflare.com/r2/buckets/public-buckets/>
- R2 object lifecycles (last updated 2026-10-26): <https://developers.cloudflare.com/r2/buckets/object-lifecycles/>
- R2 with the AWS CLI (last updated 2026-10-15): <https://developers.cloudflare.com/r2/examples/aws/aws-cli/>
- Protect an R2 bucket with Cloudflare Access (last updated 2026-05-06): <https://developers.cloudflare.com/r2/tutorials/cloudflare-access/>
- Cloudflare Zero Trust plans (free under 50 users; $7/user/month): <https://www.cloudflare.com/plans/sase-zero-trust.md>
- Cloudflare Pages limits (last updated 2026-09-05): <https://developers.cloudflare.com/pages/platform/limits/>
- GitHub Actions billing: <https://docs.github.com/en/billing/concepts/product-billing/github-actions>
- GitHub non-zipped artifacts changelog (2026-02-26): <https://github.blog/changelog/2026-02-26-github-actions-now-supports-uploading-and-downloading-non-zipped-artifacts/>
- `actions/upload-artifact` README: <https://github.com/actions/upload-artifact>
- GitHub artifact download docs: <https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts>
- Quota-hit reports: <https://github.com/orgs/community/discussions/169789>
- GitHub Pages limits: <https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>; private Pages: <https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site>
- Backblaze B2 pricing: <https://www.backblaze.com/cloud-storage/pricing>
- AWS S3 pricing (tables did not render; storage figure secondary): <https://aws.amazon.com/s3/pricing/>
- Playwright reporters (`attachmentsBaseURL`, `doNotInlineAssets`): <https://playwright.dev/docs/test-reporters>
- Playwright CI, "Publishing report on the web": <https://playwright.dev/docs/ci-intro>
- Lighthouse CI upload targets: <https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md>
- GitHub Ubuntu 24.04 runner image (AWS CLI 2.38.5): <https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md>
- Maintenance signals through the GitHub API: `minio/minio` (archived; last release 2025-10-15), `seaweedfs/seaweedfs` (4.51, 2026-10-25), `rustfs/rustfs` (1.0.4, 2026-10-25), `rclone/rclone` (v1.75.2, 2026-10-09), `mhart/aws4fetch` (v1.0.20, 2024-08-28), `aws/aws-cli` (2.39.2, Apache-2.0), `lost-pixel/lost-pixel` (archived)
- Garage on crates.io (2.5.0, 2026-10-24, AGPL-3.0): <https://crates.io/crates/garage>
- MinIO CE status (secondary): <https://glukhov.org/data-infrastructure/object-storage/minio-dead/>
