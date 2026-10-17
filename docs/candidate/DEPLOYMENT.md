# Candidate release and operational handoff

**No deployment or publication is authorized by this assignment. Release is blocked.** The following is a reviewable preparation path, not instructions to use a funded wallet now. Do not reuse historical token/hook addresses or treat simulated fork addresses as deployed contracts.

## Reproducible artifact preparation

1. Run `bash scripts/candidate/check.sh` from the root with Foundry, Solidity 0.8.26, Python 3 and Node already available. All project dependencies are ordinary files. Root Foundry configuration and remappings remain unchanged. No FFI, filesystem cheatcode grants, npm install or network are needed.
2. Verify both `scripts/generate_code_checks.py --check` (historical sealed contracts) and `scripts/candidate/pin.py --check`. The candidate's companion creation-code pins cover the router, evidence, oracle, vault and stateless setup verifier; token provenance is pinned too. Changing any production source requires regenerating pins deliberately, rebuilding, rechecking and fresh independent review. `--write` is a maintainer regeneration operation, never an admission bypass.
3. `scripts/candidate/artifacts.py` exports eight ABIs and creation/runtime-template hashes, rejects library link placeholders and more than sixteen constructor inputs, and checks EIP-170/EIP-3860 limits including constructor words. The candidate hook runtime is 21,055 bytes and full initcode 22,354 bytes with the supplied settings. See [ARTIFACTS.json](ARTIFACTS.json). Runtime templates contain unresolved immutable words and are **not deployed code hashes**.
4. `forge build --sizes --skip test --skip script` checks deployable contracts. The legacy LocalDemo embeds entire systems and exceeds production limits; it is a local test script, never a deployable release artifact. Do not use a size exemption for production code.
5. Preserve a commit of all ordinary source, dependencies, scripts, source preview and reports. This assignment forbids `.git/` writes, so creation/pushing of that commit remains with the contributor upload process. No release commit or independent audit signature is fabricated.

## Required release decisions and inputs

Resolve the [standard-router accounting blocker](COMPATIBILITY.md) first. The experimental route is not a compatibility waiver. A later independent contributor must review the resulting complete architecture, including native-specified fee settlement, authentication, quotes, setup, all permission bits and the frontend transaction path. Critical/high findings block release.

After review, the launch operator obtains the actual new launch number, frozen round-0 recipients/amounts/root, owner/setup-authority wallet, new token prediction, factory/manager, fee policy, seed range/liquidity, and receipts. No guessed launch number, test key or placeholder address is valid. The NFT beneficiary is fixed by this task and is not automatically the new launch owner. The owner is a real release input; coding does not require its key.

The candidate is Sepolia-specific in its runtime service/feed pins. The manager is the task's `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`; published ETH/USD proxy is `0x694AA1769357215DE4FAC081bf1f309aDC325306`. The recorded rehearsal uses factory `0x315752fEE5cBcAA00333E0d4d91E0cD69429E908` and its actual authorized deployer, not an invented service. Re-read official factory/registry/fees/feed/manager code and policy before a separate release; stale pins must stop admission, not be bypassed. Chainlink proxy code pinning cannot remove trust in feed governance or aggregator changes.

The root historical `launch.json` remains unchanged. [release-plan.json](release-plan.json) is a **candidate specification**, not a platform launch manifest. The later platform manifest must be generated after the architecture is approved, with actual launch policy and receipt-derived inputs. Preserve LP fee 12500 and the 10/87/3 allocation. Derive the opening sqrt price, ticks and liquidity from the verified policy and seed-depth constraints; never copy the historical manifest's 1:1 placeholder as a seed price.

## CREATE2 and two-stage setup

The constructor is `(IPoolManager manager, UnlkToken token, address factory, address setupAuthority)`. It makes no external calls and requires no code at those addresses. Constructor checks and permission validation remain immutable.

