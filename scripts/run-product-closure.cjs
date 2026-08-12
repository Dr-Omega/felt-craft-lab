/**
 * Wrapper for the V4.6 product closure acceptance.
 *
 * Vite bakes VITE_* env vars at build time, so the production renderer must be
 * rebuilt with the acceptance flag before the Electron+CDP test can run. This
 * wrapper:
 *   1. Sets VITE_ACCEPTANCE_UNLOCK_ALL_ASSETS=true in the environment.
 *   2. Runs `npm run build` so the renderer ships with the flag.
 *   3. Runs the actual acceptance script.
 *
 * The historical VITE_ACCEPTANCE_ALL_THEMES_IN_EDITOR flag was removed in
 * the round that formalized "all" as a first-class new-work theme —
 * product code now accepts `all` directly, no acceptance escape hatch.
 *
 * This keeps the acceptance flag out of the user's shell session and out of
 * any committed .env file, while still giving the test what it needs.
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const env = {
  ...process.env,
  VITE_ACCEPTANCE_UNLOCK_ALL_ASSETS: 'true'
}

// Resolve the npm CLI shipped with the current Node.js install. Using the full
// path avoids both PATH-resolution issues on Windows and the
// `child_process.execFileSync` shell-deprecation warning.
const npmCli = path.join(
  path.dirname(process.execPath),
  'node_modules',
  'npm',
  'bin',
  'npm-cli.js'
)

console.log('[product-closure] rebuilding renderer with acceptance flags…')
execFileSync(process.execPath, [npmCli, 'run', 'build'], { stdio: 'inherit', env })

console.log('[product-closure] launching acceptance script…')
execFileSync(process.execPath, ['scripts/run-product-closure-acceptance.cjs'], {
  stdio: 'inherit',
  env
})
