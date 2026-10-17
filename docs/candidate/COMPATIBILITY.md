# Standard-router compatibility: demonstrated blocker

Status: **release blocked; required design decision, not a successful compatibility fix**. Observed 2026-10-15. No original sealed contract changed. The scope expressly permits publishing a counterexample and continuing independent work when the requested accounting cannot be enforced through the observed interface.

## Sources and deployed encoding

The current [IMD Explorer](https://explorer.imd.fun/token/0x20978223b637fec0c6276ab0184cf7011dd1d483?chain=11155111) bundle uses Sepolia Universal Router `0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b`, Quoter `0x61b3f2011a92d183c7dbadbda940a7555ccf9227`, empty `hookData`, command `0x10`, and actions `0x060c0f`. The captured bundle, source URL, SHA-256 and encoding excerpts are in [network/03vi_jvgsxpe2.evidence.json](network/03vi_jvgsxpe2.evidence.json).

The PoolManager is `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`; Permit2 is `0x000000000022D473030F116dDEE9F6B43aC78BA3`. Exact runtime bytes and block metadata were read from the public Sepolia RPC at block **11918468**. The fork tests assert the hash of all four runtimes against those bytes before exercising them. Router and Quoter explorer-verified source records are retained; their reported deployed bytecode matches the captured runtime. A separate current-code query on 2026-10-15, with observed head 11920088, found all four runtimes identical to the recorded block; see [current-code-check.json](network/current-code-check.json). These are public chain artifacts, not local service data.

Consulted official interfaces: [Uniswap deployments](https://developers.uniswap.org/docs/protocols/v4/deployments), [Universal Router commands](https://developers.uniswap.org/docs/protocols/universal-router/concepts/commands), [Universal Router source](https://github.com/Uniswap/universal-router), [v4 periphery source](https://github.com/Uniswap/v4-periphery). Pinned source HEAD records are in `../provenance/`; source excerpts are in `interfaces/`. Current upstream `IV4Router` has an additional `minHopPriceX36` field. The observed deployed Sepolia router and Explorer use the older five-field exact-input-single tuple. Tests use the deployed encoding, not an assumed latest ABI.

## Recipient counterexample

Both executions start from the same snapshot, pool, wallet balances, approvals, price and liquidity. Alice calls the actual Universal Router with the same native value. `SWAP_EXACT_IN_SINGLE` parameters, including empty hookData, are identical.

| Execution | Command | Actions | Subsequent delivery |
| --- | --- | --- | --- |
| A | `0x10` | `0x06 0x0c 0x0f` | `TAKE_ALL(token, minimum)` delivers to Alice |
| B | `0x10` | `0x06 0x0c 0x0e` | `TAKE(token, Bob, 0)` delivers all output to Bob |

The hook sees the same `sender` (Universal Router), pool key, swap parameters, hookData, `msgSender()` (Alice), and executed balance delta. Before- and after-callback observation hashes match. The final token balances differ. At the recorded fork both deliver `987402494003717132` diagnostic token units, to different wallets. No UNLK production address or dummy launch is used to assert this interface fact.

`testCounterexampleTakeAllVersusTakeBobIdenticalHookObservations` demonstrates it in both the offline recorded-runtime suite and historical fork. It uses a diagnostic observer to isolate what the interface exposes; it does not pretend the candidate accepts Universal Router trades.

## Actual source counterexample

Both runs begin with the same balances, including one token unit prefunded to the router by Bob and one owned by Alice. Alice has a Permit2 allowance in both. The same sell action and logical `msgSender()` run first. Later settlement differs:

- `SETTLE_ALL` (`0x0c`) spends Alice's tokens using Permit2 and leaves Bob's router prefunding untouched.
- `SETTLE` (`0x0b`, `payerIsUser=false`) spends the router balance funded by Bob and leaves Alice's tokens untouched.

The hook observations match, including post-swap deltas, because settlement occurs after the callbacks. Balance snapshots taken by the hook do not solve this example: initial balances and all state transitions up to the callback are identical. ERC-20 allowance is permission to transfer, not proof of which allowance was actually used.

Additional tests show smart-wallet callers can direct TAKE to Bob; batches can aggregate multiple buy outputs into one delivery; multihop can consume the entire official-pool token output in another pool without delivering it to any wallet. A smart wallet is the transaction principal when it calls a direct route; `tx.origin` is never an accounting identity.

## Why this blocks the requested E/S accounting

Requested E includes authenticated official buys **delivered to the beneficiary**, not every buy initiated by a logical executor. Requested sales consume rights of the actual source. In each pair above, the desired ledger update differs while all observations available during the hook callbacks are identical. A deterministic hook cannot choose two different updates from the same observations. Hooks cannot inspect their caller's outer calldata, read future TAKE/SETTLE actions, or install an end-of-unlock callback in this deployed router. No `tx.origin`, self-reported address, Permit2 approval, hookData hint or `msgSender()` shortcut fixes that information gap.

The invariant cannot be met by unmodified standard routes with empty hookData while preserving unrestricted ERC-20 transfers and the sealed token. This is an interface limitation, not permission to silently redefine E/S.

## Decision required before a release can be specified

The requester must approve a way to authenticate actual sourcing and final delivery atomically, including intermediate multihop flows, **and** determine which compatibility constraint may change. Possibilities require separate design/review: an official router/settlement extension providing verifiable completion evidence; a new token/settlement architecture that can authenticate those movements without turning ordinary transfers into credits; or an explicit change of eligibility semantics. None is selected or authorized by this implementation. Merely whitelisting our companion router fails the stated standard-router requirement.

The candidate uses its inherited authenticated direct-call route only to make independent fee, setup, claims, oracle and quota work executable. It rejects Universal Router swaps (a dedicated negative test asserts this), arbitrary recipients and generic multihop. It accepts smart wallets as direct callers, authenticates literal caller sourcing and exact delivery, and supports bounded sequential single-pool batches. That restriction is a release blocker, clearly disclosed in source and UI.

## Quoter is simulation, not an execution exemption

The candidate recognizes only the observed Quoter address **and** exact runtime hash `0xf481a751ac453d40c46d12360b85b05472028c1b113ab63749d69a5f8b0e47d1`, with empty hookData. This bytecode is not a proxy and its quote path always reverts its unlock callback to communicate the result. Internal quote functions reject external callers and the callback rejects callers other than the manager. Quotes cannot finish a settled unlock, commit pool changes, E, S, observations, milestones, fees or claims. Tests call the real bytecode, check rollback, attack internal/callback entrypoints and replace its code with a forged router to verify the hash gate.

Generic sell quotes can succeed for a wallet whose quota is zero. They are a price simulation only. A wallet-specific sell check must read balance, E, S and p, sync proven credits as appropriate, and simulate the actual supported route. A generic quote is never a promise that a wallet can sell.

For native-specified modes, callers must translate gross buy input to pool input or desired net sell output to gross pool output using `NativeFeeMath`; the standard Quoter is not modified to perform that translation. For native-unspecified modes, the candidate returns a hypothetical fee delta. Quotes accrue no revenue. This is another reason a raw generic quote must not be displayed as a complete candidate transaction promise.

## Reproduction

```sh
forge test --match-path test/compatibility/RecordedRouter.t.sol -vv
forge test --match-path test/candidate/Quoter.t.sol -vv
bash scripts/candidate/fork.sh
```

[Recorded fork results](fork-results.txt) contain six real-router tests and one real-factory candidate setup rehearsal. Offline replay verifies interface behavior using recorded code but does not reproduce all chain storage. The separate fork uses historical chain storage and real service contracts. Both are local simulations, not deployments.
