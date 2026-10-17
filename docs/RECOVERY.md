# Recovery and reconciliation

Revision of 2026-10-13 (reviewer findings a4b5f9a2, d8778e80, 66b99dca, 153c7ae8 fixed; d0e68f0c and 0147f1a4
answered as documented decisions): `src/libraries/SeedDepth.sol` added; `UnlkHook`, `UnlkOracle` and
`MerkleClaimEvidence` changed, so `ReviewedCode` (ORACLE, EVIDENCE) and every artifact digest were regenerated.
The responses are in `.imd-responses.json`.

Retrieval succeeded on 2026-10-13. **No bundle or clone retrieval error occurred.**

| Input | SHA-256 of downloaded bytes | Commit |
|---|---|---|
| [Implementation bundle](https://api.imd.fun/bundles/0dcbb533b92aca62ac0ac07e8dd827a7fdb68988b0fa974bbd6394383de697ee) | `0dcbb533b92aca62ac0ac07e8dd827a7fdb68988b0fa974bbd6394383de697ee` | `8bc47cb68deda948f5c2fb1e9a5182bb187d6759` |
| [Manifest bundle](https://api.imd.fun/bundles/b89b110f9d9d6236d2570c90bf61be79d183e8827ffa15b7500438e6721176c1) | `b89b110f9d9d6236d2570c90bf61be79d183e8827ffa15b7500438e6721176c1` | `7a5e1dc79d05ba7fbeb9166be036cb25b302079e` |

Cloned `https://github.com/identity-md-launches/launch-1401-build-deploy-unlock-unlk` into a temporary directory.
`git cat-file -t 0243d7da4a4337ae8b16bcdf15bb4ead736fd68f` returned `commit`.
Both `git bundle verify` calls returned “is okay”, naming that prerequisite and the expected `imd-submission` head.
Fetched heads under separate temporary `refs/recovery/implementation/*` and `refs/recovery/manifest/*` namespaces.
Exported the complete implementation commit with `git archive`: **428 files**. Overlaid **only `launch.json`** from
the manifest commit, making **429 starting files**. Rejected unsafe archive paths/symlinks before extraction.
The workspace `.git`, protected inputs and prohibited paths were not modified. No submodule was introduced.

The implementation's parent `384592706553d2fe392159a128990d1b57b0c454` merges accepted implementation
`8f5039aad1d6d08792b641fef3b17c87bf78121b` and tests `cc58807ba13d87217394c7c951f0d64e9c05c3ad`.
Commit `8bc47cb` adds the complete `EvidenceAndOracleProperties.t.sol` suite over that merge. The manifest's parent
`20a99d3a8eb19b65b0cb3f1276c13f4ae0d70b7c` merges the same implementation with manifest work
`db80b0fe184abe0e848695e1c44a7221dee7610e`. The temporary upstream main branch still points to the empty workspace;
it is not a newer accepted implementation. No launch-1309 checkout was used.

This repair retains the four-argument constructor, delayed companion binding, 90-minute feed freshness allowance,
five-minute read freshness, transfer/native-claim independence, executed-delta quota enforcement, pull ETH refunds,
principal lock and all meaningful recovered tests. The old payer-balance restriction is deliberately replaced by
historical transfer receipts, so a legitimate early transfer no longer strands activation. Invalid observations
leave achieved tiers and the visible pending start intact, but explicitly interrupt that pending run; later valid
observations cannot count a known-invalid interval. The authorized sequential-tier, TWAP and depth redesign replaces
tests that had merely demonstrated the old unresolved vulnerabilities with assertions of the repaired behavior.

The restored manifest's “91 tests” was stale; the recovered source actually ran **124 passing tests** before edits.
Current evidence is in `VALIDATION.md`, not the inherited log totals.

The inherited 100M per-wallet cumulative reward cap was also reconciled: it rejected genuine, independently
funded later rounds supported by the actual distributor. The repaired adapter authenticates complete unique
trees and actual native claims, and synchronization now accepts those cumulative claims without an arbitrary
ceiling. Tests exercise funded later rounds and ensure decreasing/corrupt evidence cannot revoke earned rights.

## Discovery errors (separate from successful recovery)

These public read attempts returned exactly the following errors; none was used as proof of identity:

* `https://api.imd.fun/config`: `HTTP Error 404: Not Found`.
* `https://api.imd.fun/launches/1401`: `HTTP Error 400: Bad Request` (endpoint takes a UUID).
* `https://api.imd.fun/launches/672489ef-8304-403f-855c-b9dce583bc31`: `HTTP Error 404: Not Found` (this is a job UUID).
* `https://explorer.imd.fun/launch/1401`: `HTTP Error 404: Not Found`.
* `https://api.imd.fun/imd-deployment.json`: `HTTP Error 404: Not Found`.
* Sourcify v2 `/contract/11155111/{address}?fields=all` for `0x84cf2bc1dc2af577dba5d62e26f90d041ca38f7a`,
  `0x56b00dc6197139e21197fa727df75d0c1b2c03b4`, `0x315752fee5cbcaa00333e0d4d91e0cd69429e908`, and
  `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`: `HTTP Error 404: Not Found`.
* Blockscout `/api/v2/smart-contracts/{address}` for the first factory candidate and manager:
  `HTTP Error 403: Forbidden`.
* `projectPoolFee()` on the fee-settings contract: `Error: server returned an error response: error code 3:
  execution reverted`. Its correct getter is `poolFee()`.

The public docs corrected the first candidate: `0x84cf…F7A` is a **ProjectFactory**, not a hook LaunchFactory.
The historical launch-684 transaction identified `0x56b0…03b4`, whose deployer is the old signer. The **current**
publicly documented factory is `0x315752…E908`, and its executable code matches the verified factory source build.
