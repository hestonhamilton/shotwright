import { defineShotsConfig } from '../../../dist/index.js'
export default defineShotsConfig({
  shotsDir: 'shots', outputDir: process.env.CONTRACT_OUTPUT_DIR,
  workers: 2, use: { viewport: {width: 400,height: 300} },
})
