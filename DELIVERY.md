# UNLOCK / UNLK — new Sepolia launch handoff

## Revision 2026-10-13 — independent review findings

The restored tree below was accepted by the verifier and then reopened by an independent reviewer. Both findings
reproduced and are fixed; the answers are in `.imd-responses.json` and the full record, with hashes and evidence,
in [docs/REVISION_2026-10-13.md](docs/REVISION_2026-10-13.md). **`UnlkHook` and `UnlkSwapRouter` bytecode now
differ from commit `f0149886`**; the token, claim evidence, oracle and helper are byte-for-byte unchanged, and
`launch.json`, `foundry.toml`, `remappings.txt` and all dependencies are untouched.

* Stage 1 (`beforeInitialize`) now runs the same Sepolia service pin check as stage 2, so a launch through an
  unpinned factory, manager, fees or registry reverts in the launch transaction instead of locking the seed in a
  pool that can never activate. Hook runtime 24,359 bytes (217 bytes of margin), creation body
  `0x1e5ea98995bd91262452ad1a8512eae97e9a02a05920b89f839d440a05f8dd2d`.
* The router bounds every swap's price limit to the seed range, so a reserve-draining sell ends at the seed's
  upper boundary (the launch state, liquid) instead of tick 887271. Router runtime 8,831 bytes;
  `ReviewedCode.ROUTER` is `0x68dfbfa49b0d0140c963870ece6b83a375b00eaeddd64259ad1759ceb3a153c1`.
