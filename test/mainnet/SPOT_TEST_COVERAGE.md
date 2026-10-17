Additional tests for the accepted UNLOCK/UNLK mainnet implementation at workspace
commit `cfb6b05`. All deliverable changes are under `test/`. Production contracts,
configuration, dependencies, artifacts, manifests and historical Sepolia files are
unchanged. No dependencies were installed.

| File | Coverage |
| --- | --- |
| `SpotIntegrationFixture.sol` | Reuses the recorded mainnet factory, manager, router, Permit2 and IMD runtimes. Executes the actual factory launch and stages the admitted `ImdSpotUsdSource`; never redirects `priceUsd()` to a different adapter. No sampler or warm-up. |
| `SpotFailureIsolation.t.sol` | Fifteen invalid reference states: stale/incomplete/zero rounds, nonpositive and over-cap answers, bad timestamps, wrong feed decimals, reverting feed, empty/uninitialized pool, wrong LP fee and zero-rounded price. Failed activation leaves all activation fields and oracle binding untouched; a valid reference can activate immediately. After activation, earned gates, within-quota trades, ordinary transfers, native claims and treasury withdrawals survive these outages. Tests the exact 90-minute freshness boundary and rollback after a late router failure. Active trading runs in both currency orders. |
| `ExternalSpotTouch.t.sol` | Seeds a real local hookless IMD/ETH pool with the canonical PoolKey. A single unlock callback swaps, checkpoints the UNLK gate, reverses the reference swap, then settles its net debt. The temporary ETH input exceeds the actor's ETH balance. A transient touch above $50M permanently unlocks a transfer-only holder despite a subsequent price decline and feed outage. A reverted callback cannot preserve the gate. Runs in both currency orders. |
| `SpotCustodyInvariants.t.sol` | Two three-actor campaigns, one per currency order. Randomizes standard-router buys/sells, transfers, block advancement, price changes/outages, checkpoints, native claims, synchronization, LP collection, treasury redemption/withdrawal, ERC20 and ERC6909 donations, unauthorized calls and attempts by the setup authority to reconfigure the sealed launch. |
| `SpotArithmeticProperties.t.sol` | Independent base-2^64 schoolbook multiplication checks `q*D <= N < (q+1)*D` for exact flooring, and `N >= maxUint256*D` for saturation. Covers the full nonzero uint160 price and uint256 base domains, including wide inverse denominators, zero/one/max bases, and the 128-bit branch boundary. No production division helper, FFI or external arithmetic runtime is used. |
| `ImdTreasuryFailurePaths.t.sol` | Missing redemption receipts restore burned manager claims and accounting. False token transfer returns restore both withdrawal ledgers. Nested manager unlock and replayed callbacks fail without stranding valid fees. Unsolicited manager claims cannot be recorded by an outsider or redeemed as fee revenue. Includes zero/one-wei edges, retry checks, and explicit principal-removal rejection before and after global bypass and reference failure. |

The custody campaigns each use inline Foundry settings of 256 runs, depth 64 and
`fail-on-revert = true`. Unexpected handler failures cannot be discarded. The three
stateless fuzz properties each use 1,000 runs. Inputs use bounded generators; no
new test uses `vm.assume`, `vm.setEnv`, an RPC URL, FFI, or a skipped-test path.

The accounting model tracks delivered tokens, executed sales, current-block buy
receipts, native allocations, manager-issued fee receipts, cash redemption and
payouts. It never initializes its expected ledgers from the vault or hook counters.
Treasury fee rates are checked against executed IMD flows; LP collection checks
the 80% payer share. The properties reconcile manager cash, vault cash and claims,
separate donations from revenue, preserve the cumulative E/S quota formula, and
compare persisted gates to the highest valid observed FDV. Additional properties
check the fixed supply against all reachable holder balances, locked seed
liquidity, cleared settlement deltas and sealed companion addresses. Every random
sequence ends with full redemption and withdrawal of all earned treasury revenue
and direct token donations; unsolicited ERC6909 donations remain accounted
separately. Scripted handler tests exercise both success and refusal branches.

The arithmetic enclosure is independent of the implementation's division
algorithm. Its multiplication oracle also has small-product and known carry-vector
sanity tests. Gate thresholds in the handler come from the task's fixed schedule;
the handler does not call the hook's tier-selection function to predict its result.
It reads the oracle to model which valid prices were observed; the source arithmetic
is checked separately by the enclosure properties.

These are **offline simulations**, not fresh mainnet forks or an actual release
rehearsal. Recorded runtime code is reused, but launch identities, allocations,
Chainlink answers and trader funding are local fixtures. Most reference-state
tests set only the external pool's storage; `ExternalSpotTouch.t.sol` instead
initializes and trades that pool through real manager calls. No synthetic fixture
is a release manifest, owner record, native round0 tree, deployment transaction,
or proof of source verification. No public deployment, publication or signing was
performed. A live recorded-block rehearsal with the actual release inputs,
protected admission and the mandatory platform audit panel remain separate work.

The external spot manipulation tests document an **explicitly accepted risk**;
they do not claim manipulation resistance or a fix. Mature shared-executor quota
pooling remains covered/disclosed by the existing suite. No new implementation
defect was reproduced by the additional tests.

Reproduce from the repository root with `forge build` and `forge test`. Local
checks direct generated artifacts and cache into disposable scratch space to
respect the write scope:

```sh
FOUNDRY_OUT=test/scratch/out FOUNDRY_CACHE_PATH=test/scratch/cache forge build
FOUNDRY_OUT=test/scratch/out FOUNDRY_CACHE_PATH=test/scratch/cache \
  FOUNDRY_INVARIANT_FAILURE_PERSIST_DIR=test/scratch/invariant-failures \
  FOUNDRY_FUZZ_FAILURE_PERSIST_DIR=test/scratch/fuzz-failures \
  FOUNDRY_FUZZ_SEED=0xa9a85f3e917f851909cc56d729dafbccc481a7a8bd1cc34be8bf4db901b32cb0 \
  forge test
```

No submitted source depends on `test/scratch/`.

Final checks on Foundry 1.8.5 and solc 0.8.26, with the seed above:

- `forge build`: passed, with existing compiler warnings.
- Full `forge test`: **464 reported tests passed across 91 suites; zero failed,
  zero skipped**. This includes 26 additional reported results. Foundry groups
  the six new invariant properties into two campaign results.
- New stateless fuzz properties: **3,000 cases** in total.
- New custody campaigns: **256 runs × 64 calls in each currency order**, totaling
  **32,768 handler calls**, with zero unexpected reverts, plus withdrawal checks
  after every sequence.
- No implementation finding was left unresolved; no findings report was needed.
