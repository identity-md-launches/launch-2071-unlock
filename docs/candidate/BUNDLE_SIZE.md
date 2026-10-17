# Source upload size repair — 2026-10-15

The contributor check reported an 11,824,098-byte source bundle against an 8,388,608-byte limit. This revision changes frontend tool packaging and its offline entrypoints. It preserves the complete contract/application source, tests, required dependency declarations, runtime assets, licenses, historical `dist/` and rebuilt `dist-candidate/`.

## Changes

- Removed 28 unused frontend-tool files (14,604,129 raw bytes): the duplicate TypeScript API bundle and its API declarations, editor/language-server helpers, translated diagnostics, and esbuild browser/ESM entrypoints. The CLI compiler, every standard library declaration and every application dependency declaration remain available.
- Stored the unchanged esbuild WebAssembly compiler and TypeScript CLI payload with lossless Brotli compression, supported by Node's built-in `node:zlib`. The WebAssembly payload is 2,324,258 compressed bytes instead of 12,216,548 raw bytes; the TypeScript payload is 760,316 instead of 6,211,917. These are the required payloads themselves, not duplicate package archives or replacements for Solidity's pinned compiler.
- Added automatic preparation in `web/scripts/prepare-toolchain.mjs`. It checks compressed SHA-256, decompresses with a length bound, checks original SHA-256 and length, and copies the retained upstream helpers into disposable `test/scratch/toolchain/`. It overwrites compiler bytes each time and works when scratch is absent. Build and typecheck need no downloads, npm install, pre-existing cache or `node_modules`.
- Updated `scripts/candidate/check.sh`, dependency inventory and toolchain documentation. Added `scripts/candidate/bundle-size.py`, which measures a deterministic gzip-level-6 archive of all deliverable source, including both frontend exports. Only protected/task-input paths and reproducible build/cache outputs are excluded. It fails above 8 MiB. Python bytecode caches are now ignored too.

The original/unpacked hashes are in [toolchain.json](../../web/vendor/toolchain.json); package versions, origins and licenses remain in [the vendor inventory](../../web/vendor/README.md). All 1,996 retained vendored files match [DEPENDENCIES.json](DEPENDENCIES.json).

## Verification

The complete local archive estimate is about **7.99 MB (7.62 MiB)**, with over 400 KB margin below 8 MiB. [The recorded measurement](size-repair-bundle.txt) includes the validation reports. This deliberately counts the entire deliverable tree rather than depending on Git changes. The contributor's actual upload check is authoritative; its rerun is not claimed here.

The repaired tools were first run with no prepared compiler directory. TypeScript application/test checking passed. The frontend rebuilt successfully and its 20 unit/failure tests passed. An in-memory corruption check rejected altered compressed compiler bytes before restoration, and an unknown-toolchain check failed as expected; no vendored file was changed for these checks.

`forge build` passed with the unchanged Solidity 0.8.26 configuration (compilation was cached because Solidity sources did not change). The full requested-seed test run passed **242 tests across 52 suites, zero failures or skips**. `forge fmt --check`, both creation-code pin checks, deployable-contract size checks, and export of all eight candidate artifacts passed. A final SHA-256 comparison confirmed **605 original files unchanged**, covering contracts, Solidity dependencies, tests, application source/assets, both frontend exports and compiler/manifest configuration; all 15 sealed-source provenance hashes also match.

Evidence: [build](size-repair-build.txt), [Foundry tests](size-repair-tests.txt), [format](size-repair-fmt.txt), [contract sizes](size-repair-contract-sizes.txt), [frontend build](size-repair-frontend-build.txt), [frontend tests](size-repair-frontend-tests.txt), [preservation](size-repair-preservation.txt).

Reproduce from the repository root:

```sh
bash scripts/candidate/check.sh
```

The recorded checks were run individually using that script's commands. No new RPC fork, browser run, independent audit, GitHub commit, deployment or website publication was performed for this packaging repair. Existing real-router/factory fork evidence is retained. The standard-router accounting/design blocker, unavailable Owners protected-test harness, browser-validation limitations and pending independent review remain exactly as documented in [VALIDATION.md](VALIDATION.md) and [COMPATIBILITY.md](COMPATIBILITY.md). Release remains blocked.
