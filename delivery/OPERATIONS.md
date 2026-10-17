# Reproduction and operations for the new launch

The source was the exact published fixed commit; revision 2026-10-13 then changed `UnlkHook` and `UnlkSwapRouter` (see [../docs/REVISION_2026-10-13.md](../docs/REVISION_2026-10-13.md)), so `delivery/verify.py`'s published-source comparison now reports those files and the regenerated records as changed, by design. Use the exported artifact records in `docs/ARTIFACTS.json` and the reviewed creation hashes in `src/libraries/ReviewedCode.sol` from the current build. Do not apply the historical instruction to retry launch 1534. No command below establishes wallet control or waives independent review. Release is gated as recorded in [../DELIVERY.md](../DELIVERY.md).

## Offline reproduction

From the repository root, with installed Foundry 1.8.3 and Solidity 0.8.26:

```sh
forge build
forge test
python3 -B -m unittest discover -s test -p 'test_release_artifacts.py' -v
forge fmt --check
forge fmt --check delivery/rehearsal/RecordedSepolia.t.sol
python3 scripts/generate_code_checks.py --check
python3 scripts/verify_network.py
python3 delivery/verify.py
sha256sum -c docs/SOURCE_SHA256SUMS
```

`delivery/verify.py` reconstructs all 498 original file blobs/modes and their Git tree, compares the six complete compiled artifact records and ABIs, includes constructor words in initcode sizing, and checks the additional exported hex files. It writes nothing and needs no network. There are no new library dependencies, submodules, compiler binaries, FFI or filesystem permissions.

The protected suite is external input. When present, reproduce it without editing it:

```sh
python3 scripts/check_protected.py .imd/reads/protected/univ4_hook
```

That supplied suite intentionally consumes test-probe environment variables in a separate process. The 175 delivered Solidity tests use neither environment reads/writes nor live RPC. The suite runner copies protected files only into `test/scratch/` and removes its copies. Input SHA-256 values are in `protected-inputs.json`; actual inputs are not republished.

To rebuild the canonical platform contracts from the fully embedded verified compiler input, supply the path to the **installed** compiler, not a repository binary:

```sh
python3 delivery/verify.py --solc /home/imd/.svm/0.8.26/solc-0.8.26
```

This optional flag does not change Foundry's compiler setting. The script checks the compiler version and uses standard JSON content only, with no import callback.

## Read-only network reproduction

```sh
python3 delivery/verify.py --rpc-url "$SEPOLIA_ARCHIVE_RPC"
FOUNDRY_TEST=delivery/rehearsal forge test \
  --fork-url "$SEPOLIA_ARCHIVE_RPC" --fork-block-number 11905741 \
  --match-contract RecordedSepoliaRehearsal -vv
```

The harness enforces the chain, recorded block, code pins and authorized factory sender. It never signs or broadcasts. Use an archive-capable endpoint for later reproduction. Three direct Python HTTP RPC attempts returned 403; Foundry/cast access to PublicNode worked. The older block's unavailable historical state is logged separately from the passing fresh-block runs. Recorded-state verification does not establish that today's state is unchanged: rerun current policy, code, signer, feed and registry checks immediately before release, and record the new block/hash.

## Stage 1 prerequisites and outputs

