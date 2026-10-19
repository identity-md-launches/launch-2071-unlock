# Retained runtime and type inventory

Production uses the existing locked Vite/React/TypeScript toolchain: run `npm ci` and `npm run build` in `web/`. Package manifests and lockfiles are unchanged. The standalone backend requires no package install: its pinned viem runtime remains in `runtime/`, with all required local imports and licenses.

`runtime/lock.json` records upstream URLs and SHA-256 before/after the original relative-import rewrites. The React 19.1.1, React DOM 19.1.1, viem 2.37.13, Coinbase SDK 4.3.7 and buffer bundles remain complete. The optional source-preview/test bundler verifies this inventory before building; it needs native esbuild from the locked frontend install or an external `UNLK_ESBUILD_MODULE` path. It never downloads code while bundling.

```sh
node web/scripts/typecheck-offline.mjs
node web/scripts/build-offline.mjs --test
(cd web && node --test ../test/scratch/frontend/*.test.mjs)
```

`build-offline.mjs` without `--test` writes only `test/scratch/offline-export/`, a source preview. The deliverable production export is the normal Vite `dist/`. The native esbuild tool may be installed outside the repository when local dependency directories are forbidden.

The optional 2,324,258-byte compressed **esbuild WASM compiler archive** was removed in the repair to keep the complete submission below 8 MiB. It is not an application/runtime asset or a dependency of the configured production Vite build. The former WASM process also failed on this worker with `RangeError: Invalid array length`; native Vite/esbuild builds and tests passed. Existing package metadata/licenses and the historical esbuild entry in `toolchain.json` are retained as provenance, rather than modifying protected manifests. No npm registry, dependency archive, node_modules or cache is needed by the service.

The TypeScript compiler/archive, standard declarations and upstream licenses remain. `prepare-toolchain.mjs` verifies/restores TypeScript into disposable `test/scratch/toolchain/`; the typecheck needs no network or previous scratch files. `types/lock.json` records original npm URLs/hashes and retained declaration versions. Application and test types are checked with the inherited `skipLibCheck` setting.

`docs/candidate/DEPENDENCIES.json` records hashes of the retained ordinary vendor files and unchanged Solidity libraries. Check it with `python3 scripts/candidate/dependencies.py --check`. Solidity `lib/`, configuration, manifests and lockfiles remain untouched. Runtime legal comments and package licenses remain. There are no submodules.
