# Security review status

**Independent adversarial review: pending. Release: blocked.** The implementation author performed the checks below; this is not an independent audit or production-safety attestation. Any critical/high finding blocks a future release.

## Confirmed blocking findings

**B-01 — high, accounting/compatibility incompatibility.** The deployed Universal Router's callbacks cannot distinguish final recipients or actual funding sources for the required E/S accounting. The two successful counterexample pairs and batch/multihop/smart-wallet cases are executable against recorded runtime and block 11918468. See [COMPATIBILITY.md](COMPATIBILITY.md). Treating logical executor as actual recipient/payer would grant or consume the wrong rights. Candidate behavior is fail-closed; the standard-router requirement remains unimplemented pending an approved architecture.

**B-02 — high, standard native-specified fee settlement incompatibility.** `afterSwapReturnDelta` affects only the unspecified currency. The specified native leg cannot be charged after execution through that return value. The experimental route handles its hook debt explicitly, including partial execution/refunds. Universal Router does not settle this debt. Enabling a before-swap specified delta based on the requested amount would introduce partial-fill/unexecuted-fee risks and was not substituted. A future standard-compatible architecture must resolve both B-01 and this settlement path without charging unexecuted volume.

## Implemented controls and verification

| Area | Control and evidence |
| --- | --- |
| Callback authority | Every hook callback requires the manager; official key, factory initialization, and authenticated route operation/nonce are checked. Direct/replayed callbacks and direct-manager routes reject. |
| Permission/NoOp surface | Flags 0x3fc4 match enabled callbacks; beforeSwapReturnDelta disabled. afterSwap returns only positive floor-rounded native fee when native is unspecified; no arbitrary output mint/delta or caller-selected fee. |
| Actual source/delivery | Experimental direct route pulls only literal msg.sender at its public entry, snapshots pre-existing balances, settles from its own balance, delivers token output exactly to that caller, and credits native output/refund to that caller. Failed postconditions revert hook state. Arbitrary-recipient and generic multihop support is not claimed. |
| Delta conservation | Fresh zero-ETH manager test, all four modes, executed-leg fee checks, partial fill/refund tests, settlement invariant and real factory fork cover claim minting and supplemental settlement. |
| Vault | Immutable hook/manager/beneficiary, backed manager claims, authenticated unlock callback, exact redeemed receipt, fixed self-only withdrawal, separate donations, CEI and reentrancy guards. Recipient rejection does not touch swaps. |
| Quote isolation | Exact deployed Quoter runtime hash and address, empty data, necessarily reverted simulation. Actual bytecode tests show rollback of pool state, credits, sales, oracle observations and revenue; internal/callback bypass and forged-code tests reject. Generic quotes do not authorize a wallet sale. |
| Token/principal | Original supply/transfer behavior unchanged. Factory's official seed cannot shrink; zero-delta fee collection is permitted and returns no hook liquidity delta. Real fork checks principal after fee collection. |
| Setup provenance | Factory/service/registry/token creation, actual allocation receipts, actual position/depth, companion creation hashes and reciprocal bindings are checked. Tampering with any of five companion bodies rolls back staging. Actual stage-1/stage-2 path tested. |
| Credits | Payer allocation and real claims are deduplicated, including pre-activation claims; transfers/donations never move rights. Sequence invariants maintain independent buy/sale ghosts. |
| Unlocking | All sixteen boundaries, initial20%, sequential6h/final24h, valid cadence/gap, invalid data, full permanent bypass, zero-E transferred holder and fee persistence after unlock tested. |
| Frontend metadata | Untrusted inventory is only discovery; ownerOf at a fixed mainnet block authenticates cards. Metadata/image size limits, HTTPS/IPFS policy, aborts, no credentials/redirect following, conservative SVG filtering and img/blob isolation; no HTML insertion. Failure tests use malformed/oversized metadata and authentic tokenURI examples. |
| Build trust | Original source hashes preserved; compiler pinned; dependencies vendored; creation pins, ABIs, runtime/initcode sizes, formatting, types and tests reproducible offline. No filesystem cheatcode or FFI grants. |

## Residual trust and operational risks

