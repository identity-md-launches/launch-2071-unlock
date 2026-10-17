# UNLOCK / UNLK — candidate source, release blocked

This repository preserves the sealed UNLOCK contracts and live frontend from commit `92e55dfe1d4b5863ceed2f744f4279942375fe65`, and adds an **undeployed candidate** with a fixed 75 bps native-ETH NFT treasury fee, sixteen unlocking thresholds, a fixed-beneficiary vault, and frontend source. No transaction was broadcast and no website was published.

**Standard Universal Router compatibility is not solved.** At Sepolia block 11918468, the real router executes `0x10 / 0x060c0f` and `0x10 / 0x060c0e` with identical hook observations but different token recipients. Permit2 funding and router prefunding also produce identical observations with different actual sources. Crediting `msgSender()` would silently change the requested accounting. The candidate therefore rejects unauthenticated routes. Its experimental companion router is a testable fee/accounting implementation, not an accepted substitute for standard Uniswap compatibility. See the [counterexample and required design decision](docs/candidate/COMPATIBILITY.md).

The useful independent work is implemented and tested:

- `src/candidate/`: ETH fee accounting, four swap modes, fresh-manager claim settlement, immutable vault, sixteen tiers, authenticated setup and bytecode pins. The original `src/` contracts are unchanged.
- `test/candidate/` and `test/compatibility/`: unit, fuzz, invariant, recorded-runtime and route-ambiguity tests. `rehearsal/candidate/` adds public, read-only Sepolia fork tests.
- `web/src/`: preserved English live interface plus an undeployed candidate preview, verified ledger reader, fee calculator, and paginated mainnet treasury NFT gallery. Live rules retain the original 25% start, seven rates and no NFT hook fee.
- `dist-candidate/`: reproducible candidate frontend output. The original `dist/` is preserved.
- [Economics and operational rules](docs/candidate/ECONOMICS.md), [setup and deployment handoff](docs/candidate/DEPLOYMENT.md), [validation](docs/candidate/VALIDATION.md), [security review status](docs/candidate/SECURITY_REVIEW.md), [ABIs and artifact hashes](docs/candidate/ARTIFACTS.json), and [candidate manifest](docs/candidate/release-plan.json).

## Reproduce locally without network

The compiler remains pinned to Solidity 0.8.26, Cancun, optimizer 200. Solidity libraries and the frontend build/typechecking dependencies are ordinary vendored files. Foundry, its pinned compiler, Python 3 and Node must already be available; no install is needed by these commands. No FFI or filesystem cheatcode access is enabled.

```sh
forge build
forge test --fuzz-seed 0x1fb1bda21a2a44ee9da3a358da09a0668c5135bb35baa2d687f3bfba01fc2fde
forge fmt --check
bash scripts/candidate/check.sh
```

For the separate, network-dependent historical fork reproduction:

```sh
bash scripts/candidate/fork.sh
```

It uses `https://ethereum-sepolia-rpc.publicnode.com` at block 11918468 and never signs or broadcasts. Default tests remain offline. See [toolchain provenance](web/vendor/README.md).

The [upload-size repair](docs/candidate/BUNDLE_SIZE.md) retains both frontend exports and all application/contract sources. Compiler payloads restore automatically from verified, lossless compressed files; no network or existing scratch cache is needed. `python3 scripts/candidate/bundle-size.py` checks a full-source archive against the 8 MiB limit.

## Release boundaries

Release is blocked by the standard-router attribution design and pending independent adversarial review. Critical/high findings block release. The candidate deployment config is intentionally absent, not a dummy address. Future keys or addresses are not needed to build this source. New deployment and website publication are separate, later authorizations after the blocker is resolved and the exact artifacts are reviewed.

No GitHub commit was created: this assignment forbids touching `.git/`. The contributor upload/commit step must commit these ordinary files; no commit identifier is invented here. Source provenance and preserved-file hashes are in [docs/provenance](docs/provenance/source.json). The public repository HEAD observed on 2026-10-15 was the requested commit; its accepted fixes were retained. No newer public accepted commit was found.

The root `launch.json`, `RELEASE_STATUS.json`, `DELIVERY.md`, pre-existing `docs/` reports and archived [pinned README](docs/provenance/README.pinned.md) describe the historical release, **not this candidate**. Do not use their approval or address statements as candidate release authorization. Candidate reports are under `docs/candidate/`.
