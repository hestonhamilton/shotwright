# ADR 0018 — The license is AGPL-3.0-or-later, not MIT

- **Status:** accepted (amends ADR 0010, amends ADR 0011)
- **Date:** 2026-09-03
- **Bead:** `shotwright-746.18.8`
- **Phase the decision landed in:** I

## Context

A 2026-09-03 release-readiness assessment found that `package.json` declared
`"license": "MIT"` and the repository carried **no license text at all**. Neither
half was tracked: `bd search LICENSE` returned nothing, and the only record of the
gap was a comment in `scripts/ci/expected-files.txt` noting it as "anticipated".

That is two defects, not one. The npm tarball would have shipped a license *claim*
with no *grant* — a declared license with no text is not a license. And a public
repository with no `LICENSE` reads as all-rights-reserved to anyone who clones it,
which is the opposite of what publishing to a public registry is for.

Fixing the missing file forced the prior question: MIT was never deliberately
chosen. It appears in ADR 0010 as an incidental line in a description of npm
package metadata, not as a weighed decision, and it propagated into `docs/design.md`
from there. ADR 0011 flipped the repo to public without revisiting it.

The owner's actual intent, stated 2026-09-03: the project is not there to be
monetized by people who contribute nothing back. MIT is the near-opposite of that.

## Decision

shotwright is licensed **AGPL-3.0-or-later**. `LICENSE` carries the verbatim FSF
text, retrieved from `https://www.gnu.org/licenses/agpl-3.0.txt` rather than
reproduced from memory, preceded by a sole-copyright notice.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| AGPL-3.0-or-later (chosen) | Section 13 reaches network use, which is where the monetization the owner objects to actually happens | Strongest deterrent to commercial adoption; propagates to consumers | — |
| GPL-3.0-or-later | Familiar; strong copyleft | Obligations trigger only on **distribution**. A company offering a modified shotwright over a network distributes nothing and owes nothing back; AGPL section 13 adds the duty to publish that source | Leaves open the exact case the owner named |
| GPL + output exception | Keeps copyleft on the tool without reaching the artifacts it produces | Adds a bespoke clause to interpret; the propagation-to-consumers concern is unaddressed anyway | Complexity without closing the SaaS gap |
| LGPL-3.0-or-later | Consumers may import without becoming copyleft — the conventional choice for a library | Explicitly weaker than the owner asked for | Does not implement the stated intent |
| MIT (status quo ante) | Maximum adoption | Permits exactly the unreciprocated commercial use the owner objects to | Never deliberately chosen; inherited from a metadata example |

## Consequences

- **Copyleft propagates to consumers, and this is intended.** shotwright is an
  imported library, not a standalone binary. Works that incorporate or modify
  shotwright and are distributed must be licensed under the AGPL; using it as a
  development tool against an application does not by itself change that
  application's license (readers should take their own legal advice). The
  owner was shown this consequence explicitly and accepted it. It is a filter on
  adoption, not an oversight — do not "fix" it later by quietly relaxing the
  license.
- **This constrains the E8 migrations.** The first consumers (consumers A, B and C) are
  same-owner, so they are unaffected in practice. Any *future* consumer that is
  not same-owner inherits the obligation.
- **Section 13 is now a live question for the gallery.** `shotwright gallery --lan`
  binds an HTTP server to `0.0.0.0` so a reviewer on a phone can open it; the FSF's
  own "How to Apply" section names the web-application case directly. Tracked as
  `shotwright-746.18.11` — decided there, not here.
- **Sole copyright is now load-bearing.** The ability to dual-license or sell a
  commercial exception later survives only while the owner holds all copyright.
  One outside PR accepted without a DCO or CLA ends that permanently, which is why
  `shotwright-746.18.10` gates the public flip rather than following it.
- **Layer A of the leak gate widens by one line.** `LICENSE` is added to
  `scripts/ci/expected-files.txt` because npm ships it unconditionally. That diff
  is the security-relevant part of this change and was reviewed as such.

## Reversal

Amends **ADR 0010**, which recorded MIT as part of the npm package metadata, and
which stands unchanged in every other respect. The earlier reasoning did not stop
holding so much as it was never made: MIT was described, not decided, and the
license question was never put to the owner until the missing `LICENSE` file forced
it. Recorded here so the choice is a decision with a date rather than an inherited
default.

Also touches **ADR 0011** (source repository goes public), which assumed the
inherited license. 0011's decision to go public is unaffected; only the terms under
which the public may use what they find have changed.

Relicensing *away* from AGPL later requires the consent of every copyright holder.
While `shotwright-746.18.10` holds, that is the owner alone. After the first
un-signed-off outside contribution, it is not.
