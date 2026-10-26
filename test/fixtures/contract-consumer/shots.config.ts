import { defineShotsConfig } from '../../../dist/index.js'
export default defineShotsConfig({
  shotsDir: 'shots', outputDir: process.env.CONTRACT_OUTPUT_DIR,
  workers: 2, use: { viewport: {width: 400,height: 300} },
  projects: process.env.CONTRACT_TWO_PROJECTS === '1' ? [
    { name: 'one', use: { browserName: 'chromium' } },
    { name: 'two', use: { browserName: 'chromium' } },
  ] : undefined,
})
