---
'shotwright': patch
---

Allow comparing two external run paths when the configured output directory is
missing. Without `--output`, write the comparison beside run A in `compare/`.
Refuse to overwrite an existing page there unless its sidecar identifies the
same run pair; use `--output` to choose another file.
