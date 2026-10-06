// shotwright's own shots config — runs the demo specs against the built package
// through its public exports (dist/, not src/), exactly as consumers do.

import { defineShotsConfig } from 'shotwright'

export default defineShotsConfig({
  shotsDir: 'shots',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'vite dev',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI,
  },
})
