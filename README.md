# UNLOCK · Ethereum mainnet terminal

This website continues accepted commit `1c9927c137c4e4a3a4f6999ce9636ec29a4b89db`. It preserves the compact terminal, local JetBrains Mono fonts, swap, native claims, wallet review guards and permanent unlock ladder. No contract, economics, dependency manifest or lockfile changed.

The complete static export is **`dist/`**. Source is in `web/src/`; the standalone English whitepaper is in `web/public/whitepaper/` and exports to **`dist/whitepaper/index.html`**. It includes a working **Print / Save as PDF** control and print styles for the same document. Relative assets and the physical whitepaper directory support static hosting at a subpath without a server-side application router.

## Install, preview and rebuild

Use Node 24 and npm with the included, unchanged `web/package-lock.json`:

```sh
cd web
npm ci
npm run typecheck
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/` and `/whitepaper/`. `npm run dev` starts source development. The production build writes root `dist/`; deliver that entire folder. No backend, API secret, paid chart service or wallet relay is required. Public Ethereum RPCs and the public NFT indexer are network dependencies at runtime. The inherited npm package name mentions Sepolia; the application uses Ethereum **chain ID 1**.

For this assignment, installation and build tools were kept outside the repository. A temporary copy of `web/` used the unchanged manifest/lockfile with `npm ci`, then ran the commands above; the complete resulting `dist/` was copied back. Nothing under `node_modules`, npm caches or browser installations belongs in the submission. Existing offline toolchain provenance is retained under `web/vendor/`; no additional dependency archive or registry mirror was added.

## Treasury and custody

`web/src/treasury.ts` defines two separate identities:

| Role | Address |
| --- | --- |
| Treasury balances and NFT inventory | `0xFe44fC8F6C32f681a0ce443902a0b08bB5B3C736` |
| Immutable vault withdrawal beneficiary | `0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9` |

The reader validates the original beneficiary and reads treasury IMD/UNLK balances from the new wallet. NFT discovery, `ownerOf`, `balanceOf` and gallery wallet links use the new wallet, never the connected account. `NFT_BENEFICIARY` remains a compatibility alias for the original beneficiary only; active inventory code uses `TREASURY_WALLET`.

The cash path is **PoolManager claims → `redeem()` into the vault → beneficiary `withdraw()` → separate manual transfer to treasury**. The vault cannot pay the new wallet directly. Redemption does not withdraw funds. Funds can remain in the vault indefinitely. The page exposes no automatic cash movement or NFT purchasing. Holdings alone do not prove fee-funded purchases.

The UI reads accrued, pending, redeemed, withdrawn, claimable, donations, vault balances and external treasury holdings separately. It does not total overlapping accounting categories. All values come from current chain reads; no 50-IMD or zero-redemption assumption is encoded.

A fresh read at block **26,218,144** on 18 October 2026 found trading active, tier 1 / 25%, and `50.187586664686516961` IMD redeemed and still in the vault, with zero fee withdrawals and pending fee claims. The new treasury had zero IMD, UNLK and official NFTs at that block. These are historical validation observations, not live constants. See [`web/evidence/update-live.json`](web/evidence/update-live.json) and [`update-inventory.json`](web/evidence/update-inventory.json).

## Price chart and whitepaper

The **Price chart** tab sits beside the retained unlock ladder. It reads only PoolManager Swap events for official UNLK/IMD PoolId `0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32`. Currency0 is UNLK, currency1 IMD; both have 18 decimals. Price is `(sqrtPriceX96 / 2^96)^2` IMD per UNLK, independently of execution-average amounts.

Line and candlestick views offer 1m/5m/15m/1h intervals, crosshair/UTC tooltips, keyboard inspection, zoom/pan buttons, drag panning and mobile pinch/touch. Observed OHLC and executed UNLK/IMD volume derive from actual logs and canonical block timestamps. Empty buckets have no candles; line segments do not bridge no-trade gaps. Boundary candles are labeled partial, and the axis ends at the latest scanned timestamp. Current pool spot, last recorded trade, freshness and partial block/time coverage are explicit.

The chart scans 2,000 or 10,000 blocks. In-memory caching survives tab changes; refreshes about every 15 seconds rescan a 12-block overlap, deduplicate and check canonical hashes. A deeper reorg invalidates the cached prefix. Provider range caps are split with bounded concurrency. Failures retain the original snapshot, show stale/error state and back off to 120 seconds; retries and range changes cancel awaiting work. A shared HTTP request already in flight may finish after cancellation, but its result cannot update the UI/cache. No persistent or all-time history is implied.

Historical USD conversion is unavailable; today's IMD/USD is never applied to historical candles. Valid current USD price/FDV remains separate. The chart never determines tiers: only the hook's stored onchain state does.

The versioned English whitepaper documents deployed supply/allocation, mature and pending E credits, cumulative S sales, claim/attest/sync, payer accounting, every gate through the permanent global bypass, observation validity, actual directional fee bases/rounding, manual custody and risks. Other pools can bypass official-pool quota/treasury fees; spot manipulation and shared-executor accounting remain disclosed. Agent reviews are not a conventional independent security audit. Reviewed ABIs/source matching do not establish Etherscan source verification.

