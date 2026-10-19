# LABS market data and Radar coverage

Markets and Radar read real public registry/API data and Ethereum state. They do not create trades, transactions, user identities or profit estimates. The delivered static snapshots are recorded observations, **not a hosted or continuously running backend**. Run the service described in the repository README to obtain refreshes and protected APIs; static IPFS hosting cannot run the indexer.

## Sources and identity checks

- Official IMD documentation: <https://imd.fun/docs/>; API schema: <https://api.imd.fun/openapi.json>.
- Launch discovery: `GET https://api.imd.fun/launches?limit=100`, up to three pages using the documented launch-number `before` cursor. Only `status:live`, `chainId:1`, token artifacts with a supported seeded v4 PoolKey enter this initial catalog. The accepted UNLOCK launch is also explicitly retained by its deployment record. This bounded catalog is not the complete launch registry.
- Ethereum RPC default/source: <https://ethereum-rpc.publicnode.com>. A service operator can set `ETHEREUM_RPC_URL` to another permitted Ethereum endpoint. No credential belongs in the static export.
- IMD: `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7`; UNLK: `0x99fa82b022be4575891a43b757bc770691e18fda`. UNLOCK's launch is `0528a007-5ec6-4acd-b9cc-b3ded6fe2929` / number 2071.
- Each launch PoolId is calculated from the registry PoolKey using canonical ABI encoding and keccak256. Token bytecode, decimals, symbol, supply and initialized pool state are read at one confirmed block. Pool state must match the fixed registry LP fee. Missing/failed verification leaves the row unavailable.
- IMD's known native ETH/v4 PoolId is `0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3`. UNLK's official IMD/v4 PoolId is `0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32`. v4 PoolManager is `0x000000000004444c5dc75cb358380d2e3de08a90`.
- [DEX Screener API](https://docs.dexscreener.com/api/reference) `/tokens/v1/ethereum/{addresses}` is queried once per market refresh. A result is accepted only when chain, DEX, full v4 PoolId, base token and quote token match the verified onchain pool. It is not enough to match a symbol. IMD is featured separately from launch rankings.
- Uncovered pools use bounded onchain spot pricing: the v4 sqrt price, the IMD/ETH pool where needed, and Chainlink ETH/USD `0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419` at the same block. Feed decimals, positive complete rounds, timestamp and a 90 minute freshness limit are checked. This is manipulable spot information, not an oracle guarantee.
- Onchain FDV uses observed total supply, never an assumed circulating supply. DEX FDV is identified by its source. Market cap is unavailable because circulating supply is not independently supported. Missing volume, USD liquidity or change is `null`/Unavailable, not zero. Active concentrated liquidity is not mislabeled as total USD liquidity.
- IMUSD is excluded: neither a matching name nor a symbol establishes its identity, and no verified official identity was established for this release. No address or dollar peg is assumed.

## Bounded service behavior

`services/labs/markets.mjs` exports `createMarketServices({store,rpcUrl,fetchImpl})`. The store interface is synchronous `get(key)` / `set(key,value)` JSON persistence, supplied by the service's SQLite store. Returned methods are `markets()`, `radar({period,cursor})` and `refresh()`. The server calls refresh periodically; refresh is single-flight and enforces its own five minute cooldown. Requests read the shared cache rather than reindexing once per browser. Last successful data survives provider failures and is marked stale after ten minutes.

The public JSON includes the actual quotas and errors. Initial bounds are:

| Resource | Bound |
| --- | --- |
| Registry discovery | 3 pages × 100 launches, once per hour |
| Verified market tokens/pools | 12 including featured IMD and retained UNLK |
| Market/index refresh | Once per 300 seconds; concurrent calls share one job |
| RPC | At most 340 actual network attempts per refresh, retries included |
| Provider retry | At most two retries; 250/500 ms backoff; 12 second request timeout |
| DEX Screener | One batch of at most 12 token addresses per refresh |
| Log pagination | 500 blocks per request; at most 1,800 blocks per refresh |
| Finality buffer | 12 Ethereum blocks |
| Attribution | At most 24 swap transaction lookups/receipts per refresh |
| Canonical timestamps | At most 100 block timestamps per refresh |
| New log rows | At most 1,000 per scan; omissions are explicitly disclosed |
| History | At most 7 days and 10,000 rows persisted |
| Watchlist | At most 24 candidate accounts checked; up to 10 accounts returned |
| Event API | 100 rows per page with a bounded numeric cursor |

The free providers can change availability and limits. IMD documents public reads at 120/minute per IP; these refresh bounds stay far below that during normal operation. DEX Screener documents the token endpoint at 300/minute; the service uses one request per five minutes. A shared host or RPC provider can impose stricter limits; no paid service is required or assumed. Refresh failures preserve cached observations, surface errors and respect the next cooldown.

## Radar semantics

The first start scans only the latest 1,800 confirmed blocks. Subsequent refreshes resume a persistent checkpoint, overlap 12 blocks and deduplicate by transaction hash/log index. If the stored confirmed checkpoint hash changes, all retained rows and timestamps are discarded and the latest bounded 1,800-block window is rebuilt; coverage start resets and earlier history is explicitly unavailable. A long outage catches up in bounded chunks rather than triggering a full-chain scan. Coverage exposes start/end block and canonical timestamp, backlog, refresh time and missing-history notes. This is a limited index, not an archive. Requests for `1h`, `24h` and `7d` are clipped to available history; absent events are not proof of inactivity.

For configured PoolIds, Uniswap v4 `Swap` logs yield actual buys/sells using signed caller deltas for the token. `ModifyLiquidity` is a separate liquidity operation. IMD and UNLK `Transfer` logs remain transfer rows, including explicit swap/liquidity settlement annotations when the same transaction contains an indexed operation. Settlement transfers are not counted as additional trades. Volume from a transfer is never presented as DEX trade volume.

PoolManager and known router/factory balances are excluded from watch candidates. Contract custody is outside the initial watchlist; candidate accounts must be EOAs or EIP-7702 delegated EOAs. A swap wallet is shown only if the transaction sender's receipt has a matching positive/negative net transfer of that exact token. Otherwise the executor is left unattributed. This establishes a transaction relationship, not the identity or ultimate beneficial owner of a trader. No wallet is called smart money.

The watchlist selects larger **current IMD balances among observed counterparties**, not the top holders on Ethereum. The declared UNLOCK treasury/NFT inventory wallet `0xfe44fc8f6c32f681a0ce443902a0b08bb5b3c736` is an explicit candidate; zero token inventory is an observed balance and does not assert anything about its NFTs or separate immutable beneficiary authority. Other zero-IMD/zero-UNLK accounts are omitted. Holdings are `balanceOf` at the indexed block, not estimates from transfer deltas. Net flow is signed IMD/UNLK ERC20 transfers within the selected covered period, including settlements; it is not profit or cost basis.

## Charts and snapshots

Charts contain only actual observed USD price points from successful refreshes. A new cache has one point, so no historical curve is invented. Every market row also links to its exact DEX Screener pool chart and Uniswap PoolId page. Unsupported historical provider data remains unavailable.

`web/public/labs/markets.json` and `radar.json` record the release's public observations with `mode:snapshot`, original timestamps, source links and explicit snapshot disclosure. Radar's static export includes the bounded indexed rows, so period filters can work locally. Its data never refreshes by itself. The default UI must retain this distinction until an operator deploys the service and sets its HTTPS URL. Authentication, paid audit submissions, protected watchlists and continually refreshed indexing require that backend.

## Validation performed

Worker-side validation on 2026-10-19:

- Live read-only registry, DEX Screener and Ethereum checks succeeded. The snapshot contains 11 onchain-verified launch tokens plus separately featured IMD. Three launch pools had matching DEX Screener coverage; the others use verified onchain spot fallback with unsupported metrics left unavailable.
- The first successful index scanned 1,800 confirmed blocks (approximately six hours) and retained 325 supported rows: 38 buys, 16 sells and 271 transfers. Twenty swaps were reconciled to transaction-sender token receipts. No liquidity event appeared in this bounded scan; liquidity parsing was separately tested with an ABI encoded fixture. A canonical timestamp quota omitted older rows, recorded in coverage notes. The final snapshot's own timestamps/block range are authoritative if later refreshes differ.
- `node --test services/labs/data.test.mjs`: 11/11 passed. Checks cover exact PoolId identity and malformed keys, missing metrics, Ethereum-only registry selection and IMUSD exclusion, lossless atomic amounts, actual signed v4 buy direction, separate liquidity operations, token-specific receipt reconciliation, warming/unsupported periods, transfer net flow across period boundaries, actual-attempt quotas including retries, persistent overlap idempotency, checkpoint preservation after provider failure, and complete history invalidation/bounded rebuild when a confirmed checkpoint hash changes. These meaningful data tests ship with the services.
- No mainnet funds were spent and no paid audit job was opened by these checks. Provider response correctness is not independently audited; the cache is bounded and incomplete. Full historical catch-up, multi-day retention and a production hosted refresh process were not live-tested in this workspace.
