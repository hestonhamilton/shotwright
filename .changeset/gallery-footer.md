---
'shotwright': patch
---

Both gallery pages now end with a one-line footer, `shotwright <version> · <license> · source: <url>`, read from the package's own package.json, so a fork that serves a modified gallery has one obvious place to offer its source (AGPL-3.0 section 13). Nothing is fetched; the URL is a plain link.
