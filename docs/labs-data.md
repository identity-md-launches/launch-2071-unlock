# Market eligibility and data coverage

This describes operator source, not a hosted API. The committed export keeps `apiBase` empty. Its dated observations are snapshots; they establish no current listing. Actual read-only results, exclusions, recent charts, NFT coverage, wallet flows and provider responses are in [repair validation](../artifacts/repair/validation.md) and `artifacts/repair/doctor.json`.
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

An incomplete archive/provider scan leaves the token excluded. The fresh-database baseline reproduced zero eligible rows: missing seller plans, provider-refused position logs and a missing IMD pool start. The repair discovers sellers automatically, supplies evidenced pool starts, persists reconstruction and explains exclusions; provider access still determines whether current inventory can be verified. PublicNode refused old logs with a personal-token requirement; dRPC returned a free-plan range refusal even for the bounded historical requests. These are recorded provider limitations, not evidence of zero liquidity or a successful listing.
## Prices, caps, ranking and history

Discovery walks the official IMD registry incrementally with a persistent cursor, retaining every valid Ethereum token independently of the 12-asset per-cycle work budget. Extra IDs are retained and fetched with a fair cursor; periodic sweeps revisit older records. Currently supported indexing is static-fee v4 pools with IMD/native ETH quote currencies. Unsupported versions, pools and quotes remain unpublished rather than being misidentified. Source metadata is fetched by verified artifact chain/address; onchain symbol/name never establishes an editorial identity.

Price is the verified pool spot. Exact-PoolId DEX Screener responses can supply reported 1h/24h change and volume. Missing 7d/history stays unavailable. Sparklines use only real timestamped observations. Default sorting uses sourced provider-reported market cap; unknown caps stay last in either direction. DEX Screener `marketCap` is accepted only from the exact verified chain/PoolId/base/quote pair, with source URL, response observation time and the explicit label “Provider-reported.” Circulating supply is not independently verified; absent cap stays unknown. Actual observed supported caps were tested in both sort directions (`artifacts/repair/metrics.json`). FDV is a separately labeled total-supply metric. FDV never substitutes for cap, liquidity or eligibility.

`launchedAt` comes from the verified pool Initialize block; a request's `createdAt` is not launch time. `listedAt` is the first successful Labs admission, persisted separately. Ranking/search/filtering uses only admitted rows. Payment changes neither comparator nor organic ticker inclusion.

## OHLCV, swaps and cost basis

The confirmed-block index stores canonical block timestamps and ordered logs. Re-querying overlap replaces that range; changed checkpoints discard orphaned state. Transfer settlement, plain transfers, swaps and liquidity operations remain separate. Only reconciled transaction senders can be named as traders; pool/router balances do not identify a person. Multiple same-token routing swaps remain unattributed and are not coincident-flow signals.

OHLCV is aggregated from actual signed swap amounts and quote amounts by UTC interval. USD values need a valid historical USD reference at the **event block**, with the canonical block hash in the reference cache key; today's FX is never backfilled into yesterday's trades. Unsupported historical USD conversion leaves a gap while valid quote history can remain available. Intervals without trades have no invented candles. Known log omissions withhold candles; a clipped first interval is excluded. The current candle includes only observations through the stated confirmed block. Crosshair/zoom/pan and a readable values table operate on these records; charts receive no fabricated seed points.

Holder balances are exact onchain `balanceOf` reads over up to 24 observed addresses. Share uses onchain total supply, not guessed circulation. Pool, router, Permit2, factory, burn and unclassified contract addresses are separated from ordinary holder ranks. This is a bounded sample, not a global holder ranking.

P&L uses FIFO over evidenced lots. Full opening inventory is required before numerical realized/unrealized P&L is supported. Coverage is persisted in `radar.index.assetCoverage` by **chain/address/PoolId**, with its own contiguous block range, deployment block and omission flag; the global Radar range never certifies token history. Newly discovered assets and legacy caches without this proof backfill from the authoritative token deployment block, independently of when global indexing began. The token API discloses that asset's range and `completeHistory`. While backfill lags, deployment is unverified, or logs have been omitted, P&L remains partial and numerical totals are null. A pool Initialize override is used only for pool inventory, not token inception.

