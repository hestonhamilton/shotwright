---
'shotwright': minor
---

`shotwright compare` exit codes now follow the diff(1) convention: 1 means only "a gated pair remains under `--fail-on-change`", and 2 means any error, both usage errors (invalid or out-of-range `--threshold`, duplicate or unknown flags, wrong number of run selectors, unmatched `--ignore`) and runtime failures (missing config, unknown or unreadable run, both selectors resolving to the same run, an `--output` inside a compared run). Previously argument and runtime errors exited 1, indistinguishable from a gated change. Scripts that treated any non-zero status as "changed" should check for 1 specifically.
