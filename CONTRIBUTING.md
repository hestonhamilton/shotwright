# Contributing to shotwright

Thanks for looking. Two things are worth knowing before you spend time on a
change, because both are unusual enough that discovering them in review would be
a waste of your effort.

## 1. The license reaches your contribution, and your projects

shotwright is **AGPL-3.0-or-later** ([ADR 0018](docs/adr/0018-license-is-agpl-3-0-or-later.md)).
That is a deliberate choice, not a default nobody looked at.

For a contributor it means the obvious thing: your contribution is licensed under
the same terms. For an *adopter* it means something less obvious, and it is worth
repeating here because people usually meet a project through its code before its
license — works that incorporate or modify shotwright and are distributed must be
licensed under the AGPL, and section 13 additionally reaches modified versions
offered over a network, which plain GPL does not. Using shotwright as a
development tool against your application does not by itself change your
application's license; take your own legal advice.

If that rules shotwright out for you, please open an issue saying so. That is
useful signal. Working around the license is not.

## 2. Sign off your commits (DCO)

Every commit needs a sign-off line, which `git commit -s` adds for you:

```
Signed-off-by: Your Name <your.email@example.com>
```

That line is the [Developer Certificate of Origin](https://developercertificate.org/):
you are asserting you wrote the contribution, or otherwise have the right to
submit it under the project's license.

**Why this is asked for, stated plainly rather than as boilerplate.** The
copyright in shotwright is currently held by one person. That is what makes it
possible to change the license later — to relicense, or to sell a commercial
exception to someone the AGPL would otherwise exclude. The moment a contribution
lands from someone else, they hold copyright in their part, and any future
relicensing needs their agreement too.

A DCO does **not** transfer your copyright and does not give the maintainer the
right to relicense your work. It is the lighter of the two common options, and it
was chosen over a CLA on purpose: a CLA would ask you to assign or broadly license
your rights to the maintainer, and that is a large thing to ask of someone fixing
a typo. The trade-off is accepted knowingly — relicensing gets harder once outside
contributions land, and that is the honest cost of not asking contributors to sign
away more than they should have to.

So: you keep your copyright. You are certifying provenance, nothing more.

Two caveats, so this section is not making a promise the repo does not keep:

- **This is checked by a human at review time, not by a bot.** There is no DCO
  status check on PRs yet (`shotwright-746.18.13`). If your PR is missing
  sign-offs you will be asked for them rather than blocked automatically —
  `git rebase --signoff <base>` fixes a branch after the fact.
- **It applies to contributions from outside the copyright holder.** Existing
  history predates this policy and is not retroactively signed off; the point of
  the DCO is provenance of third-party code, and rewriting published history to
  add trailers would cost more than it proves.

## 3. How the work is organized

- **Issues and tasks live in [beads](https://github.com/gastownhall/beads)**, not
  in GitHub Issues, under the `shotwright` umbrella. Bug reports and questions in
  GitHub Issues are welcome and get triaged into beads.
- **Branches** are `feat/<bead-id>-<kebab-slug>`. A hook enforces it.
- **Commits** are `<bead-id>: <subject>`. Say what was wrong, not what you typed.
- **No AI attribution** on commits or PRs — no co-author trailer naming an
  assistant, no "Generated with" footer. A hook blocks it. Using an AI assistant
  is fine; crediting it as an author is not, because a commit's author is who is
  accountable for it.

## 4. Before you open a PR

```sh
pnpm install
scripts/ci/verify.sh
```

That runs the whole lane: typecheck, lint, unit tests, the tarball leak gate, the
dependency vulnerability gate, and the self-tests that prove those gates can
fail. It is the same script CI runs — the wrappers differ only in setup.

It needs three things installed:

```sh
scripts/ci/install-gitleaks.sh "$HOME/.local/bin"      # pinned version
scripts/ci/install-osv-scanner.sh "$HOME/.local/bin"   # pinned version and checksum
export PATH="$HOME/.local/bin:$PATH"
pnpm exec playwright install --with-deps chromium      # the unit suite is not browser-free
```

Both gates **fail closed**. A missing tool or two unavailable OSV data paths is a
failure, not a skip — a gate that quietly skips its scan reports green on
something it never looked at. The vulnerability gate tries the OSV API first and
then one freshly downloaded database; it never reuses a stale cache.

### Two files reviewed as security-relevant

If your PR touches either, say so in the description and expect the diff to get
more attention than the rest of the change:

- `scripts/ci/expected-files.txt` — the allowlist of what may ship in the npm
  tarball. Adding a line widens it.
- `osv-scanner.toml` — adding an `[[IgnoredVulns]]` record **accepts a known
  vulnerability**. Every exception needs an advisory ID, a reason, and a future
  expiry. Try a `pnpm.overrides` pin first; the two advisories this gate shipped
  with both looked unfixable and were not.

### The house rule that catches people out

**No host paths, LAN IPs, usernames, or personal data in committed files.** This
repository is headed public and an npm tarball is permanent once published. Use
`/home/someone`, `192.168.0.42`, `example.invalid` and similar in tests and docs —
the existing fixtures are the pattern to copy. `local/` is gitignored scratch
space for anything real.

## 5. Deliberately out of scope

Please discuss before opening a PR for these. They are decided, not overlooked:

- **Golden-diff / visual regression gating.** shotwright produces artifacts for a
  human to review. Failing a build on a pixel diff is a different tool's
  philosophy, and the checks in this repo exist to keep it that way.
- **Making CI gate on captures.** The reusable workflow uploads artifacts and
  gates nothing, on purpose.
- **Committing captured output.** Screenshots, videos and traces are throwaway and
  gitignored.
