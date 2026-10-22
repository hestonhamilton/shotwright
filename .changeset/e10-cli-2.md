---
'shotwright': minor
---

Add compare and gallery review controls. `shotwright compare --fail-on-change` exits 1 when any shot or artifact pair is not identical or similar; without it, compare still exits 0 after writing the page, and every run now prints the gate verdict with each state's count. `shotwright compare --output <file.html>` places the page anywhere outside the two compared runs, with its `compare.json` and diff PNGs beside it. Two runs with the same directory name now compare under a stem carrying a short digest of each run path instead of being refused. `shotwright gallery --include-traces` serves Playwright traces on a non-loopback bind such as `--lan`, which otherwise withholds them. An unreadable screenshot now gets the same reason in the gallery placeholder and in the compare pair.