* Fresh results: 208 delivered Foundry tests pass (209 with the reviewer's proof copied under `test/scratch/`),
  the unmodified protected suite passes (11), the Python release gate passes (5), `forge fmt --check` passes, and
  both stages pass on a recorded Sepolia fork through the real factory at block **11,906,030**
  (`delivery/checks/revision-*.txt`). `delivery/verify.py`'s source comparison now reports the revised files, by
  design; [delivery/STATUS.json](delivery/STATUS.json) lists them under `revision.changedFiles`.
* Nothing was broadcast. Independent re-review of the revised build is a release gate. No economic, oracle or
  policy rule changed, and the disclosed release risks stand.

The sections below are the record of the restored commit as delivered before this revision.

**The fixed published project is restored and verified. No public launch transaction was sent; trading is not active.** This delivery belongs to new job `407c3cbb-d967-4666-99e6-0ab7139c141f`, not a continuation or retry of launch 1534. It contains the completed source/package and the exact remaining release failures. [Machine-readable current status](delivery/STATUS.json).

All **498 files** from [published commit `f0149886ac3c09b57a0e1d676582e6aeaeb7a69f`](https://github.com/identity-md-launches/launch-1534-unlock/commit/f0149886ac3c09b57a0e1d676582e6aeaeb7a69f) are byte-for-byte intact, including the four-argument hook constructor, small helper, fixed encoder, manifest, compiler settings, dependencies and tests. They reconstruct Git tree `0710257dd00656d130b4c56b7a669734955bb1ef`. Workspace Git metadata and protected inputs were not modified. Dependencies are ordinary files, not submodules. No old bundle or pre-fix source was imported.

The original `README.md`, `RELEASE_STATUS.json`, manifest notes and `docs/` are preserved historical records of the source commit. Their references to retrying 1534, unpublished fixes, earlier test counts and earlier forks do **not** describe this new request. This file and `delivery/STATUS.json` report this assignment. Nothing in the restored documentation authorizes a different operation.

## Provenance and validation

The GitHub commit API, complete recursive tree and archive were fetched at the required SHA. Every archive file was checked against its Git blob before restoration. [Provenance](delivery/provenance.json) records the archive SHA-256 and [per-file hashes/modes](delivery/source-files.json). The fix job's [public delivery record](https://api.imd.fun/jobs/0edcb64f-c0cf-4ac9-afed-176758f17cde) confirms that SHA and [PR 2](https://github.com/identity-md-launches/launch-1534-unlock/pull/2). Its accepted build verification is not an independent security audit or this new launch's service admission.

| Fresh check | Result | Evidence |
|---|---|---|
| `forge build`, pinned Solidity 0.8.26 | Pass | [build](delivery/checks/build.txt) |
| `forge test` | 175 passed, zero failed/skipped, 38 suites | [tests](delivery/checks/test.txt) |
| Five Python release-gate tests | Pass, including negative size cases for every release artifact | [release gates](delivery/checks/release-gates.txt) |
| Unmodified supplied protected checks | 11 passed, zero failed/skipped | [protected tests](delivery/checks/protected.txt) |
| Minimal environment, four threads, alternate fuzz seed | 175 passed | [second run](delivery/checks/minimal-environment.txt) |
| `forge fmt --check` | Pass | [format](delivery/checks/fmt.txt) |
| `imd launch check .` | Pass **locally**; not service admission | [worker output](delivery/checks/imd-launch.txt) |
| Source tree, code/ABI hashes, all six release sizes | Match the fixed commit | [integrity](delivery/checks/integrity.txt) |
| Canonical platform source rebuild, Solidity 0.8.26 | Factory, registry, fees and distributor match the saved verified build | [platform rebuild](delivery/network/platform-rebuild.json) |
| Current recorded-block fork, both stages | Pass | [extended fork](delivery/checks/extended-fork.txt) |

The source lint completed with existing warnings; [output](delivery/checks/lint.txt) and the original [triage](docs/SECURITY_REVIEW.md) are included. Slither/Mythril/formal verification were not run by this contributor. The worker explicitly reserves Slither for its verifier. These results carry no independent review authority.

All default build/test work is offline, with the unchanged `foundry.toml`: compiler 0.8.26, Cancun, optimizer 200, metadata hash none, no FFI or filesystem cheatcode permission. [Reproduction commands](delivery/OPERATIONS.md) include a verifier that reconstructs the complete original Git tree without touching `.git`.

| Release artifact | Creation body | Constructor bytes | Full initcode | Runtime template |
|---|---:|---:|---:|---:|
| UnlkToken | 3444 | 0 | 3444 | 2320 |
| UnlkHook | 25702 | 128 | 25830 | 24328 |
| UnlkSwapRouter | 8102 | 64 | 8166 | 7761 |
| MerkleClaimEvidence | 5943 | 64 | 6007 | 5675 |
| UnlkOracle | 7857 | 96 | 7953 | 7517 |
| HookDeployer | 756 | 0 | 756 | 728 |

No release artifact is exempted from EIP-170 or full EIP-3860 sizing. The hook has 248 bytes of runtime margin. [Creation code and runtime templates](delivery/artifacts/), [artifact hashes](delivery/artifacts/release.json), and [20 ABIs](docs/abi/) are included. Runtime templates contain unresolved immutables and are not public deployment hashes. All production bytes and ABIs match the requested fixed commit.

## Current Sepolia verification and fork

Read-only verification recorded block **11,905,741**, hash `0xcc877e036fb2058b121c8f86b5524536f60bca8ef5de5644520358962644091c`, timestamp `2026-10-13T11:21:24Z`. [Complete calls, results and code hashes](delivery/network/preflight.json). The selected [current policy 32](delivery/network/selected-policy.json) matches the published policy: 20 ETH opening FDV, 12500 fee tier, 1 billion supply, 10% contributor share, 3600-second contributor lock. The request specifies poolBps **8700** and payer remainder. Native ETH's zero currency address denotes the pair, not a missing identity.

| Existing infrastructure | Address |
|---|---|
| Hook factory | [0x315752fEE5cBcAA00333E0d4d91E0cD69429E908](https://sepolia.etherscan.io/address/0x315752fEE5cBcAA00333E0d4d91E0cD69429E908) |
| Registry | [0x78BA7bDcC66715D0f6E425b4700207A0b75aD5a4](https://sepolia.etherscan.io/address/0x78BA7bDcC66715D0f6E425b4700207A0b75aD5a4) |
| LaunchFees | [0x428Ff16D1bb25d6674463881ed6a62BD09e30584](https://sepolia.etherscan.io/address/0x428Ff16D1bb25d6674463881ed6a62BD09e30584) |
| PoolManager | [0xE03A1074c86CFeDd5C142C4F04F1a1536e203543](https://sepolia.etherscan.io/address/0xE03A1074c86CFeDd5C142C4F04F1a1536e203543) |
| ETH/USD feed | [0x694AA1769357215DE4FAC081bf1f309aDC325306](https://sepolia.etherscan.io/address/0x694AA1769357215DE4FAC081bf1f309aDC325306) |

All five live runtime hashes match the existing pins. Factory/registry/manager/fees bindings and `registry.writer()` were checked. `factory.deployer()` is currently `0xcECc29B037f5064fCdF45a5C318F132ef76aA551`. The **current job's** payer is independently reported as `0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9`; it is the intended `$owner` and remainder recipient, not an identity inferred solely from old documentation. The actual new launch must confirm these substitutions.

The factory's native distributor creation hash is `0xf1c21108732a73286b1030e87fbba14c806905275dde6fce012f2c0ca19e30b9`, matching the independently recompiled canonical platform input. The project's local distributor fixture has a different build and was not substituted for that live code. Manager source was not independently rebuilt; its full runtime is pinned and exercised on the fork. Feed proxy code matches the pin; [round validation](delivery/network/feed-check.json) finds positive/coherent ETH/USD data aged 3156 seconds at the recorded block. Proxy governance can still change its aggregator.

The published historical fork harness still calls the encoder's old one-argument ABI; its [compiler error](delivery/checks/upstream-rehearsal-build.txt) is retained. The original block 11,904,506 also failed with `historical state ... is not available` on this endpoint. A separate [delivery harness](delivery/rehearsal/RecordedSepolia.t.sol) supplies the reviewed creation body, uses the freshly recorded block and extends the behavioral checks. Original source files remain unchanged.

The extended fork uses the actual factory, signer, manager and feed, with **local impersonation and a synthetic test-only launch number/tree**. Its complete one-recipient tree allocates the entire 100M contributor share. It proves pre-activation transfer/claim behavior, claim-time enforcement, rejected early synchronization/milestones, failed activation rollback, certification, reciprocal bindings, successful permanent sealing, buys, permitted/excess sells, transfer-only rejection, pre-activation claim credit exactly once followed by a sale, 80/20 LP fee payout and principal protection. No public transactions or signatures were produced. The logged addresses and PoolId are **fork-only** and must never be presented as this new launch's public outputs. Claim time was advanced locally; public tests must wait for actual release timestamps. After time travel, the frozen feed may become stale; this does not block claims/trades or grant milestones.

The fork derives the spacing-rounded opening price from the 20 ETH policy: sqrtPriceX96 `560670463299104726496887759586116`, approximately 19.968425 ETH FDV. The manifest's 1:1 string is not a deployment price. The tested seed receives `869999999999999999999997987` minor units (2013 wei of token rounding goes to the payer), with 17.372529781893206513 ETH opening-value capacity. Production retains the reviewed 99–100% pool-allocation band, exact 10% distribution and fixed 30M payer credit; rounding creates no extra credit.

## Exact remaining release failures

1. **Independent review is pending.** The current job's economics, flow, math, permissions and judge nodes are waiting on this implementation. The fix job's build check and prior launch reviews do not replace them. The [saved job record](delivery/network/current-job.json) identifies this dependency; no reviewer approval has been fabricated.
2. **Supported import resolves the SHA, but launch preflight fails.** `POST /requests/import` successfully returned the required repository and SHA. `POST /requests/check` with `onchain: univ4_hook`, Sepolia, ETH, poolBps 8700 and those source fields returned `kind: hook`, `judged: false`, an empty plan, and `bad_path_count: expected between 1 and 16 allowed paths` for both `impl` and `tests`. Supplying 16 explicit paths returned the same errors. [Requests and responses](delivery/network/import-check-paths-response.json) are saved. No paid order, `job.continue`, retry or substitute launch was issued. The current job still has the correct launch kind; this check does not amend its initial source metadata.
3. **New launch admission/records do not exist yet.** The current job reports `launch.id: null`. There is no verified new launch number, attestation, frozen round-0 tree, sweep schedule or stage-1 transaction. These are platform outputs, not requester-supplied guessed values. They must be generated for this new launch after review, with the restored source pinned.
4. **Executable owner-wallet activation has not been established.** The local tool registry reports no configured signing tools. Public services are listed, but the documented APIs expose no post-launch owner transaction executor. The supplied `Stage2` script and the exact wallet operations in [OPERATIONS.md](delivery/OPERATIONS.md) are executable code; their availability does not prove an authorized wallet can sign in this run. A committed owner execution path and certificate submitter must be recorded before stage 1. No private key was requested or read.

Stage 1 remains **not authorized for release by the completed gates**. Its eventual authorized factory transaction must include this hook in the PoolKey from initialization. Stage 1 alone would mean **“pool deployed, trading inactive.”** There are no public token/hook/distributor/companion addresses, deployment transactions, new PoolKey/PoolId, explorer source-verification receipts or sealed activation evidence to report. Their absence is explicit in the status JSON.

The publisher must publish this supplemental handoff after acceptance and record the returned commit in the current job. The existing fixed source SHA is already published; no new publication commit is invented here. The installed worker exposes only a local launch check, not a command to publish this assignment or execute owner signatures.

## Preserved risks and responsibilities

This request has not waived the outstanding release decisions in [SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md). Sustained price manipulation can still earn permanent unlock: the existing local quiet-market simulation spends about 181.21 ETH gross over 56 simulated hours and loses about 2.47 ETH before fee recovery, or about 0.65325 ETH for a payer recovering its native fee share. It is not evidence of independently established market value. A protocol-fee change can halt official trading; the external treasury can open funded reward rounds whose actual certified claims create quota; and unrestricted ERC-20 transfers permit other-pool bypass. Feed governance and the owner's ability to withhold initial activation remain trust dependencies. No economics/oracle setting, exemption, upgrade, pause, withdrawal right or counter reset was added.

IMD owns review, policy/attestation, new launch allocation, factory signing, publication and receipt recording. The immutable setup wallet owns the two setup signatures; a confirmed submitter certifies the actual complete unique-recipient tree. The operator verifies actual deployment code, source verification, LP fee rights, claims and all postflight results. Local tests and this package are **not a claim of production safety**.