## Validation

The chart-error revision reproduced finding `55339c60…` against accepted snapshot `5ce9d4a`, fixed the provider-error copy/wrapping and rebuilt `dist/`. Typecheck, all 45 frontend tests and the production build passed. A dedicated production regression checks cold and stale RPC failures, long-address/PoolId wrapping, keyboard retry and recovery at 320/390/1440px. See the dated revision section in [`artifacts/validation.md`](artifacts/validation.md) and [`web/evidence/chart-error-revision.json`](web/evidence/chart-error-revision.json). The evidence below records the earlier accepted update; those broader checks were not all rerun for this scoped revision.

Current results and six-domain design coverage are in [`artifacts/validation.md`](artifacts/validation.md). [`DESIGN.md`](DESIGN.md) describes the implemented system. New evidence uses the **`web/evidence/update-*`** prefix; other records are retained historical evidence from accepted work and are not newly executed checks.

Actual current checks:

- Production TypeScript check, 45 frontend tests and Vite production build passed.
- Compiled/source/runtime evidence comparison passed for token, hook, vault, oracle and claim evidence; the token/hook canonical ABI hashes match the deployment manifest. Fresh RPC verification checked runtime bindings, exact pool/configuration, supply, all 16 deployed thresholds, immutable beneficiary and official NFT identity.
- Production Chromium validation at `/preview/` exercised real read-only mainnet quotes, injected EIP-6963 account discovery/network switching, claim controls/proof rejection, every ladder scenario, chart units/timestamps/controls/touch, incremental refresh, error/retry/empty states, treasury inventory and whitepaper navigation/printing. No RPC write or wallet transaction was sent.
- Mobile-first action visibility and no horizontal overflow were checked at 320, 390, 768, 1000 and 1440px. Automated axe scans found zero violations on the checked terminal, chart and whitepaper states. A matching PDF was generated in disposable scratch for print validation.
- The pinned design probe passed 14/16 checks. Its monospace-prose finding conflicts with the requested JetBrains Mono design; its eyebrow heuristic identifies functional status labels, tabs and ledger fields. The real mobile header overflow it found was fixed and rechecked.

To rerun read-only browser validation, install `playwright` and `@axe-core/playwright` outside the repository, then use their module paths:

```sh
IMD_PLAYWRIGHT=/path/to/playwright/index.mjs \
IMD_AXE_MODULE=/path/to/@axe-core/playwright/dist/index.mjs \
node web/scripts/check-update.mjs
```

The script owns a temporary static server for its bounded run, uses the production export at a subpath and forbids signing/write methods. `web/scripts/verify-update.ts` performs fresh read-only verification; run it with `tsx`. These scripts default to the project's public Ethereum RPC. Optional endpoint arguments support contributor infrastructure; reports name public sources only.

To rerun only the chart-error regression using an external Playwright installation:

```sh
IMD_PLAYWRIGHT=/path/to/playwright/index.mjs \
node web/scripts/check-chart-error.mjs
```

It serves `dist/` under `/preview/` for the bounded run, injects a controlled `eth_getLogs` error on both configured RPC hosts and forwards other reads. Output and screenshots default to disposable `test/scratch/chart-error/`. `--rpc <endpoint>` selects a read-only provider; `--proxy` uses the configured HTTP proxy. `--reproduce` checks the original overflow and is intended for an unfixed export.

```sh
node web/scripts/verify-mainnet-source.mjs
node web/scripts/check-export.mjs
python3 web/scripts/check-bundle.py
```

WebKit could not launch because host runtime libraries are missing. Physical devices, real signing, screen readers and browser-native 200% zoom were not tested. NFT UI checks mock the indexer empty; separately recorded fresh Blockscout and onchain reads establish the actual empty new-wallet inventory. Charts cover a bounded range and public services can fail. No new contract/fork transaction tests are claimed in this website-only revision.

## Existing URL and publication

Retained URL: **https://unlk-b35c.sites.imd.fun/**. HTTPS and the current live page were checked read-only. This update's export is prepared locally; **actual publication has not been completed or independently verified**. The live hostname still reports prior CID `bafybeiazwsqazwv7mjt6lpa5hu53opwld4btx5on3z62fb4rko7ow7ige4`.

No launch-bound existing-site update writer is exposed in the available tools. The installed CLI advertises publication of a contributor's own machine-signed site, which does not establish an authorized update path for this existing launch site. It was not used to create a replacement site or alter a name. The existing assignment delivery service must pin this `dist/` as the next version under **`unlk-b35c.site.identitymd.eth`**, then verify the root, `/whitepaper/`, chart, assets and HTTPS on the same URL. This is a publication limitation, not a request to change recipients or contracts.

Rollback retains the requested baseline commit and the prior CID above. `dist/recovery.html` and native proofs remain included. The workspace's `.git/` is protected; submission/commit creation is handled by the delivery system, not by this worker.
