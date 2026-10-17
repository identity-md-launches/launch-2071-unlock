> Current revision (2026-10-16): Current final-source results and remaining release requirements are consolidated in [../unlock-gates/HANDOFF.md](../unlock-gates/HANDOFF.md). Counts, seeds and unsupported reference operations below describe historical deliveries.

> Revision notice (2026-10-16): the historical report below describes the previous mainnet delivery. Current implementation, evidence and limits are in [revision/READINESS.md](revision/READINESS.md). The inactive v3 reader is no longer admitted; buy-credit maturity is now explicit. Historical results are not final-source certification.

# Validation and compatibility

Author checks provide evidence, not independent audit authority. Compiler/build configuration and dependencies are unchanged. All swap/fee test quantities are raw18-decimal IMD/UNLK units unless otherwise stated. The supplied fuzz seed is `0xb992aebca039448ceb6aa325da16f06612255d105e125a5a7451b3928ec69e6e`; offline property fuzzing uses256 runs unless an existing test fixes a larger count. Fork property fuzzing uses32, with the same seed.

| Surface | Result / evidence | Limit |
| --- | --- | --- |
| `forge build` | `final-build.txt` | Pinned Solidity0.8.26/Cancun/optimizer200; compiler warnings retained |
| Full `forge test` with supplied seed | `full-tests.txt`:304 passing tests in66 suites | Final summary in log is authoritative; no external RPC dependency in delivered default test tree |
| Mainnet targeted suite | `mainnet-tests.txt`:36 passing mainnet tests, extracted from the full seeded run | Exact recorded mainnet runtimes with local storage/funding and synthetic oracle market/feed calls; includes delivered narrow independent proof against the accepted initiator implementation |
| Actual mainnet recorded-block rehearsal | `fork-tests.txt`:16 passing tests at block26203203 | Actual factory/registry/fees/IMD/Manager/Router/Quoter/Permit2, local deployer impersonation, local signed Permit2; **activation pricing fixture is synthetic**; additional actual venue rejection test confirms zero liquidity |
| `forge fmt --check` | `fmt-check.txt` | Existing check/config not weakened |
| Mainnet creation commitments, sizes and ABIs | `artifact-check.txt`, `ARTIFACTS.json` | EIP170, full constructor-inclusive EIP3860, <=16 constructor words, no linked libraries; creation code and ABI exported |
| Recorded code/interface/policy verification | `recorded-verification.txt`, `network/` | Runtime digests plus exact source-record/RPC matches for standard services and Sourcify records for token/factory, not independent runtime recompilation or economic safety certification |
| Original creation pins/dependency inventory | `existing-checks.txt` | Both accepted creation-commitment checks and1996 ordinary vendored dependency-file inventory pass |
| Original release-artifact Python tests | `existing-checks.txt` |5 tests pass, including limits and constructor bytes |
| Historical source checksum manifest | `existing-checks.txt` | Four baseline mismatches: `launch.json`, `test/Adversarial.t.sol`, `test/EvidenceAndOracleProperties.t.sol`, `test/FailurePaths.t.sol`; task did not change any of these, confirmed by clean `git diff --exit-code` for those paths. Historical expectations retained |
| Protected admission scripts | `protected-checks.txt` | **Unavailable**: `.imd/reads/protected/univ4_hook/Hook.protected.t.sol` and companions not supplied. Both existing runners attempted unchanged; no stand-in harness or claimed pass |
| Frontend offline typecheck/build | `frontend-typecheck.txt`, `frontend-build.txt` | Existing vendored toolchain; no dependency/config edits or website publication |
| Frontend units | `frontend-tests.txt`:23 pass | Includes IMD route sorting, all4 unsigned swap encodings, zero native value, blocked write gate and fee rounding; old live tests retained |
| Browser/mobile | `browser-check.txt` | **Skipped/unavailable**: existing browser command fails importing absent Playwright before desktop/mobile cases. No screenshot, accessibility or mobile pass claimed |
| Mainnet Foundry lint | `lint.txt` | Warnings retained and evaluated below; no Slither/Mythril result claimed |
| Source upload size | `bundle-size.txt` | Existing8MiB limit; no gate change or dependency removal |
| Separate independent review | `INDEPENDENT_REVIEW.md` | Narrow H-01 review completed and High confirmed; full final mainnet/source-adapter review pending |

## Route matrix

