# Market eligibility and data coverage

This document describes this upgrade's source, not a claim that its separate API is deployed. The static site ships no eligible market rows. Historical Radar data is labeled, timestamped and bounded to 60 retained real events from the accepted observation, plus its evidenced wallet sample. These are snapshots, never mocks or a current feed. Connected-API browser fixtures exist only in the validation script and never enter `dist/`.

## One gate for every market placement

`web/src/labs/domain.mjs` is shared by the API and browser. Tables, organic gainers, editorial picks, comparisons and sponsored placements all require:

1. Verified Ethereum chain/address deployment evidence and an exact verified Uniswap pool. A v4 PoolId is a bytes32 identity, never the shared manager address.
2. At least **$20,000 current USD liquidity** and positive active USD liquidity. Evidence must come from complete position inventory/reserves, not FDV, raw v4 units, total supply, shared manager balances or a sum containing duplicate positions.
3. A successful **full Universal Router sell `eth_call`** for a documented existing account, atomic amount and positive minimum output. Real balances, allowances and quota apply. No overrides, spoofed balances or quoter-only success.
4. Both checks within ten minutes, within 64 blocks of the response's confirmed head and within two blocks of each other. The service also refuses stale/future confirmed blocks. Unknown, failed, warming or stale evidence excludes the token.

The frontend repeats this check and expires rows on a timer. Direct token URLs explain every exclusion. Historical observations cannot grant current admission. A sell check is account/size/block/time specific, not a promise that another holder or larger order can sell. UNLK is quota based: acquisition maturity, past sales and transfer-only holdings can change available sell rights. Read the preserved rules and wallet allowance before trading.

## USD liquidity calculation

`services/labs/liquidity.mjs` replays Initialize and ModifyLiquidity from an evidenced start block to the confirmed head. Owner/tick-lower/tick-upper/salt identifies each position. Overlap/log duplication is deduplicated and a changed checkpoint resets the inventory. A missing Initialize, negative reconstructed position, unavailable log range or lagging scan cannot qualify.

For each remaining position, token principal is calculated from its lower/upper sqrt prices, liquidity, current pool sqrt price and token decimals. Each position is counted once. The sum of active positions' raw liquidity must equal `StateView.getLiquidity(PoolId)` **exactly**. Total and active token principal are valued with verified current USD references; fee claims are excluded. The shared PoolManager token balance is never a pool reserve.

USD references use the accepted native ETH/IMD pool and a positive, complete, fresh Chainlink ETH/USD round at the same block. The current and historical paths check pool identity/fee, initialized state, active liquidity and feed freshness. Token spot prices remain manipulable spot information, not a safety or oracle guarantee. IMUSD always uses an observed quote; no $1 peg is assumed.

An incomplete archive/provider scan leaves the token excluded. The live worker check at block **26225624** (2026-10-19 09:10 UTC) could read chain/price state, but the position-log request returned **HTTP 403** and the representative UNLK sell call **reverted**. No qualifying result or successful trade is claimed. The checked account/amount came from the accepted actual sell transaction `0x2e1d6e4b54a11d33f5fa2cd86f657c8ff43cd802b39e040e25ab9d115a8333b9`; the call used current spot less 5% as minimum output and no overrides. No transaction was broadcast. This failed observation is evidence for withholding, not a production configuration entry.

## Prices, caps, ranking and history

Discovery is bounded to recent official IMD launch records and configured additional launch IDs. Currently supported indexing is static-fee v4 pools with IMD/native ETH quote currencies. Unsupported versions, pools and quotes remain unpublished rather than being misidentified. Source metadata is fetched by verified artifact chain/address; onchain symbol/name never establishes an editorial identity.

Price is the verified pool spot. Exact-PoolId DEX Screener responses can supply reported 1h/24h change and volume. Missing 7d/history stays unavailable. Sparklines use only real timestamped observations. Default sorting uses verified market cap; unknown caps stay last in either direction. No circulating-supply evidence is currently available from this provider path, so those caps are explicitly unavailable. FDV is a separately labeled total-supply metric. FDV never substitutes for cap, liquidity or eligibility.

`launchedAt` comes from the verified pool Initialize block; a request's `createdAt` is not launch time. `listedAt` is the first successful Labs admission, persisted separately. Ranking/search/filtering uses only admitted rows. Payment changes neither comparator nor organic ticker inclusion.

## OHLCV, swaps and cost basis

The confirmed-block index stores canonical block timestamps and ordered logs. Re-querying overlap replaces that range; changed checkpoints discard orphaned state. Transfer settlement, plain transfers, swaps and liquidity operations remain separate. Only reconciled transaction senders can be named as traders; pool/router balances do not identify a person. Multiple same-token routing swaps remain unattributed and are not coincident-flow signals.

