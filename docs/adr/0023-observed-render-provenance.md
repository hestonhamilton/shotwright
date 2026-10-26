# ADR 0023 — Observed render provenance

- **Status:** accepted
- **Date:** 2026-10-26
- **Bead:** `shotwright-746.32.8` and `shotwright-746.11`
- **Phase the decision landed in:** P

## Context

The manifest records Playwright's version and shot dimensions, but those do not identify the browser process that rendered a page. The W3 experiment and owner decision in [the plan](../shotwright-746.32-plan.md) establish a Linux Chromium observation path that leaves consumer launch behavior intact.

## Decision

At `shot()` time, observe `page.context().browser()` for browser type and version. For local Chromium on Linux, bind the `SystemInfo.getProcessInfo` browser PID to a live child of the worker before and after streaming the procfs executable image into SHA-256. Managed means the binary that ran is in Playwright's browser cache, regardless of who selected it; store its cache-relative path. A binary outside that cache is overridden; store only its basename. Classify solely from the procfs-resolved executable location, never from launch options. Record the configured project channel, with `launchOptions.channel` taking precedence over `channel`; spec-level `test.use()` overrides are not visible. The channel is configuration, not an observation. Store platform and Linux os-release `ID` and `VERSION_ID` when available. Missing and conflicting observations remain unavailable. These optional v2 fields are advisory; W3b will present them.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| CDP browser PID plus procfs image (chosen) | Observes the running image, including headless shell; no launch change | Linux Chromium only; experimental CDP method; hash cost | — |
| `BrowserType.executablePath()` | Simple public API | Names full Chromium when headless shell ran | Does not identify the image |
| `Browser.getBrowserCommandLine` with `--enable-automation` | Reveals the command line | Changes launch behavior; headed equivalence unverified | Consumer launch ownership is binding |
| `SystemInfo.getInfo.commandLine` | May extend to other platforms | Experimental unparsed string; untestable on current CI | Defer until observed and pinned |

## Consequences

- The digest identifies bytes loaded by one local browser process, not rendering equivalence. Font sets, graphics stack, and page state remain outside it.
- Browser name and version survive when the executable cannot be bound. Older v2 manifests read as `environment: null` and `browsers: []`.
- A Playwright upgrade must rerun the CDP PID, procfs, and launch-argument pins. Failure means executable unavailable, never inferred from a configured path.
- No absolute path, command line, or os-release free text enters sidecars, manifests, compare JSON, or HTML.

## Prior art and currency

Links re-read **2026-10-26**. No reviewed public tool was found hashing the running browser binary. [Cypress.browser](https://docs.cypress.io/api/cypress-api/browser) exposes a browser path; [Playwright Browser](https://playwright.dev/docs/api/class-browser) and [reporters](https://playwright.dev/docs/test-reporters) expose type/version but no executable digest; [Puppeteer Browser.process](https://pptr.dev/api/puppeteer.browser.process) exposes the child process; [Argos screenshot metadata](https://github.com/argos-ci/docs/blob/main/docs/sdks-reference/screenshot-metadata.md) records name/version; [ChromeDriver capabilities](https://developer.chrome.com/docs/chromedriver/capabilities) accept a binary path as input. [CDP SystemInfo](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/) defines the process response, and the [os-release specification](https://www.freedesktop.org/software/systemd/man/latest/os-release.html) defines the distribution fields. The [Chrome tooling flags](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md), [Lighthouse Puppeteer guidance](https://github.com/GoogleChrome/lighthouse/blob/main/docs/puppeteer.md), and [Playwright issue 42379](https://github.com/microsoft/playwright/issues/42379) inform the decision to leave `--enable-automation` untouched. The plan records the local 1.64.1 experiment.

## Reversal

This does not reverse an earlier ADR. A portable executable identity requires a separately tested process binding on each added platform.
