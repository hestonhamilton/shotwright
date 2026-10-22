---
"shotwright": minor
---

Make the reusable CI workflow work with npm, pnpm, or yarn packages in repository subdirectories. Upload the current invocation's run directory after failed captures, with trace recording off by default. `shotwright init` now places workflow and skill files at the containing Git root and prints commands for the selected package manager.
