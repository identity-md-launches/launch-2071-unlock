# Supported mainnet release steps — unsigned, blocked pending review/decisions

The consolidated decision is [NO-GO](HANDOFF.md). These are reproducible preparation steps for a **separate authorized new launch**, not permission to execute them publicly. This task broadcasts nothing. It cannot update sealed live launch1560 contracts, replace their token or publish the live site. Do not deploy stage1 while activation, review or the remaining findings are unresolved.

## Inputs and responsibilities

The contributor uploader must publish this ordinary-file change set **on top of accepted commit `3939f319…`**, preserve repository history, return the exact GitHub commit/PR, and bind the [source checksums](SOURCE_SHA256SUMS) plus `docs/mainnet/ARTIFACTS.json`. `.git/` writes are prohibited to this worker; no publication SHA is invented. Current mainnet support records are evidence, not admission of an unpublished tree.

The IMD operator supplies the actual assigned new launch number, policy/admission, accepted source commit, manifest/attestation hashes, verifier key and complete certified round0 tree/agent IDs. The actual payer/remainder recipient and immutable setup authority come from that launch's confirmed owner/payment records; they are explicit script arguments. Never reuse old launch identities, a local fork fixture or a guessed wallet/number. The separate platform manifest step owns the new launch manifest; this task does not modify the existing historical `launch.json`.

The setup authority controls source/companion staging and one-time activation. The tree submitter reconstructs the entire unique-recipient tree, verifies its allocation against the funded 100M contributor share and certifies it. Any account may submit correct certification. The native distributor claim path never depends on hook synchronization. The fixed treasury beneficiary remains `0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9`; it alone may withdraw accounted IMD fees/donations to itself. A gas sponsor/keeper must maintain the sampled reference; it receives no administrative privilege.

## Rebuild and review

From the repository root, with the unchanged Solidity0.8.26/Cancun/optimizer200 configuration and committed ordinary vendored dependencies:

```sh
bash scripts/unlock-gates/check.sh
python3 scripts/mainnet/verify.py
bash scripts/unlock-gates/fork.sh https://eth.drpc.org --no-storage-caching
python3 scripts/unlock-gates/record-network.py https://ethereum-rpc.publicnode.com
```

The offline script runs contract build/tests/format, ABI/hash/size commitments, historical pins and dependency checks, release-artifact regressions, frontend typecheck/build/tests. The fork command is local only, pinned to block26204722; it creates a temporary harness under test/scratch and removes it afterwards. See HANDOFF for the actual-versus-simulated limits. A provider retaining that block’s state is needed later; dRPC replayed it successfully with storage caching disabled. Publicnode later refused historical reads with an archive-token requirement. No key is needed or read.

After an intentional production change: build; run `python3 scripts/mainnet/artifacts.py --write`; rebuild; repeat `--write`/build to settle any changed verifier commitments; then run `--check`, tests and review against the exact final bytes. Do not edit commitments by hand or weaken historical checkers. `ARTIFACTS.json` and `docs/mainnet/abi/` are exported; full creation bytes are reproducible in `out/` with the pinned compiler. The exporter checks every deployable artifact against EIP170/EIP3860, constructor words and unlinked-code requirements. `ImdSpotMath` is internal/inlined and requires no library address.

## Stage1: exact factory calldata

