# Additional UNLK adversarial tests

Tests added against accepted workspace commit `e9cd6e0`. The accepted implementation,
existing tests, dependencies and configuration are unchanged. No dependency installation,
RPC, FFI, environment mutation or deployment is needed by these tests.

| File | Additional guarantees checked |
| --- | --- |
| `BatchSettlementProperties.t.sol` | A mixed batch of up to 16 trades has the same executed inputs, outputs and final state as separate swaps. Covers exact input/output, partial fills, existing native liabilities, forced ETH and token donations. A slippage failure at any batch index restores balances, finite allowances, fees, quota counters, oracle observations and nonces, and a subsequent retry works. Also checks a one-wei allowance shortfall and a partial sale whose prefund exceeds its actual quota consumption. |
| `ClaimLifecycleInvariants.t.sol` | Up to eight funded rounds with overlapping recipients and one-to-four-leaf trees. Randomize native claims, certification, attestation, synchronization, transfers, donations, time advances, sweeps and unauthorized opening. Independently track actual deliveries and obligations: the distributor remains solvent; every payout reconciles to funding; only delivered, certified, attested and synchronized claims create rights; sweeps and ordinary transfers create none. |
| `NativeCustodyInvariants.t.sol` | Three contract wallets make mixed buy/sell batches, transfer tokens, donate tokens/ETH, attempt failing batches and withdraw while accepting, rejecting or reentering. Track each wallet's credits, receipts, token holdings and quota independently. Router ETH equals liabilities plus forced surplus; manager ETH reconciles to executed flows; manager deltas and route context clear. After every random sequence, all accepting wallets can redeem their entire credit, leaving only donated surplus. |

All three suites use the vendored Uniswap v4 PoolManager and the existing local
factory/distributor fixtures, with the actual factory launch flow and its token-only
870M seed. They do not add artificial quote liquidity or overwrite production storage,
mock executed deltas, bypass companion authentication, or manufacture quota.
Chainlink is the existing local feed fixture; these are offline integration tests.

The batch equivalence oracle executes real swaps individually, snapshots the result,
restores the starting state and executes the same requests as a batch. The accounting
invariants use generated allocations, successful deliveries, executed trade results
and actual recipient balances. They do not initialize their expected balances from
the accounting counters under test.

Both new invariant campaigns enable `fail-on-revert` in inline Foundry configuration.
Expected failures use explicit error assertions; unexpected handler reverts cannot be
discarded as harmless fuzz inputs. Scripted sanity tests exercise the handlers' success
and refusal branches. The native campaign also runs withdrawal liveness checks in
`afterInvariant`.

## Reproduction and recorded checks

From the repository root, with Foundry available:

```sh
forge build
forge test
forge test --match-contract 'BatchSettlementPropertiesTest|ClaimLifecycleInvariantsTest|NativeCustodyInvariantsTest' -vv
```

Local verification on Foundry 1.8.3 / solc 0.8.26:

- Baseline: 142 reported tests passed.
- Clean build: passed, compiling 128 files. Build/cache artifacts were directed to
  `test/scratch/final-out` and `test/scratch/final-cache` to respect the write scope.
- Complete suite: 151 reported tests passed across 31 suites; zero failed or skipped.
  This Foundry version reports a group of invariant properties as one test result.
- Batch properties: 1,000 fuzz cases each, 2,000 total.
- Claim invariants: three properties, 256 sequences of depth 80; 20,480 handler calls,
  zero unexpected reverts.
- Native custody invariants: three properties, 256 sequences of depth 64; 16,384 handler
  calls, zero unexpected reverts, followed by withdrawal checks after every sequence.
- Supplied protected checks: all 11 passed, zero skipped. Unmodified checks were copied
  temporarily under scratch and given manifest-derived creation code and probe values
  through an isolated subprocess environment. No test calls `vm.setEnv`.

The only new compiler warnings are for the test-only `SELFDESTRUCT` helpers that
exercise forced ETH donations. The existing hook mutability warning also remains.
No scratch file is required by the submitted tests.