`completeHistory` proves raw log coverage only. Wallet attribution has a separate versioned `coverage.attribution` proof with `complete`, `swapCount`, `pendingTransactions` and `unresolvedTransactions`, also persisted per asset. Each swap stores its attribution state. Up to 24 transactions per refresh are reconciled, including retained backlog outside the 12-block overlap; queue age/last attempt gives older gaps priority over new traffic. Canonical overlap preserves completed work, and failed/missing transaction or receipt reads stay pending across restarts. Legacy rows without the proof are retried. Unsupported/ambiguous routes stay unresolved. Conservatively, any attribution gap for the token/PoolId withholds all its trader P&L totals until resolved, even if a displayed wallet's recent trades reconcile. Unexplained wallet settlements are unknown inventory despite a swap/liquidity label. Attribution gaps do not remove real candles or mark otherwise complete raw logs as omitted.

Event/timestamp/storage quotas, decode failures and retention removals mark affected asset histories as omitted. Omissions remain fail closed across restarts; after resolving provider/quota/retention constraints, the operator can stop the service and use the documented public-history reindex utility. Seven-day retention cannot support lifetime P&L once earlier trades have been removed. Other pools/chains remain outside the disclosed coverage. Standard direct single-pool router swaps also need actual token **and quote** wallet flows reconciled to the receipt; their net quote amounts include token-level settlement fees. Unsupported routes/unknown quotes have unknown cost basis. Transfers in are never zero-cost purchases; transfers out are never sales. Missing history, unmatched balances, absent prices or unknown acquisition cost produce partial/unavailable P&L. Displayed partial known-lot totals are not total wallet profit. ETH gas is excluded.

## Editorial identities and imagery

Pinned by exact chain/address: UNLK `0x99fa82b022be4575891a43b757bc770691e18fda`, IMD `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7`, and the supplied IMUSD `0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25`. Badges appear only when those addresses pass the common gate. **UNLOCK Pick is editorial, not security certification.**

`editorial-identities.json` records authoritative launch UUIDs, source commits and checked onchain symbols:

