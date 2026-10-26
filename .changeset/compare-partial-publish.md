---
'shotwright': patch
---

`shotwright compare` no longer leaves a half-published output when it replaces an existing page. Before, if renaming one output file into place failed after another had already been replaced, the new HTML could sit beside a stale `compare.json` (or stale diff PNGs) while the command exited 2. Now each replaced file is backed up first and restored if a later rename fails, so the previous output stays whole. If a restore itself fails, the error names exactly which files hold the new output. The HTML is now published last on both the replacing and the first-write paths. On filesystems without hard links, the backup is a copy. A failure to prune stale diff PNGs after a complete publish is now reported as a diagnostic rather than an error (a file a concurrent run already removed is not reported), so the `wrote` line and the gate verdict (exit 0 or 1) still print.
