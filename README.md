# UNLOCK / UNLK — mainnet initialization admission repair

This revision imports the accepted project at [`b957a835f1cca9eef51a121851e2026fc17ff435`](https://github.com/identity-md-launches/launch-2064-unlock-symbol-unlk-review-adapt-and-depl/commit/b957a835f1cca9eef51a121851e2026fc17ff435) and repairs its **mainnet initialization admission failure**. The existing Sepolia deployment, its contracts and website configuration are preserved. No website publication is part of this release.

The original failure is reproduced as `WrappedError(..., InvalidConfig(), HookCallFailed())`. Initialization now binds only the constructor-authenticated factory and exact sorted pool; full unchanged mainnet service attestation runs at every authenticated setup entry point and again before activation. Seeds and zero-delta fee collection need no companions. Inactive swaps, credit synchronization and milestones remain disabled. See the [repair evidence and release handoff](docs/admission-fix/REPORT.md) and [independent contributor review](docs/admission-fix/INDEPENDENT_REVIEW.md).

The active manifest selects `src/mainnet/UnlkImdHook.sol`, IMD, fee12500, tick spacing60 and ten permissions (`0x3fcc`). The historical Sepolia manifest is preserved at [docs/mainnet/release/imported-sepolia-manifest.json](docs/mainnet/release/imported-sepolia-manifest.json). [ADAPTATION.md](ADAPTATION.md) records every change and both reproduced imported-audit findings.

Price uses the existing **stateless `ImdSpotUsdSource`**: official UNLK/IMD spot × existing IMD/ETH spot × fresh validated Chainlink ETH/USD; FDV uses the fixed 1B supply. There is no sampler, keeper, observation window or warm-up. Current price validity is required for activation and new gates; reference failures do not block otherwise valid trading or independent native claims. See [SPOT_PRICE.md](docs/mainnet/SPOT_PRICE.md).

Gates begin at20%. Valid instantaneous touches permanently open the highest crossed tier through95% at$40M; $50M permanently bypasses quotas for **all** holders. Cumulative mature E/S and prior sales remain intact: 1000 acquired,200 sold,then30% permits only100 more. One-block buy maturity and the authenticated standard-router initiator ledger remain unchanged. Ordinary token transfers carry no quota rights.

The launch retains 10% swarm /87% pool /3% payer, fixed1B supply/18 decimals, fee12500 and the fixed75bps treasury fee in IMD. Uniswap's independently controlled protocol fee is now accounted for by core instead of halting the launch. Collected LP revenue still splits80% payer/20% IMD distribution; with a protocol fee, those are shares of actual LP receipts, not promises of exactly1%/0.25% of gross input. The treasury beneficiary is immutable `0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9`; NFT purchases remain manual.

**Accepted risks remain:** mature shared-executor quota pooling and manipulation of either spot pool, including same-transaction/flash manipulation of the external IMD reference, can open gates early and permanently up to the global bypass. They are not claimed fixed. Platform treasury-approved later native reward rounds can create further claim eligibility; other pools do not enforce this pool's quota. Neither risk acceptance nor local tests replace mandatory platform review.

The live current job requests an Ethereum hook launch and names the intended payer. Supported repository import and the prepared structured `launch.open` request check succeed. The current public job reports a different bootstrap base commit; the prepared request is not evidence that its stored source binding was amended. The platform panel and judge follow this implementation. Publication, assigned launch records, deployment receipts and sealed activation are downstream release outputs. **No mainnet stage1 or stage2 transaction is claimed here.** See [release status and operations](docs/mainnet/release/OPERATIONS.md) and [validation](docs/mainnet/release/VALIDATION.md). Stage1 alone means pool deployed, trading inactive.

Reproduce with the unchanged offline Foundry configuration and vendored dependencies:

```sh
forge build
forge test --fuzz-seed 0xbf84f3f21fd6f3e756b5aa1b53feb5a083e16964a7b58fcc36f0bcbdb81e70bd
python3 scripts/mainnet/artifacts.py --check
python3 scripts/mainnet/check-manifest.py
python3 -B -m unittest discover -s test -p 'test_mainnet_manifest.py' -v
```

After intentionally changing companion code, rebuild and regenerate `ImdReviewedCode` with `python3 scripts/mainnet/artifacts.py --write`, then rebuild and check again. Mine the actual release salt only after final code, owner, factory and predicted token are known. The recorded-block fork and its local CREATE2 mining are simulations; no synthetic launch number, allocation tree or source attestation is a release input.
