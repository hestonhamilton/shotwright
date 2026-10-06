# ADR 0010 — shotwright is distributed as a public npm package

- **Status:** accepted — **amended by [ADR 0011](0011-source-repository-goes-public.md)**
  on the repository-visibility point. The distribution decision below (public npm,
  unscoped name `shotwright`) stands. The premise that **the source repository
  stays private does not**: the repo goes public once vetted. Every statement
  below that depends on the repo being private — including the accepted 404 on
  the npm page, and the note that "only the package channel goes public" — is
  superseded by 0011.
- **Date:** 2026-08-01
- **Bead:** `shotwright-746.18` (E9 Distribution), which blocks `shotwright-746.8` (E8 Migrations)
- **Phase the decision landed in:** pre-R (owner decision; the decision created E9)

## Context

E8 moves three sibling projects (consumers C, B and A) onto shotwright.
E7 established the root blocker in its own close notes: **there is no way for a
consumer to install shotwright.** Cross-repo CI resolution was proven — a sibling
project successfully called shotwright's reusable workflow — but the run died at
dependency setup, before `pnpm exec shotwright run` could ever be reached. No
consumer has captured a screenshot through the workflow.

The facts that forced the decision:

- `package.json` carries **no `publishConfig` and no `private` flag**. It is
  already shaped like a publishable package: `files: ["dist", "templates"]`,
  `bin`, subpath `exports` for `./capture` and `./reporter`, an MIT `license`,
  and a `repository` field.
- The repo is **private**, so no registry currently serves it.
- The **only** install path proven anywhere is the packed tarball, used by the
  smoke suite (`pnpm add -D <packed tarball>` into a scratch consumer app).
- Every consumer's `package.json` permanently records whichever answer is
  chosen, and consumer CI inherits whatever authentication it implies.
- The name `shotwright` is **unclaimed on npm** (registry returns 404,
  verified 2026-08-01).

## Decision

shotwright is published to the **public npm registry** as `shotwright`. The
source repository stays private. Consumers install with `pnpm add -D shotwright`
and require no registry credentials in local development or in CI.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| Public npm (chosen) | Zero-auth install everywhere; no tokens in any consumer CI; standard semver resolution; name available; package already publishable-shaped | Published artifacts are world-readable; npm page links to a private repo; needs a release process before the first migration | — |
| GitHub Packages, private | Matches ADR 0007's same-owner-private sharing model; artifacts stay unpublished | Every consumer needs an `.npmrc` plus a PAT in local dev **and** CI; that friction lands on all three migrations and back on the reusable workflow | The auth burden is paid three times and on every future consumer, to protect code the repo already treats as headed-public |
| Git dependency + `prepare` build | No registry at all | Still needs SSH/token auth against a private repo; consumers must run the TypeScript build themselves; no version resolution semantics | Combines the auth cost of the private option with worse install ergonomics |
| Stay on packed tarballs | Already proven by the smoke suite; no publishing infrastructure | No version resolution; consumers pin a file path; no real migration story | Defers the decision rather than making it; E8 would inherit the same blocker |

## Consequences

**Makes easy.** Consumer migrations become ordinary dependency additions. The
reusable CI workflow needs no credential plumbing. `shotwright init` can
generate a consumer `package.json` entry that works unmodified. Smoke testing
against a real registry version becomes possible alongside the tarball path.

**Makes hard, accepted as cost.** `dist/` and `templates/` become permanently
world-readable at each published version — an unpublish is not a reliable
retraction. The repo's **headed-public invariant is now load-bearing rather than
stylistic**: any host path, LAN IP, or username that reaches `dist/` or
`templates/` ships to the public registry. The published `repository` URL points
at a private repo, so outside visitors get a 404 from the npm page; that is
accepted, not a defect to fix by making the repo public.

**Future work must not silently undo.** Do not add `private: true` or a scoped
`publishConfig` that redirects to another registry without superseding this ADR
— either would break every consumer already resolving `shotwright` from npm.
The package name `shotwright` is now API.

**Prerequisites this creates, before the first migration:**

1. A release path that publishes `dist` + `templates` (build must run first;
   `files` already scopes the tarball correctly).
2. A pre-publish check that no host paths, LAN IPs, or usernames appear in the
   published tarball — the headed-public invariant enforced mechanically, not by
   review. (See the standing lesson that reviewers demonstrably miss path leaks.)
3. A decision on the first published version. `0.1.0` is unreleased and
   available.

## Reversal

This ADR does not supersede ADR 0007. ADR 0007 governs how the **reusable CI
workflow** is shared (same-owner-private, via GitHub's Actions access policy);
that mechanism is unchanged and remains private. ADR 0010 governs how the
**package** is distributed. The two were conflated in early E8 planning because
both are "how other repos reach shotwright" — they are separate channels with
separate trust models, and only the package channel goes public.