OHLCV is aggregated from actual signed swap amounts and quote amounts by UTC interval. USD values need a valid historical USD reference at the **event block**; today's FX is never backfilled into yesterday's trades. Unsupported historical USD conversion leaves a gap while valid quote history can remain available. Intervals without trades have no invented candles. Known log omissions withhold candles; a clipped first interval is excluded. The current candle includes only observations through the stated confirmed block. Crosshair/zoom/pan and a readable values table operate on these records; charts receive no fabricated seed points.

Holder balances are exact onchain `balanceOf` reads over up to 24 observed addresses. Share uses onchain total supply, not guessed circulation. Pool, router, Permit2, factory, burn and unclassified contract addresses are separated from ordinary holder ranks. This is a bounded sample, not a global holder ranking.

P&L uses FIFO over evidenced lots. Full opening inventory is required before numerical realized/unrealized P&L is supported. A complete token backfill must reach its deployment, contain no known omissions and catch up to the checked head. Standard direct single-pool router swaps also need actual token **and quote** wallet flows reconciled to the receipt; their net quote amounts include token-level settlement fees. Unsupported routes/unknown quotes have unknown cost basis. Transfers in are never zero-cost purchases; transfers out are never sales. Missing history, unmatched balances, absent prices or unknown acquisition cost produce partial/unavailable P&L. Displayed partial known-lot totals are not total wallet profit. ETH gas is excluded.

## Editorial identities and imagery

Pinned by exact chain/address: UNLK `0x99fa82b022be4575891a43b757bc770691e18fda`, IMD `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7`, and the supplied IMUSD `0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25`. Badges appear only when those addresses pass the common gate. **UNLOCK Pick is editorial, not security certification.**

INFER, ZTO, free1376, OG and EMBEO remain unresolved for editorial publication. Bounded authoritative record inspection did not establish a unique intended project identity for each requested name. In particular, similarly named launch/token records exist; no matching symbol or guessed address is promoted to a badge. `identities.mjs` retains this unresolved set explicitly. Resolve each using an authoritative project/launch record and exact deployed artifact before adding a pinned editorial mapping. Paying for a profile cannot perform that resolution.

Logo sources must belong to the verified record. The service fetches only allowed official IMD HTTPS image origins without redirects, validates/strips PNG data and caches by chain/address. Unsupported, absent or unsafe images use a local geometric fallback. Moderated uploads use the same PNG sanitizer. Remote SVG/JPEG logos are currently not rasterized and fall back; no external image code is injected. Market JSON references cache paths rather than embedding large image payloads.

## Radar coverage and identities

IMD token counterparties, identity.md NFT holders, and publicly attributed personal wallets are separate views. Current balances are not a global whale ranking. NFT ownerOf/balanceOf checks bind collection `0x0000ec93127baa929e58e97dd0095a2bfb38ec1d` and the observed token IDs. NFT scanning is bounded to 1,800 blocks/refresh, 32 sampled IDs and 12 observed holders. Unsupported sale venues, bids and bundles stay transfers. A runtime-pinned single-item Seaport fulfillment plus matching exact NFT Transfer can support a separately labeled sale, including native consideration and buyer/seller evidence.

No Vitalik, CZ or Asem address is guessed or shipped as an attribution. Public personal-wallet labels require reliable reviewed links and evidence in the operator configuration; exchange custody is not a personal portfolio. An empty attributed-wallet view states what remains unpublished. Public holdings are a covered sample of ETH/IMD/NFT balances, not the person's entire wealth.

Coincident-flow detection requires at least two watched wallets, the same asset/direction and a configurable 1-minute to 1-hour window. Transaction/wallet/token duplicates, ambiguous multi-swap routing and transfer settlements are excluded. The timeline links individual amounts and transactions. **Coincidence is not proven coordination.** Signals cover the returned page/history only; missing rows do not prove no activity.

## Limits and pending operation

Market refresh is at most once per five minutes. The scheduler wakes each minute. Defaults: 3 × 100 registry records, 12 market tokens, 600 read-RPC attempts per refresh including retries, 500-block log pages, up to 1,800 activity blocks per refresh, 12 confirmations, seven-day/10,000-event retention, 100-row Radar pages. Position replay advances at most six 1,000-block pages per pool refresh. Historical USD reference reads are capped at 24 distinct event blocks per refresh; gaps remain explicit. Timestamp/event quotas can omit older rows and are recorded as incomplete coverage. Profile/auth HTTP and upstream limits are documented in the service source/setup guide.

Operator API hosting, durable storage, capable archive/log providers, historical backfill, real representative sell plans, missing editorial/public identities, verified NFT venues, owner tariff/refund settings and moderation all await operator setup. No service or bot is deployed by the static export. Real payments and paid audits were not tested on mainnet.
