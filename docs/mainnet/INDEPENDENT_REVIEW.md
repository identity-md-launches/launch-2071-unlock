> Current revision (2026-10-16): Current separate contributor review of final one-way gates, exact arithmetic and release tooling completed: [../unlock-gates/INDEPENDENT_REVIEW.md](../unlock-gates/INDEPENDENT_REVIEW.md). External audit/final-commit release approval remain pending. The historical H-01 finding below remains High and unwaived.

> Final-change status (2026-10-16): **pending independent review** for the one-block maturity rule, WalletExecutor, StateProof/BlockState, ImdV4UsdSource and their integration. The independent H-01 finding below remains High and blocking. The new author tests and fork measurements are not an independent assessment and do not downgrade it. See [current review scope](revision/READINESS.md).

# Independent adversarial review

Status: **High finding confirmed; release blocked.** Code-only review, 2026-10-16.

This review was performed by a separate review agent, independently of the author implementing the mainnet candidate. It is a supported second assessment, not an external audit, commercial certification, or approval to deploy. Initial scope: `src/successor/UnlkHookV3.sol`, its initiator accounting, accepted successor tests and design/security documentation. The mainnet candidate requires a follow-up assessment against its final source; this initial assessment does not certify it.

## H-01: shared executors make unrelated users' sell quotas fungible

**Severity: High for users of a shared executor. Unresolved; blocking.**

The hook authenticates the exact Universal Router and reads that router's `msgSender()` in `beforeSwap` (`UnlkHookV3.sol`, lines 389–395 at the reviewed baseline). `_account` then credits every buy and charges every sale to that one address (lines 472–482). The router correctly reports its immediate logical caller. If a multi-user executor is that caller, it is the ledger owner for all its users. Neither empty hook data nor runtime pinning distinguishes them.

A concrete execution needs no impersonation of the router, no stolen signatures, no victim token approval to the attacker, no shared token custody between calls, and no compromised executor:

1. Alice funds a standard-router buy through an otherwise correct public executor; router TAKE delivers all UNLK directly to Alice. The executor receives E, Alice receives no E.
2. Bob obtains UNLK independently, for example an ordinary transfer from the initial payer. Bob has E = 0. His direct standard-router sale reverts.
3. Bob uses the same executor, supplying only his own UNLK and directing the quote proceeds to himself. The hook charges the executor's S against E created by Alice's buy. Bob's sale succeeds and consumes Alice-associated shared capacity.
4. Alice still owns all her tokens, yet the shared executor now has less remaining capacity for her sale. A permissionless executor can expose this capacity to any user who brings tokens. A marketplace for pooled quota can do so deliberately.

The successful proof uses the recorded Sepolia Universal Router, Quoter, Permit2 and PoolManager runtimes already vendored by the baseline fixture and a local factory launch. It is **not** a mainnet fork rehearsal. `test/scratch/IndependentSharedExecutor.t.sol` defines a segregated-funds executor and asserts all of the above, including Bob's direct failure, Bob's quote proceeds, unchanged Alice holdings, zero residual executor token balance, and consumption of only the executor's S. Scratch is excluded from the deliverable by the assignment; this document records the proof and result.

Command run with solc 0.8.26 and the required fuzz seed:

```sh
FOUNDRY_FUZZ_SEED=0xb992aebca039448ceb6aa325da16f06612255d105e125a5a7451b3928ec69e6e forge test --match-path test/scratch/IndependentSharedExecutor.t.sol -vv
```

Result: **1 passed, 0 failed, 0 skipped**; test `testUnrelatedUserConsumesVictimSharedExecutorQuotaWithoutVictimFunds`.

### Impact boundaries

This does not prove arbitrary theft of Alice's token holdings or a bypass of the arithmetic `S <= floor(E*p/10000)` at the executor address. Aggregate quota conservation is not equivalent to user isolation. The earlier statement that an attacker cannot spend another *address's* E/S remains address-level true: the executor itself calls the router. It cannot justify a claim that users behind that address retain isolated rights. Loss of expected sale capacity and sale by an otherwise ineligible participant are the confirmed consequences.

No owner setter or activation toggle can repair this after an immutable launch. It is especially material before final unlock. After permanent bypass the quota issue ceases to restrict trading, but that does not remediate earlier rights consumption.

### Mitigations and compatibility

| Candidate mitigation | Compatibility with the requested semantics | Assessment |
| --- | --- | --- |
| Each user calls the standard router directly from their own EOA or independently controlled smart account | Compatible | Prevents accidental pooling for that integration. Cannot prevent all third-party shared executors; public router entry remains available. |
| Shared executor keeps its own authenticated per-user E/S ledger and checks every operation, or routes through a distinct account per user | Compatible as an additional integration constraint | Requires separately reviewed executor logic and independent account authority. Unrestricted alternative executors remain outside that protection. An allowlist would add new policy/control assumptions. |
| Warn in UI, explain initiator identity and reject known shared services in the candidate UI | Compatible | Useful risk disclosure. Bypassable by alternate UIs and unknown executors. Not an on-chain fix or grounds to close High. |
| Attribute to final recipient, token source, caller-supplied hook data, `tx.origin`, or recover arbitrary user intent | Conflicts with requested exact pinned-router INITIATOR design, or lacks proof | Do not silently implement. Unauthenticated hook data is forgeable; `tx.origin` breaks smart accounts and is prohibited. Signatures/proofs require a separately authorized design and compatibility review. |
| Reject all contract initiators | Conflicts with preservation of authorized smart-account semantics | Rejects legitimate accounts, lacks robust EOA/contract separation under account delegation, and does not establish beneficial ownership. |
| Accept risk because initiator semantics were authorized | Not a technical mitigation | The current assignment explicitly says authorization does not waive High findings. Cannot support release. |

The task simultaneously preserves INITIATOR accounting and blocks unresolved High issues. The implementation can preserve that accounting while documenting and demonstrating H-01, but cannot truthfully claim universal user-isolated quotas. A per-integration constraint can reduce exposure; closing H-01 globally needs a separately reviewed policy/design that reconciles these requirements. No missing launch address or future key resolves it.

## Recommendation

Keep candidate writes, deployment and publication disabled. Preserve live launch1560 behavior. Treat H-01 as a blocking High, not accepted-by-design, and do not label the successor release ready. Before any release: assess the final mainnet source and its exact runtime dependencies, repeat recorded-block full factory/companion/certification/activation and Permit2/router rehearsals, and resolve reliable IMD/USD oracle evidence. Passing unit tests or this narrow second assessment does not replace those obligations.

## Delivery note from implementing author

The independently authored proof has been preserved as `test/mainnet/SharedExecutorReview.t.sol`; its earlier scratch path is temporary. A follow-up separate review of the newly added mainnet files was attempted but did not complete because the review tool rejected that request. Accordingly **the final mainnet candidate and oracle adapter remain pending independent review**. The narrow completed shared-executor review is not presented as a full audit or a waiver of H-01.
