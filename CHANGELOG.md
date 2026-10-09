# shotwright

## 0.1.1

### Patch Changes

- cc7a73d: Gallery: closing the 1:1 inspection dialog no longer pulls keyboard focus back
  to the Inspect button when focus has already moved elsewhere, for example to
  the search box after pressing `/` straight after Escape.

## 0.1.0

### Patch Changes

- a7df4f1: First release. `shotwright run` captures screenshots, videos and traces from
  `*.shots.ts` walkthroughs; `shotwright gallery` builds a self-contained review
  page and serves it on loopback; `shotwright compare` renders two runs side by
  side; `shotwright init` installs the config, scripts, CI workflow and the
  `shots-harness` agent skill into a consuming project.