| Route | Candidate support | Evidence |
| --- | --- | --- |
| Ethereum Explorer-shaped exact-input buy/sell, empty hookData | Implemented | Recorded-runtime tests both orderings; actual-block fork |
| Pinned Universal Router exact-output buy/sell | Implemented | Net output and fee-inclusive input limits; unspent ERC20 budgets not pulled; exact Quoter agreement |
| Permit2 allowance and signed permit | Implemented | Real Permit2 runtime, locally signed EIP712 PermitSingle, nonce/replay rejection, atomic permit+swap |
| Quoter zero-state/generic sell quote | Simulation only | No E/S, vault accrual, observation or pool movement persists; no wallet quota authorization implied |
| Two-pool AUX→IMD→UNLK multihop | Implemented/tested locally and at recorded mainnet block | Actual recorded-block Manager/Router/Permit2 and explicitly local auxiliary asset/pool; output belongs to initiator in fixture |
| Batches, explicit output recipient, cycles | Implemented under initiator semantics | Multiple buys credit initiator, recipient alone receives no rights, full same-execution fresh-buy sale fails atomically |
| Transfers and native claims | Preserved | Transfers move no E/S; claims before sync work, payer/reward synchronization deduplicates |
| Range exit, quota violation, bad funding/limits/expiry, wrong code/chain | Atomic rejection | Pool state, fee claims, accrual and rights roll back; no charge on unexecuted volume |
| Shared executor with multiple users | **High/blocking** | Separate reviewer reproduced cross-user quota consumption; aggregate initiator accounting is not user isolation |
| Direct PoolManager unlocker / alternate router runtime | Rejected | Immutable pinned-router policy retained; no arbitrary fallback route |
| Sepolia IMD pairing | Unsupported/rejected | Current capabilities list no Sepolia IMD pairing; new service guard requires chain1 |
| Mainnet live oracle and production deployment | **Blocked** | Discovered v3 source has zero active liquidity; v4 spot is not substituted; final mainnet independent review pending |
| Existing live launch1560 | Preserved | No existing live addresses/rules, token, old contract source or live frontend transaction path changed |
| Mainnet NFT gallery | Read-only | Existing gallery safety/source retained; no marketplace, purchase, listing, burn or wallet write integration added |

## Lint assessment (author only)

Foundry flags narrowing conversions, Solidity zero-initialized local booleans, exact receipt/pool identity equality, signed floor-division corrections, ignored unlock return bytes and external calls before milestone/guard cleanup. Answer casts follow positivity validation; mean-tick casts follow TickMath bounds; delta casts have v4 signed-width and complete-fill bounds; timestamp uint64 horizon is far beyond operational lifetime. Equality is deliberate for exact token receipts, fixed code and immutable pool bindings. Oracle external calls are fixed reviewed companion code, read-only price calls execute under STATICCALL, and the vault uses OpenZeppelin nonReentrant plus callback authorization and effects-before-transfers. Manager unlock return bytes carry no needed receipt; balances and burned claims are checked instead. These explanations do not close H-01 or substitute independent review. No warning is suppressed and no lint configuration is relaxed.

## Precise remaining blockers

1. H-01 shared-executor quota pooling is unresolved High; preserved INITIATOR semantics do not waive it. A separately reviewed design/policy must reconcile shared-user isolation with standard-router compatibility before release.
2. Production IMD/USD pricing lacks usable verified depth and sustained/cross-market manipulation-cost evidence. The actual discovered v3 venue fails; fixture history and a configurable test liquidity minimum are not production safety evidence. Source outage must continue to prevent progress without revoking rights.
3. Final mainnet contracts, source parameters, deployment package and final uploader-assigned commit need full independent review. The follow-up review request did not complete; do not call author checks independent.
4. Actual source-backed activation/postflight and browser/mobile/protected admission must be repeated with their missing evidence/tools/inputs before any separately authorized deployment or hosting. Future launch addresses and keys remain normal later inputs, not coding blockers.

Final NatSpec corrections clarify sorting and staging prerequisites; `source-build.txt` and `artifact-check.txt` confirm the same pinned creation code after those documentation-only source edits. No behavior changed after the304-test run.

A later optional historical WETH/V3-dependency probe was refused by the public RPC with HTTP403, “Archive requests require a personal token.” No further probe was attempted and no new dependency verification was claimed. All16 fork tests completed before this refusal. Future recorded-block reruns require working archive access; see `network/archive-access.json`. No credentials were requested.
