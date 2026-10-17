# Offline frontend dependency inventory

The candidate build uses ordinary repository files and never installs into node_modules. The historical package manifests remain as provenance; `npm install` is not the reproducible path for this assignment.

Run from the root:

```sh
node web/scripts/typecheck-offline.mjs
node web/scripts/build-offline.mjs
node web/scripts/build-offline.mjs --test
(cd web && node --test ../test/scratch/frontend/*.test.mjs)
```

`esbuild-wasm/` contains the Node build portion of the published npm esbuild-wasm 0.25.10 package, its WebAssembly compiler and MIT license. TypeScript 5.9.2 retains its CLI compiler, every standard library declaration and upstream licenses. Unused editor/language-server files, the duplicate TypeScript API bundle, translated diagnostics, and esbuild browser/ESM entrypoints are omitted. No application declaration or runtime dependency was removed.

The exact upstream `esbuild.wasm` and `_tsc.js` payloads are stored as Brotli `.br` files to fit the 8 MiB source upload limit. `toolchain.json` records both compressed and original SHA-256 hashes and original lengths. `scripts/prepare-toolchain.mjs` uses Node's built-in decompressor, verifies both hashes, and restores the unchanged compiler bytes and retained helpers into `test/scratch/toolchain/` on each run. The typecheck/build entrypoints prepare their own tools automatically, including after scratch has been deleted. Nothing is downloaded or installed; no pre-existing scratch file is required. `types/typescript/lib/tsc.js` is upstream provenance and is invoked from the prepared directory through `scripts/typecheck-offline.mjs`.

These are project dependencies; Solidity remains version-pinned in foundry.toml and is supplied by the Foundry runtime. For a dependency refresh, use the exact package URLs/hashes below, reproduce the documented subsets, compress those two payloads with Node `brotliCompressSync` at quality 11, and regenerate `toolchain.json` plus the dependency inventory. Retained helpers and declarations remain byte-for-byte upstream files.

`runtime/lock.json` records exact public origin URLs, raw download SHA-256, local file SHA-256 and entry aliases. React 19.1.1, React DOM 19.1.1, viem 2.37.13 and Coinbase Wallet SDK 4.3.7 bundles were downloaded from esm.sh. Absolute module imports in two bundles were rewritten to local relative files, with both pre/post hashes recorded. The node buffer shim is included locally. Runtime vendor integrity is checked on every build. The output has no runtime CDN module dependency; normal wallet/RPC/indexer requests remain network operations at application runtime.

`types/lock.json` records npm tarball URLs and SHA-256 for the TypeScript/type declarations: TypeScript5.9.2, React19.1.13, React DOM19.1.9, Node24.5.2, viem2.37.13, Coinbase4.3.7, abitype1.1.0 and csstype3.1.3. Only declarations, required TypeScript compiler files, package metadata and licenses were retained where possible. skipLibCheck follows the inherited project configuration; application and test types are checked.

Upstream copyright and bundled legal comments are retained; package licenses remain alongside the packages. Additional runtime license texts are in `licenses/`. `docs/candidate/DEPENDENCIES.json` pins every vendored file and can be checked with `python3 scripts/candidate/dependencies.py --check`. Solidity dependencies under `lib/` were already vendored in the pinned source export, with original source/licenses preserved. The same checker pins their ordinary files as well. There are no git submodules.

The build writes **dist-candidate/** and leaves historical dist/ unchanged. No publication command is included. The build defines the literal production-mode constant only; it does not read host environment variables or secrets.
