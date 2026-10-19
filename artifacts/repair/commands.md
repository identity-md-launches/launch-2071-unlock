# Reproduction commands

Run from the repository root unless shown otherwise. These commands are read-only with respect to mainnet; no paid job is opened by the checks.

```sh
(cd web && npm ci && npm run typecheck && npm test && npm run build)
node --test services/labs/tests.mjs services/labs/*.test.mjs
node services/labs/doctor.mjs --db /tmp/unlock-labs/labs.sqlite --cycles 3 --output /tmp/unlock-labs/doctor.json
node web/scripts/serve-repair.mjs /tmp/unlock-labs/labs.sqlite 4174 8788
# In a second shell while the temporary REAL preview runs:
IMD_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node web/scripts/check-repair.mjs http://127.0.0.1:4174
IMD_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
node web/scripts/check-export.mjs
python3 scripts/candidate/dependencies.py --check
git diff --check
# Stop the temporary preview with Ctrl+C.
```

On the worker, repository dependency-directory writes were prohibited. Unchanged web manifests/lockfile were copied to a temporary install and npm ci installed the exact versions there. Full TypeScript source/scripts/tests were checked using identical options with external dependency paths; Vite used the repository's unchanged build options with external resolution aliases. Native esbuild compiled all existing web tests against the pinned runtime. The resulting locked build was deterministic across repeated builds; export hashes are recorded in web/evidence/export-manifest.json.

When dependencies live outside web/, set LABS_TEST_ACCOUNTS_MODULE to that install's viem accounts index.js for test-only signing, and UNLK_ESBUILD_MODULE to its esbuild/lib/main.js for the optional pinned-runtime test bundler. IMD_PLAYWRIGHT and PLAYWRIGHT_BROWSERS_PATH can point to external browser tooling. These are tool locations, not credentials. Browser rendering used Chromium; WebKit did not launch due to missing host libraries.

For the original empty-page reproduction, extract the provided base read-only into a temporary directory with git archive, then run the original createStore/createMarketServices with a new SQLite filename and no simulation/config overrides. The actual pre-repair run and exact per-address failures are in baseline.json. No restoration or reset of the production paid-order database is required for this reproduction.

The real service can run without npm and ships Docker/operator setup in docs/backend.md. Production needs the operator's HTTPS API, persistent database and capable archive RPC. Keep apiBase empty until that real endpoint is available. Never publish provider secrets in the static export.