- TWAP, seed depth and sequential confirmation do not rule out a sustained funded manipulation. Full unlock is irreversible. No new quantitative manipulation-cost bound was produced for the sixteen-tier ladder; historical old-ladder figures are not applicable guarantees.
- A Chainlink proxy's code hash does not pin its governed underlying aggregator or economic correctness. Freshness/round/sanity checks reject invalid samples but cannot prove honest prices. Oracle observations grow over time; queries use binary search, while keeper gas and storage costs still exist.
- PoolManager protocol-fee governance can halt candidate official swaps by enabling a nonzero protocol fee. The hook intentionally cannot override that policy. Previously earned rights remain recorded.
- Initial allocations and certified reward rounds affect who gains eligibility. Existing distributor/treasury powers can open/fund later rounds. Actual funded claims, not mere membership or balances, grant reward credit. Fee entitlement reassignment does not migrate the original payer allocation rights.
- Ordinary transfers are unrestricted. Other pools/OTC paths bypass this hook's quota and treasury fee. This is explicitly preserved behavior, not universal token transfer enforcement.
- Setup authority can withhold activation and can restage only the exact approved bundle before activation. It has no later configuration powers. New factory/registry policy changes can cause code-pin checks to fail and require a new review, not an emergency bypass.
- Excess ERC-6909 claims donated directly to the vault are visible but stranded by design. Only authenticated fee claims are redeemed. Native donations are separately withdrawable by the fixed beneficiary. The beneficiary key controls withdrawals; there is no recovery/redirect if it is lost or permanently rejects ETH.
- Third-party mainnet RPC/indexer/image availability, indexer lag and chain reorgs affect the gallery. Each card reports its verification block; old data is marked stale. No browser-side hostname rule can prove DNS resolution is public; fetching occurs in the browser under its CORS/network policy, not in a privileged server proxy. No arbitrary URL is fetched by a backend.
- Gallery holdings are not proof of treasury-funded purchases or returns. Sepolia and mainnet are distinct networks. No bridge or purchase executor is present.

## Static-analysis triage

`forge lint src/candidate --severity high med` completed and emitted warnings, retained in [lint-results.txt](lint-results.txt). This is not a clean static-analysis claim. The author reviewed the reported sites without suppressing the rules:

- Reentrancy warnings at vault unlock/burn/take/payment and router unlock: public entry guards set their lock before the external call, effects precede withdrawals, and the intentional manager callback authenticates both manager and an in-progress redemption. The trusted pinned manager has no arbitrary callback during claim burn; its native take reaches only the vault's restricted receive behavior. Failed nested redemption, beneficiary reentry and recipient rejection are tested. Hook oracle checkpoint calls target the exact pinned oracle, which has no callback into the hook.
- Strict balance equality warnings: exact source/delivery and actual redeemed receipt are intentional invariants for the fixed plain UNLK token and native currency. A fee-on-transfer token or malicious replacement must revert; supporting one is not intended. Pre-existing donations are accounted before the comparison. No untrusted callback can force a donation in the middle of the vault's exact manager receipt.
- Default initialization warnings: the verifier's local booleans intentionally start false; fdv is assigned by the successful try branch and the catch branch returns before use. The unused manager unlock return is intentionally empty callback data, not a payment result; actual receipt is separately verified.
- Cast warnings: token/native deltas are sign-checked int128 values before widening; their absolute value fits uint256 and 75bps fits positive int128. Liquidity is range-checked before narrowing. Quota time values use uint64 seconds (well beyond the supported chain horizon). The review tightened exact-output request bounds, including fee-grossed ETH, before signed conversion; an explicit extreme-value failure test checks this. Address/permission and constructor constants are bounded. Remaining warnings require the independent reviewer to confirm these proofs against exact final artifacts.

## Pending validation and release gates

The supplied Owners protected test imports absent `OwnerChecks.sol` and `Swapper.sol`. It was not altered or replaced with a fabricated harness, and is reported not run. Candidate local/fork tests independently check owner-only activation, fixed treasury withdrawal, and unblocked factory fee collection. Eleven other supplied unmodified Hook/Token protected checks passed.

No independent reviewer, Slither or Mythril run is claimed. Browser rendering/accessibility/viewport measurements remain pending because the attempted browser command returned `chromium: command not found`; CSS and frontend logic were reviewed and type/unit/build checks passed. Historical operational artifacts are preserved but do not approve this candidate. All deployment, explorer verification, actual wallet transaction simulation and site publication remain future steps.