All required flags are `0x3fc4` (16324). They enable before/after initialization, before/after add/remove liquidity, before/after swap, and afterSwapReturnDelta. The old `0x3fc0` salt/address is invalid for this candidate. All callbacks authenticate the manager and the official pool; initializer authenticates the factory. No beforeSwap return delta, donation or liquidity return-delta permission is enabled.

After the actual new token is predicted, this offline command produces a candidate salt without deploying:

```sh
node scripts/candidate/mine.mjs FACTORY POOL_MANAGER NEW_TOKEN SETUP_AUTHORITY
```

These are required positional inputs, not literal values to deploy. The salt is mined against the factory's CREATE2 sender and exact constructor bytes. `HookDeployerV2` is a pure initcode encoder with no embedded candidate creation code in its runtime. Its output is tested in the actual factory fork path.

Stage 1 is the factory's existing atomic launch: create token and hook, initialize the official native-ETH pool with its hook, distribute supply and seed protected token principal. Initialization enforces the actual seed depth/allocation. Until stage 2, swaps, credit sync and milestones fail closed; ordinary transfers and eligible native claims continue to work.

Stage 2 is authenticated staging plus a one-time atomic activation:

1. The actual owner calls `deployCompanions(number, feed, bytes[5])`, in order **router, evidence, oracle, vault, setup verifier**. The hook checks exact creation hashes and real stage-1 records, then creates companions with derived immutable bindings. The stateless verifier contains no control or custody powers; it was extracted to keep the hook deployable under EIP-170.
2. Certify the complete actual round-0 tree through the evidence contract. The source preparation script emits `certifyRound(0, recipients, amounts)` for modest trees; use the existing checked `submitLeaves/reduce` mechanism for larger trees. Root funding, unique recipients and sums must match the real distributor; a mere arbitrary Merkle root is insufficient. Earlier native claims are attested/synced after activation without duplication.
3. The immutable setup authority calls `configureAndActivate(stagedRouter, stagedEvidence, stagedOracle, actualNumber)`. All bindings, creation provenance, launch records, initial allocations, principal, fee policy, feed settings and certified round are checked before sealing. Failure reverts atomically. Success removes all configuration/staging powers permanently.

Before activation the owner can restage identical pinned code under a new staging salt if a bundle was abandoned. This preserves an accepted prior recovery fix. It is not an upgrade after activation. The authority can delay activation, but cannot replace the approved code, redirect the vault or set quota exemptions.

`script/candidate/PrepareCandidate.s.sol` takes explicit actual config and allocations and returns exact staging, certification and activation calldata with predicted companion addresses. It has **no broadcast or environment/key read**. Its test exercises a real local factory launch, rejects uncertified activation, then certifies and activates once. The historical fork test exercises the actual Sepolia factory/service contracts. Both are simulations, not approval to transact.

## Post-release responsibilities, if a later release is approved

The release operator records actual deployment/activation receipts, PoolId, constructor arguments, code and runtime hashes after immutable patching, exact compiler input, source verification and allocation proofs. Verify all bindings independently and ensure the manager's protocol fee remains zero. Publish ABIs and a new candidate deployment config only after those checks. `CANDIDATE_DEPLOYMENT` remains null in this deliverable; never substitute artifact-template hashes for actual deployed runtime hashes.

Anyone can maintain oracle checkpoints and milestone calls; a dependable operator must monitor the four-minute cadence, ten-minute maximum gap, complete two-hour warm-up, valid feed and depth. Failure delays progression but never revokes earned tiers. Anyone can sync proven payer/reward credit and redeem vault claims. The beneficiary alone withdraws vault fees or separate donations to itself. It chooses manual NFT purchases externally, with no guarantee and no on-chain automation.

Website publication is a separate approval after contract review and deployment verification. Review the frontend's new-chain config, code hashes, exact transaction simulations, fee-inclusive limits and error states. Candidate writes are intentionally unavailable now. Preserve historical live rules and links when introducing a future deployment. The mainnet gallery remains read-only and must never request a mainnet signature for Sepolia trading or treasury display.