The active job is `407c3cbb-d967-4666-99e6-0ab7139c141f`; its [public record](https://api.imd.fun/jobs/407c3cbb-d967-4666-99e6-0ab7139c141f) requests `univ4_hook` on 11155111. Its initial version metadata still refers to the platform's empty base rather than the requested source. Restoration fixes the workspace; it does not pretend to rewrite that server field. [provenance.json](provenance.json) and the source import response bind the actual required source. The platform must attest the restored tree and preserve `univ4_hook`, not convert the import to `evm_contracts` or repeat a payment.

Before any broadcast, complete independent review and resolve the disclosed release risks, record a concrete owner-wallet signing path, confirm the certificate submitter, freeze the actual new launch's allocation tree, and validate every unique recipient and its total. Match round 0 to exactly 100M UNLK and the actual factory root; verify release and sweep times from the new policy/launch record. Rehearsal identities and allocations are never release inputs.

The authorized `factory.deployer()` signs `LaunchFactory.launch(LaunchParams)` with the actual new number, complete attestation, source/manifest hashes, root, payer, policy and correctly mined hook salt. The hook constructor remains `($poolManager,$token,$factory,$owner)`, and flags remain `0x3fc0`. The native currency address is zero by protocol; all contract identities must be real. Derive the opening price from the 20 ETH policy cap and token ordering, not the manifest's 1:1 field. Factory code creates and distributes the token, creates the native distributor, initializes the official pool with the hook and locks seed principal in one atomic transaction.

Capture the actual `Launched` event, transaction receipt, registry artifacts, source attestation and factory position. Check token supply/distribution receipts, actual remainder recipient, manager, hook flags, seed amount/range/depth, fee tier and protocol fee. PoolKey is `(native ETH, actual token, 12500, 60, actual hook)`; PoolId is `keccak256(abi.encode(PoolKey))`. No deployable address or new number exists in this package. Read `hook.setupAuthority()` before constructing any owner transaction.

## Stage 2: concrete signing sequence

Use the actual recorded hook/number and the exact compiler creation bodies exported under `delivery/artifacts/`. The setup wallet identified by `hook.setupAuthority()` signs:

```text
hook.deployCompanions(
    actualLaunchNumber,
    verifiedSepoliaEthUsdFeed,
    UnlkSwapRouter.creation.hex,
    MerkleClaimEvidence.creation.hex,
    UnlkOracle.creation.hex
)
```

These are byte arrays, not paths passed to Solidity. `Stage2.deploymentCall(Config)` already constructs the ABI-encoded call from the reviewed compiled code. The hook checks the pinned creation hashes and derives all constructor identities from actual stage-1 records. Record `CompanionsDeployed` and resolve `stagedRouter()`, `stagedRewards()`, `stagedOracle()` before proceeding.

Certify the actual complete frozen root on the **actual staged evidence contract**. For up to 1024 recipients, the existing `scripts/prepare_claim_tree.py` validates/reorders a supplied `claims` object and outputs arrays in heap leaf order. It does not authenticate their association with this new launch; compare the root to the actual native distributor and platform attestation. It has a 1024-row CLI limit. For a larger tree the reviewed contract supports the following explicit chunked path, but the platform must supply/validate the complete heap-ordered arrays instead of passing the large file to that small-tree CLI:

```text
stagedRewards.submitLeaves(0, totalRecipientCount, accountsChunk, amountsChunk)
    repeated in heap leaf order, e.g. 500 leaves per transaction
stagedRewards.reduce(0, internalNodeCount)
    repeated, e.g. 800 nodes per transaction, until certified(0) == true
```

All chunks and reductions must use the same submitter wallet/session. Every recipient must be unique across the whole tree. The same on-chain functions are tested with 1500 leaves in the unchanged project suite. For either path require the final `Certified(0, actualRoot, actualRecipientCount)` event and `certified(0)` before activation. Native eligibility and claims remain independent of certification/credit synchronization.

The immutable setup wallet then signs:

```text
hook.configureAndActivate(stagedRouter, stagedRewards, stagedOracle, actualLaunchNumber)
```

For a complete tree within the single-call limit, the delivered script executes all three operations:

```sh
forge script script/Stage2.s.sol:Stage2 \
  --sig 'run(address,uint64,address[],uint256[])' \
  "$UNLK_HOOK" "$UNLK_NUMBER" "$CERTIFIED_ACCOUNTS" "$CERTIFIED_AMOUNTS" \
  --rpc-url "$SEPOLIA_RPC" --account "$OWNER_KEYSTORE" --broadcast
```

The named variables must be populated from actual launch records and the complete certificate; there are no example addresses or invented numbers. The owner keeps its keystore and signs locally. Hardware-wallet or multisig execution can use the same ABI calldata, addressed to the real hook/evidence contracts. **No such wallet access or signing commitment has been verified in this run.** This is a concrete operator method, not a claim that a service can already execute it. Public service presence alone is insufficient. No private key should be supplied to the contributor.

Do not blindly rerun the combined script after a partially completed owner sequence: before activation, another `deployCompanions` call stages a fresh bundle. Resume against the actual staged addresses and certification state. Successful activation seals setup permanently; a failed activation transaction rolls back its writes. Native claims made earlier remain provable and creditable exactly once after certification/activation.

## Public postflight and publication

Require successful receipts and `Activated`, then independently read all settings and reciprocal bindings. The existing `CheckReleaseConfig.run(hook,11155111,managerCodeHash,feedCodeHash)` supplies an executable read-only gate. Verify actual runtime code with immutable values, creation inputs, PoolKey/PoolId, token supply, native distributor and roots, staged companions, policy fees, zero protocol fee, original seed principal, payer identity and allocation provenance. Submit the exact compiler input/arguments to the Sepolia source-verification service and retain explorer receipts; no new address can be source-verified before it exists.

Use funded, authorized public test wallets to buy, sell within quota, reject excess sales, transfer to a holder without E and reject its restricted sale, claim an actually eligible native allocation after its real `unlocksAt`, attest/sync once and sell within the resulting quota. Check 80/20 fee collection rights and unchanged seed principal. Record receipts and before/after E/S/balances; no timestamp warp is a public test. The permanent all-holder bypass and invalid-data/decline behavior are already covered locally; do not force milestones or alter parameters to create public evidence.

Publish this package through the current job's accepted-delivery publisher and record its returned repository/commit/PR. Then fill the public deployment/activation/verification fields from actual records. Until that happens, these fields stay null and `stage1BroadcastAllowed` stays false. This repository contains no fabricated signature, deployment transaction, launch number or live success claim.
