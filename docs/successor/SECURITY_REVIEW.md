# Successor security review status

**Independent adversarial review: PENDING.** No independent contributor has reviewed `UnlkHookV3` yet.
The notes below are the author's own self-review. They are not an audit, and passing tests are not one
either. Critical/high findings from the independent review block release.

## Scope for the reviewer

`src/successor/UnlkHookV3.sol` (swap callbacks, route authentication, fee deltas, partial-fill rule, setup
without a custom router) and `src/successor/SuccessorFeeMath.sol`. Companions are unchanged and pinned
(`ReviewedCodeV2`); their earlier review status is in `docs/candidate/SECURITY_REVIEW.md`. Also in scope:
`web/src/candidate*.ts`, `web/src/NextRelease.tsx` and `script/successor/PrepareSuccessor.s.sol`.

## Self-review checklist (eth-security items)

| Item | Finding |
| --- | --- |
| Access control | Callbacks are `onlyManager` and official-pool only. The setup functions accept the immutable `setupAuthority` only, once; after activation none can be called. There are no owner, pause, upgrade or allowlist powers. |
| Route authentication | Constant router address and runtime hash, plus constant Quoter address and hash. Lookalike code at either address is rejected (test). The initiator comes from the router's own lock, never from `tx.origin`, hookData or calldata. |
| Reentrancy | `pendingOperation` binds `beforeSwap` to `afterSwap` (`sender`, key, params) and blocks nesting. External calls in callbacks go only to the pinned router (`view` `msgSender`), the sealed oracle and the vault. The vault's `recordAccrual` is hook-only. |
| Accounting / rounding | Fee bounds are fuzzed (`testFuzzSpecifiedFeeBounds`): ETH-specified fees are within [floor, floor + 1 wei]. ETH conservation and fee accrual are fuzzed through the real router. Invariants: quota never exceeded; total E equals executed buys only; fees are native claims; the hook, the vault (in UNLK) and the router hold no residue. |
| Unexecuted volume | A partial fill or a range exit reverts `PartialFill`, so no fee is charged on volume the pool did not execute. |
| Hook delta safety | The specified delta stays below the specified amount (`HookDeltaExceedsSwapAmount` cannot occur). The exact-output gross is bounded to int128. `int256.min` is rejected. |
| DoS | A rejecting beneficiary cannot block swaps (fees are claims). Feed failure never blocks swaps or claims. Pinned-router dependency is risk I-6. |
| Oracle manipulation | Unchanged oracle and milestone rules. Fees are not oracle-priced. Swaps cannot end outside the seed range, which keeps the oracle's liquid-range assumption. |
| MEV / slippage | Standard router limits apply and are fee-inclusive, because the Quoter includes the deltas. The treasury does no conversion, so it has no MEV surface. |
| Semantics | Initiator ≠ payer/recipient by design. Residual risks I-1…I-6 are in `DESIGN.md`. I-1 (quota pooling through shared executors) is rated **High** for users of such services. It is a property of the authorized semantics, not a code bug, but the requester and reviewer must accept it explicitly. |

## Open items

* Independent review (blocking).
* `PERMIT2_PERMIT` (`0x0a`) signature flow not executed in tests (allowance flow is).
* V3 not yet rehearsed against the actual Sepolia `LaunchFactory` with Sepolia chain-id service pins. Fork
  tests use real Sepolia PoolManager, Universal Router, Quoter and Permit2 state with a local factory instance
  under a local chain id.
* Slither/Mythril were not run in this job.