## Revision against the reconciled implementation (commit `398b354`)

The accepted implementation changed under these tests between `e9cd6e0` and `ed59c57`
(seed-depth gate in `beforeAddLiquidity`, `_verifySeed`/`_verifyAllocations` at staging and
activation, repeatable staging with per-attempt salts, chunked Merkle certification, and the
removal of `confirmationInterrupted` from the milestone logic). The only change to the three
earlier files is one line: `BatchSettlementProperties.t.sol` no longer hashes the removed
`confirmationInterrupted` flag into its state snapshot. Everything else in them is unchanged.

`RevisionProperties.t.sol` adds adversarial properties for exactly the changed mechanisms:

| Suite | Guarantees checked |
| --- | --- |
| `SeedGatePropertiesTest` | Fuzz over 51 opening boundaries from 15% below to 15% above the policy figure with the exact 870M token-only seed: a launch is accepted if and only if `SeedDepth` clears the 17 ETH floor and the pool-share band; every accepted seed's recorded principal and capacity equal the live position's, its opening observation is classed liquid, and after the warm-up window the oracle prices it within 0.2% of the boundary FDV. Fuzz over the 98%-100% liquidity band: launch and activation succeed exactly when the pool receives at least `MIN_POOL_ALLOCATION`; allocation receipts always sum to the supply; the remainder wallet is never credited above the 3% policy share. |
| `ChunkedCertificationPropertiesTest` | Trees of 1 to 24 recipients with random amounts, random chunk sizes and random `reduce` counts (including counts past the remaining nodes): the round certifies exactly when the last internal node is computed, matching the single-shot `certifyRound` on the same tree via a state snapshot. A parallel session with one corrupted amount reduces to `InvalidProof`, changes nothing and cannot touch the honest session. A certified round refuses every further path. Attestation needs an actual distributor claim with the exact amount, credits once, and synchronizes once. Abandoned sessions cannot be reduced, discard their uniqueness set, and a restarted session certifies. |
| `MilestoneSampleInvariantTest` | Handler campaign (`fail-on-revert` on) that samples milestones under random time steps, price swings from $100 to $1M per ETH, and six feed corruptions: broken call, stale round, wrong decimals, non-positive answer, `answeredInRound < roundId`, and a future `updatedAt`. An independent ghost chain of valid qualifying samples at most 10 minutes apart is tracked outside the hook. Invariants: no tier advances on an invalid sample or below its threshold; at most one tier per confirmation; no advance before the chain has lasted the required 6 h (24 h for the final tier); the hook's pending start never precedes the ghost chain; tier, `p` and full unlock never go backwards; `p` always matches the tier; pending start and last confirmation are zero together and ordered. A scripted test shows the handler confirms a tier under healthy cadence and that every corruption mode yields an invalid sample. |
| `RestagingIsolationTest` | After re-staging, the three mixed bundles (old router, old evidence, old oracle) are each refused with the error the hook specifies; attestations made on the abandoned evidence create no credit after activation, and the activated evidence must prove the claim itself; the abandoned router cannot swap and the abandoned oracle cannot be bound. |

Results on Foundry 1.8.3 / solc 0.8.26: full suite 170 tests passed across 37 suites, zero
failed or skipped. The milestone campaign ran 48 sequences of depth 40 (1,920 handler calls,
zero reverts); the seed fuzzes 96 cases each; the certification fuzzes 128 cases each.
No implementation defect was reproduced by this revision's checks, so no `.imd-findings.json`
is written. Two harness-only issues were found and fixed in the tests themselves during
development (the distributor's contributor lock and forge-std `bound` wrapping rather than
clamping out-of-range inputs); neither concerns the implementation.

## Review limits

No new implementation defect was reproduced by these added checks. They establish
the tested accounting properties, not an independent fair-value guarantee or active
Sepolia deployment. The accepted package's recorded deployment status and sustained
manipulation / other-pool bypass limitations remain as documented in
`RELEASE_STATUS.json` and `docs/SECURITY_REVIEW.md`. No public transactions or fresh
fork checks were performed in this tests-only assignment.
