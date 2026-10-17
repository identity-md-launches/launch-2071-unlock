# Separate contributor review — final one-way gate source

**Decision: NO-GO for mainnet release.** A separate contributor-agent review occurred during this task. It found no remaining defect in the one-way gate implementation or exact FDV arithmetic. It confirmed the two pre-existing High findings below. This is a distinct assessment from the implementing contributor's checks, **not an external audit, commercial certification, final GitHub commit approval or authorization to deploy**. External independent security/economic review remains pending.

The reviewer inspected the bound pool/sqrt price, both token orders/decimals, direct highest-tier advancement, cumulative E/S, maturity, post-swap ordering, global irreversible final bypass, invalid-reference isolation, rollback, shared-executor identity and external source. The final deployment generator and native distributor prediction were also reviewed. Reviewed production-file SHA256 values are recorded below and in the release source manifest.

## Findings and disposition

| Finding | Final disposition |
| --- | --- |
| Valid official UNLK spike opens gates, including $50M bypass | **Accepted requested economic behavior.** No sustained price or manipulation-resistance requirement is asserted. Not a security fix or unresolved UNLK-timer issue. |
| Wrong pool attribution or rounded tick used for FDV | No confirmed defect. Binding checks hook/key/token/manager/seed range; reads exact official sqrtPriceX96. Both currency orders tested. |
| Gate opens restore quota, mutate E/S or use remaining balance | No confirmed defect. Gates only change tier/p/final flag. Exact1000/200/100 example, rounding, subsequent acquisitions and repeated checks pass. |
| Sale uses its own post-price retroactively | No confirmed defect. `_account` executes before `_updateMilestone`; successful earlier swaps/checkpoints can open rights for later swaps. |
| Final p=10000 still blocks E=0 recipients | No confirmed defect. Enforcement and quota view explicitly bypass on the permanent flag. Fees/S recording continue. |
| Conservative high-sqrt inverse normalization loses an exact threshold by1USD wei | **Resolved during review.** Reviewer supplied a concrete arbitrary-input counterexample outside advertised opening range. New exact wide arithmetic returns the exact $100K threshold rather than retaining an unreachable-domain exception. |
| Stage1 generator allows payer equal to native distributor, stranding activation | **Low operational gap, resolved during review.** Generator predicts using actual embedded factory creation code, validates its hash, rejects distributor as payer/authority, and tests actual deployment address agreement. |
| H-01 mature shared-executor quota pooling | **High, OPEN, release blocker.** Unrelated sellers can consume mature capacity of the authenticated shared initiator using their own tokens. Victim token balances remain untouched; user isolation is not established. |
| Repeated/sustained external IMD/ETH sample manipulation | **High, OPEN, release blocker.** The unchanged sampled source can ratchet/pass at a manipulated2x reference. This finding is separate from valid UNLK spikes; conditional LP/fee models are not verified realizable mainnet profit. |

H-01 cannot be fixed globally by a longer maturity delay, UI label, optional single-wallet executor or treating `msgSender()` as a beneficial-user oracle. Preserved smart-account/standard-router/empty-hookData semantics do not expose final settlement identities. Resolution needs an explicitly reconciled identity/settlement design or a separately reviewed requester risk decision; it is not silently waived here.

The external reference retains its complete validation. That still cannot prove that sustained or repeatedly sampled external prices represent unmanipulated USD value. No paid attester/proof collector or spot fallback is introduced to paper over the finding. A justified reference architecture and independent economic assessment are required for release.

## Reviewer-executed evidence

Required seed: `0xda8bb4c7a1dfecbe1d2824491108f08053450070bcb18434381100e02a366653`.

- Final one-way gate regressions: **34 passed**, both orders, two256-run fuzz tests.
- Exact spot math: **3 passed**, including256 fuzz runs; independently recomputed **64/64 literal golden assertions** using Python arbitrary precision.
- Independent wide-divider model: **10,000 deterministic random high-sqrt/base pairs** matched exact bigint division.
- Final launch-plan regression file: **8 passed** after adopting the reviewer's cap regression as delivered tests. It exercises seven caps per order (250,251,2500,10000,100000,249999,250000 IMD) through actual recorded factory runtime, plus malformed provenance/identity and native-distributor exclusions.
- H-01 segregated-funds proof: **1 passed**, confirming the remaining finding.
- Sampled-source ratchet/sustained/cross-pool limitation regressions: **3 passed**, confirming remaining reference limitations.

Reviewer verified that the archived Sourcify on-chain factory runtime equals the recorded fixture byte-for-byte:17,319bytes, hash `0xb6a524d4b697c41f80c369f4990ac070c9dda6f3ef5efe36f21e6150a530b413`. Its embedded native distributor body at offset12,803,length4,504 hashes to `0xf1c21108732a73286b1030e87fbba14c806905275dde6fce012f2c0ca19e30b9`. Archived source confirms constructor `(token,factory,fees,sweepDelay)` and `bytes32(number)` CREATE2 salt. A local alternative distributor build was not substituted.

```
979574703234a07744e4bfe98f4994918b59a3fa1892c1e454ac4407ca9c6b66  src/mainnet/UnlkImdHook.sol
e4dd3cdd13c5b41f53255e2b986258679ef965d89d32d94eb0bbd15742af2896  src/mainnet/UnlkImdOracle.sol
d880c0d4615442d0883e928a67afece0f8b135a7e285338e1cd07d92dfa1f50b  src/mainnet/ImdSpotMath.sol
81118d186bb5794fb730fc12ef093bca6b2db044ccb637d460aeee2118bf31d7  src/mainnet/ImdSampledUsdSource.sol
6ba0b92b36a239fcda7eb4c2b20dfdec5dc1bf1e511efcc703f581b929a8bd0b  script/mainnet/PrepareImdLaunch.s.sol
```

The implementing author's full build/test/frontend/fork results are recorded separately in [HANDOFF.md](HANDOFF.md). Neither those checks nor this separate contributor review close either High finding. Publication must still bind the actual final commit and independent release review to these exact source bytes before any mainnet authorization.

## Final packaging and report verification

The separate reviewer also compared the lossless archive against the accepted3939f31 GitHub tree: all141 original text entries match Git blobs/sizes/modes and both decompressed JSONs match accepted blobs. Archive validation and historical network comparisons pass. The3 legacy consumer diffs only add compression decoding; no existing comparison was weakened. The reviewer checked that the consolidated391/94 results match stored logs, including the completed94/94 dRPC replay without storage caching. No material packaging/report issue was found. Production source hashes above remain unchanged.
