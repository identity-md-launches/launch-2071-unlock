# Launch 1534 admission size fix — 2026-10-13

> **Revision 2026-10-13.** The independent review of this restored tree reopened it; `UnlkHook` and `UnlkSwapRouter`
> bytecode changed afterwards (the helper and the other three artifacts did not). The artifact table below is the
> size-fix job's historical record; current sizes and hashes are in `ARTIFACTS.json` and `REVISION_2026-10-13.md`.

This is a source-only continuation of job `672489ef-8304-403f-855c-b9dce583bc31`, for parked Sepolia launch
`55d5370e-7256-465c-808f-09ba4cc8ccee` (1534). It starts from published commit
`f77cf377f6eb58f05ef9b9c61f36407933d5053a` in
[launch-1534-unlock](https://github.com/identity-md-launches/launch-1534-unlock).
The remote HEAD/main and the project's published version both matched that commit on inspection; the only newer
project version was this executing continuation, `0edcb64f-c0cf-4ac9-afed-176758f17cde`.
No old bundle recovery, dependency change, manifest change, token deployment or transaction was performed.

## Fix and compatibility

The [live launch record](https://api.imd.fun/launches/55d5370e-7256-465c-808f-09ba4cc8ccee) reports
`bytecode: HookDeployer is 26264 bytes, over the EIP-170 limit`. Its other saved admission checks passed against
the old commit; those results do not attest this fix. The saved response summary is
[`network/size-fix-status.json`](network/size-fix-status.json).

`HookDeployer` no longer imports `UnlkHook` or embeds its creation code. Both pure methods now take
`bytes memory hookCreationCode, Config calldata config`. `initCode` concatenates the supplied body with exactly
`abi.encode(manager, token, launchFactory, setupAuthority)`; `initCodeHash` hashes that result. The Config layout is
unchanged. The helper has no deployment method, authorization role or mutable configuration. Callers must supply
the reviewed body; it intentionally does not authenticate arbitrary input code. Its ABI has changed, and both
repository callers and `docs/abi/HookDeployer.json` are updated.

Production deployment remains `LaunchFactory.launch`, with manifest constructor placeholders
`$poolManager`, `$token`, `$factory`, `$owner`, and flags **0x3fc0**. `launch.json`, `ReviewedCode.sol`, all five
production contracts, compiler settings and dependencies are unchanged. Both creation bodies and runtime templates
were compared byte for byte with a build of the untouched starting tree; their published Keccak256 hashes also
match. Evidence: [`BYTECODE_COMPARISON_RESULTS.txt`](BYTECODE_COMPARISON_RESULTS.txt). The refreshed source digest
list also includes tests already accepted into f77cf377 and corrects that commit's stale manifest digest; the
manifest file itself is byte-for-byte unchanged.

| Artifact | Creation body bytes | Constructor bytes | Full initcode bytes | Runtime template bytes |
|---|---:|---:|---:|---:|
| UnlkToken | 3444 | 0 | 3444 | 2320 |
| UnlkHook | 25702 | 128 | 25830 | 24328 |
| UnlkSwapRouter | 8102 | 64 | 8166 | 7761 |
| MerkleClaimEvidence | 5943 | 64 | 6007 | 5675 |
| UnlkOracle | 7857 | 96 | 7953 | 7517 |
| HookDeployer | 756 | 0 | 756 | 728 |

The old helper was 26292 creation / 26264 runtime bytes. The hook still has 248 bytes of EIP-170 runtime margin.
All six release artifacts are retained and checked unconditionally: runtime <=24576 and full initcode <=49152.
The prior stricter creation-body `<49152` check is retained. Constructor sizes are derived from each compiled ABI;
an unexpected non-address constructor type fails for sizing review instead of silently undercounting. Compiler
runtime templates include unresolved immutables and are not deployed-code hashes.

## Reproduce

Use the unchanged Foundry configuration (Solidity 0.8.26, Cancun, optimizer 200, metadata hash none) and vendored
dependencies. No network is needed for these project checks:

```sh
forge build
python3 scripts/generate_code_checks.py --check
forge test
python3 -B -m unittest discover -s test -p 'test_release_artifacts.py' -v
forge fmt --check
forge lint src --severity high med
python3 scripts/verify_network.py
python3 scripts/export_abis.py
python3 scripts/release_artifacts.py
sha256sum -c docs/SOURCE_SHA256SUMS
```

`scripts/check.sh` runs this sequence. Results: **175 Foundry tests passed**, including five new encoder regression
tests, plus **five Python release-gate tests passed**. Tests deploy the helper and assert its actual runtime size,
pin the reviewed hook creation hash, compare full encoding/hash, detect changed setup authority and changed code,
and exercise arbitrary supplied bytes/addresses. Release-gate tests reject oversized runtime and creation bodies
for every artifact, count the four constructor words, and cover the exact EVM boundaries. Existing integration,
failure-path, fuzz, invariant, trading, oracle, claims and setup tests all pass. No protected check was edited.

The alternate-seed/four-thread run also passed all 175 tests with only PATH and the existing HOME in the process
environment. PATH alone made the installed Foundry/SVM panic before executing tests (`could not detect user home
directory`); the log retains both attempts. No test reads or sets environment variables. The historical supplied
protected suite and fork records are retained, not represented as newly run: their protected input files are absent
from this assignment. A fresh read-only RPC request to the public Sepolia endpoint returned HTTP 403 Forbidden;
no new fork or current on-chain signer verification is claimed. See [`VALIDATION.md`](VALIDATION.md) for logs.

The original published hash comparison can also be repeated without a second compiler run:

```sh
python3 - <<'PY'
import json, subprocess
base = 'f77cf377f6eb58f05ef9b9c61f36407933d5053a'
before = json.loads(subprocess.check_output(['git', 'show', base + ':docs/ARTIFACTS.json']))['contracts']
after = json.load(open('docs/ARTIFACTS.json'))['contracts']
fields = ('creationBodyBytes', 'creationBodyKeccak256', 'runtimeTemplateBytes', 'runtimeTemplateKeccak256', 'abiSha256')
for name in ('UnlkToken', 'UnlkHook', 'UnlkSwapRouter', 'MerkleClaimEvidence', 'UnlkOracle'):
    assert all(before[name][field] == after[name][field] for field in fields), name
    print(name, 'unchanged')
PY
```

## IMD check, publication and retry

The installed worker `v0.1.0+f0753cb7` supports and successfully ran:

```sh
imd launch check .
```

Its exact output was `launch.json passes the launch check against this build. Slither runs only on the verifier.`
This is the official worker's **local** check, not a service admission rerun, independent review, or broadcast.
The service still records the parked failure against `f77cf377...`. No supported remote re-admission operation was
available in the installed CLI, [public capabilities](https://api.imd.fun/requests/capabilities),
[OpenAPI](https://api.imd.fun/openapi.json), or [launch API documentation](https://imd.fun/docs/).
These interfaces do not document a parked-launch retry endpoint. None was guessed or called.

The documented `job.continue` operation publishes the accepted source into the existing project repository via a
fast-forwarded pull request; it does **not** redeploy or retry a launch. This assignment protects `.git/`, and the
worker exposes no code-publication command for this submission. Therefore no new published fix commit can be
truthfully named during this implementation step. `publicationCommit` remains null until IMD's publisher returns
the actual accepted fix SHA. The old SHA is the base, not the fix.

After acceptance and review, the publisher must record the actual new SHA and PR in this project's delivery
record (`GET /jobs/0edcb64f-c0cf-4ac9-afed-176758f17cde`). The remaining release operation is for IMD's launch
operator to establish its supported retry procedure for **the same parked launch 1534**, pin that reviewed fixed
SHA, and rerun its full service admission. An exact operator command/endpoint is unconfirmed and is not invented
here. Do not use `launch.open` to create another token, or describe another `job.continue` as re-admission. A passing
local check alone is insufficient to change `stage1BroadcastAllowed`.

## Sepolia activation remains gated

The launch API identifies requester **0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9**, matching the original job payer
and manifest's intended `$owner`. That wallet must control the immutable `hook.setupAuthority()` and sign both
`deployCompanions(1534, feed, routerCode, evidenceCode, oracleCode)` and
`configureAndActivate(stagedRouter, stagedRewards, stagedOracle, 1534)`. The feed and reviewed creation bodies are
specified in [`DEPLOYMENT.md`](DEPLOYMENT.md); the hook derives the companion constructor arguments from stage 1.
The helper is neither signer nor factory. The previously verified factory signer is
`0xcecc29b037f5064fcdf45a5c318f132ef76aa551`; the operator must reread `factory.deployer()` on Sepolia before release.

Between those two owner calls, a wallet must certify the **actual complete round-0 tree** on the staged evidence
contract. This is permissionless: `certifyRound(0, accounts, amounts)` for up to 1024 unique recipients, or
`submitLeaves`/`reduce` for larger trees. The owner may perform it as in `Stage2.run`, but no certification signer
has committed to execution here. Although the old admission summary mentions 457 allocations, the current public
response with `claims=1` has `claims`, `merkleRoot`, and `rewardSnapshot` null; its root prefix is not a usable tree.
The exact certificate/calldata cannot be supplied yet. No synthetic leaves or stand-in addresses are release inputs.

Before any broadcast, the operator must secure the owner's executable signing path and certificate submitter,
retrieve and validate the frozen tree, resolve stage-1 outputs and verify the actual setup authority, and record
the reviewed transactions. The existing scripts provide calldata and simulation, not signatures or authorization.
Independent review and the unresolved **protocol-fee halt**, **treasury powers to issue quota-bearing reward
rounds**, and **sustained manipulation/unlock-and-exit economics** remain release decisions in
[`SECURITY_REVIEW.md`](SECURITY_REVIEW.md). This size fix neither changes those behaviors nor accepts their risks.
No mainnet or Sepolia transaction was sent, no token was replaced, and trading is not active.