Re-read [capabilities](https://api.imd.fun/requests/capabilities), [policies](https://api.imd.fun/launch/policies), service runtimes/getters and the actual Explorer route before admission. Current recorded target: `chainId=1`, `kind=univ4_hook`, `pairWith=imd`, `poolBps=8700`, policy34, fee12500, spacing60; default opening FDV2500 **IMD**, advertised range250..250000 IMD. A new policy must be assessed rather than silently substituted. Mainnet IMD/UNLK are both18 decimals. The router used by the current Explorer remains the pinned `0x66a989…` runtime; newer Universal Router releases elsewhere are not automatically admitted.

1. Ask the pinned factory to predict the new token with the **actual assigned number** and the built UnlkToken creation body. Confirm it is unused. The mainnet factory is `0x12c63b581d07093f6126bc02263c58f7eadaa96f`, manager `0x000000000004444c5dc75cb358380d2e3de08a90`; preflight verifies code and bindings.
2. Mine the final hook initcode offline using those actual identities:

   ```sh
   node scripts/mainnet/mine.mjs FACTORY POOL_MANAGER ACTUAL_PREDICTED_NEW_TOKEN ACTUAL_SETUP_AUTHORITY
   ```

   Its constructor is `(manager,newToken,factory,setupAuthority)`, flags0x3fcc. Re-mine after any final code/pin change. The authority must be a controlled wallet/smart account, with an executable stage2 signing path; never factory, token, manager, hook or distributor.
3. Call `PrepareImdLaunch.prepare(Config)` from `script/mainnet/PrepareImdLaunch.s.sol` in a read-only mainnet simulation. Config requires the actual number, authority, payer, Merkle root, policy claim/sweep schedule, mined hook salt, selected opening FDV in18-decimal IMD, actual provenance record and agent IDs. It returns factory target, required deployer signer, predicted token/hook/distributor, exact key, actual rounded opening FDV, seed amount, full LaunchParams and unsigned `launch` calldata. It signs and sends nothing. No environment or default launch identity is read.
4. The generator verifies provenance/nonzero identities, unused number, exact factory pin, cap range and mined flags. It floors the normalized IMD-per-UNLK tick to spacing60, then inverts for token1; it derives token-only seed liquidity and verifies the87% allocation band. It uses the exact native distributor creation body embedded in the pinned factory (offset12803,4504 bytes), checks its hash against the factory getter, and predicts using actual constructor arguments/salt. **The locally compiled fixture distributor is not substituted.** Payer/authority equal to that distributor are rejected.
5. The platform compares this plan against its own attested policy/manifest, assigned allocation and predictions. It must rerun admission, owner checks and full dry-run using the **published final commit**. Only the factory's `deployer()` can submit stage1; it is not the setup authority by inference. Do not send from another account or deploy token/hook separately. Successful stage1 means **pool exists, trading inactive**.

These functions are called directly by `test/mainnet/ImdLaunchPlan.t.sol`; their returned calldata is actually executed against recorded runtime, and against the actual factory on the fork, for both token orderings and seven advertised caps. They are preparation tools, not admission or approval to deploy.

## Stage2: sampled reference, certification, permanent sealing

1. With the actual stage1 hook, call `PrepareImd.preparePriceSource()` from `script/mainnet/PrepareImd.s.sol` to obtain unsigned `deployPriceSource(type(ImdSampledUsdSource).creationCode, "")` calldata. Only the actual immutable setup authority can stage it. The source has no constructor arguments, subscription, attester, signer or per-block proof requirement. The historical v3/proof source code is rejected by staging.
2. Anyone calls the actual source's `sample()` every1–20 minutes (operational recommendation5m, with alerts and margin below20m) for **at least48h of actual clean history**. Do not warp production time, copy synthetic observations or substitute raw IMD/ETH spot. Verify `priceUsd()` succeeds under all retained reference checks. Sample failures do not affect independent native claims/transfers. At this point official trading is still inactive.
3. `PrepareImd.run(Config(actualHook,actualNumber,actualStagedSource,actualNativeDistributor), completeRecipients, completeAmounts)` returns setup authority, unsigned companion deployment, predicted evidence/oracle/vault, round0 certification and activation calldata. It checks the actual staged source is valid before returning a plan. No signature or deployment occurs inside the script.
4. The authority executes `deployCompanions` using those exact reviewed creation bodies. A submitter certifies the complete unique-recipient native tree, matching the committed root and funded allocation. For >1024 recipients, use the evidence contract's chunked certification. Confirm actual deployed immutables and predictions. Native claims made before activation can synchronize afterwards and credit once.
5. The authority executes `configureAndActivate(actualEvidence,actualOracle,actualNumber)` once. Service/allocation/principal/evidence/source checks precede activation; failure reverts atomically. It binds the exact official key to the spot oracle and seals configuration permanently. There is no active restaging, upgrade, pause, override or reset. Neither this call nor gate opening resets E/S.

There is no UNLK warm-up or confirmation wait after activation. Successful official swaps evaluate post-swap spot automatically; `hook.checkpoint()` and the compatible `updateMilestone()` can permissionlessly evaluate current state. Permissionless UNLK checkpoints do not replace external `sample()` maintenance. A newly valid reference may justify a checkpoint without a new swap. Do not promise detection of earlier unobserved touches.

## Postflight before any separately authorized live UI

Record canonical receipts, accepted GitHub SHA, chain1 identities, actual init/runtime hashes with resolved immutables, source verification, source/vault/evidence bindings, exact PoolKey/PoolId, complete allocation tree, locked principal and initial opening math. Runtime-template hashes are not deployed runtime hashes. Verify UnlkToken name/symbol/supply/provenance and10/87/3 split; actual router/Quoter/Permit2; all four fee-inclusive trade modes/refunds; claims before synchronization and deduplication; maturity and E/S conservation; gate monotonicity/global final bypass; fee redemption/beneficiary-only withdrawal and LP fee entitlement. Simulate all failure cases with the real deployment configuration before any transaction.

Confirm keeper/gas sponsor operation, source cold-start/gap recovery, feed governance and external market monitoring. At the fork's577-observation size the measured steady sample used~69,959 execution gas plus transaction overhead; at5m this is about26.2M gas/day including21k base, or0.0262 ETH/day at an illustrative1gwei (not a quote). Measured explicit gate checkpoint execution was~135,253 gas in that fixture. Real gas varies with history length, cold/warm accesses, calldata, batching and gas price. Full unlock short-circuits gate reads; source maintenance cannot retroactively close doors.

Only a separately authorized **new reviewed deployment** could supply `web/src/mainnet.ts` with actual candidate addresses and runtime hashes. Candidate writes remain disabled now, and the old live config is untouched. Run browser/mobile/wallet and protected admission checks in an environment that supplies their missing harness/tooling before any hosting decision. A local fork success and this contributor review are not independent security approval or automatic deployment safety.