| Requested identity | Verified Ethereum address / decision |
| --- | --- |
| ZTO (#737) | `0xd782bdea4ef02a0bd391eb9089470c8080f0a68e` |
| FREE1376 (#775, not launch 1376/SCOOP) | `0x4543e6b511a9a7a75b56607e27997c987ea05878` |
| OG | Ambiguous: #1040 `0xce7eb1ad9e2e1c784ea05f7ea4a0fe625923d10a` is OG; #2160 `0xf58a132967ef5eb52947031c86663df5779ee2c6` is Og Club. Both return OG. No default badge; operator exact-address selection required. |
| EMBEO (#944) | `0x2b82cdeb8477415d541799abb0cc48044c8ea5f3` |
| INFER | Four live mainnet deployments actually return INFER: #1042, #1257, #1282, #1286. All exact addresses/source records are retained; no arbitrary editorial badge is chosen. |
| supplied IMUSD | Exact supplied address returns `imdUSD`; absent from the completed launch registry scan. Its identity/deployment is preserved, but a supported authoritative PoolKey remains unresolved and it stays excluded. |

The three resolved editorial names join UNLK/IMD/IMUSD in the address-bound pick map. Every badge still passes the common listing gate. A symbol match never grants eligibility or project rights.

The official IMD icon was actually fetched from `https://imd.fun/icon.svg` as `image/svg+xml`. Verified official-origin logos now support strict PNG validation and a restricted SVG drawing grammar. SVG scripts, entities, CSS, external references, embedded images, text and foreignObject are rejected. SVG cache responses have no-script sandbox CSP and nosniff; the frontend accepts only exact service cache paths. Invalid/missing logos use a local geometric fallback with backend diagnostics. Unsupported JPEG/WebP or more complex SVG features remain an explicit format limitation. Profile uploads retain the hardened PNG-only sanitizer. No untrusted SVG is injected into HTML.

## Radar coverage and identities

IMD token holders, identity.md NFT holders and attributed public wallets are independent views. NFT replay begins at the evidenced collection deployment **25090085** (archive code absent at block-1, present at block), retains an unlimited ID→owner map, applies ordered mints/transfers/burns and checks canonical checkpoint hashes before resuming. A reorg discards orphaned reconstruction and resumes from the evidenced start. It no longer samples 32 IDs. Work is paged/budgeted; discovered catalog size is never truncated by those budgets.

NFT total supply comes from `totalSupply()` when supported, never from guessed sequential IDs. `ownerOf` and `balanceOf` checks rotate fairly; holders sort by exact holdings. A complete transfer replay reconciles reconstructed inventory to total supply and uses rotating reads to validate it. Until backfill/verification is complete, responses show indexed/total IDs, checked holders, start/current/head blocks, backlog and an explicit partial-ranking label. A separate recent lane cannot certify global coverage. The recorded supplied-provider observation has **10 discovered / 2000 total NFTs**, all 10 checked by ownerOf, while deployment replay has reconstructed **0 IDs** because archive logs are blocked. These separate metrics are explicit; it is not a global whale ranking.

IMD holder/flow reconstruction has its own budget and durable cursor from the code-evidenced deployment at **23501863**. Recent transfers and current balance reads can continue independently of archive backfill. Known pool/router/factory custody is labeled and separated from individual whale results, never assigned to a person. Full rankings require complete reconstruction; a bounded current balance read is labeled as an observed candidate.

Verified Seaport 1.6 address/runtime configuration is supplied from OpenSea documentation and mainnet code. Only a single matching ERC721 listing fulfillment with native consideration and exact parties becomes an evidenced sale. Transfers, unsupported venues, bids, WETH offers and bundles stay transfers. No sale is inferred from token movement alone.

Indexed ERC20 net flows group atomic amounts by verified chain/address, retain token decimals and return `chainId`, `address`, `decimals`, `amountRaw` and the formatted `amount`. Identical symbols remain separate assets and the wallet view links each token address. Legacy events can use exact-address pool metadata or the known IMD/UNLK decimals; missing or conflicting decimals leave the formatted amount unavailable rather than assuming 18. Transfers remain balance movements, not profit.

The publicly labeled vitalik.eth address is supplied with its Etherscan source; attribution does not prove sole control or a complete portfolio. CZ and Asem remain unpublished after research: Binance reserves are customer custody, and no authoritative Asem personal-wallet binding was found. See `public-attributions.json`. No address is guessed. Public personal-wallet labels require reliable reviewed links and evidence in the operator configuration; exchange custody is not a personal portfolio. An empty attributed-wallet view states what remains unpublished. Public holdings are a covered sample of ETH/IMD/NFT balances, not the person's entire wealth.

Coincident-flow detection requires at least two watched wallets, the same asset/direction and a configurable 1-minute to 1-hour window. Transaction/wallet/token duplicates, ambiguous multi-swap routing and transfer settlements are excluded. The timeline links individual amounts and transactions. **Coincidence is not proven coordination.** Signals cover the returned page/history only; missing rows do not prove no activity.

## Limits and pending operation

The scheduler wakes each minute. Independent budgets are 600 market, 600 history, 300 NFT and 300 IMD-whale RPC attempts per cycle (failures count). Registry discovery reads at most 3×100 rows/cycle, then resumes its persistent cursor; 12 tokens is a market-work budget, not a permanent catalog cap. History uses fair per-pool cursors. Liquidity replays up to six 1000-block pages/pool. Ownership replays four 500-block pages/cycle, 16 ownerOf and 12 balance checks. Current history can start with a separate 100-block interval while archive backfill remains incomplete.

Historical USD references are bounded to 24 distinct event blocks/cycle. Seven-day/10000-event and timestamp limits mark omissions; partial history cannot certify cost basis or global activity. Provider fallback uses only the supplied URLs (or explicitly configured operator provider), records attempts/block provenance, counts retries, honors 429 Retry-After and never changes identities to bypass quotas. Profile/auth and HTTP quotas remain separate.

Operators must supply HTTPS API hosting, durable storage and a provider permitting the required historical logs. Reconstruction, representative account selection and verified marketplace decoding are code, not a claim of ongoing operation. Current liquidity/seller gaps, the INFER/OG editorial ambiguities, IMUSD PoolKey, unresolved personal-wallet labels and owner tariff/refund/moderation settings are reported separately. No service was externally deployed; no approval, payment, paid audit job or mainnet write occurred.
