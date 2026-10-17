# Manifest notes admission repair

The reported `launch_manifest` rejection is reproduced: `launch.json.notes` contained 4,532 characters, exceeding the 4,000-character maximum. The local manifest checker previously omitted that constraint. Adding the constraint made its current-manifest regression fail on the original notes before the notes were changed.

The notes now contain **3,757 UTF-16 code units**, leaving 243 units of headroom. Only the notes field changed in the manifest. Constructor bindings, token identity, all ten permissions, IMD currency, fee, tick spacing and initial price are preserved. The condensed text retains the source binding, identities, allocations, activation boundaries, fees and effective totals, quota/gate schedule, accepted manipulation risks and pending release operations. Detailed evidence remains in the parent [report](../REPORT.md).

`scripts/mainnet/check-manifest.py` now rejects non-string notes and notes longer than 4,000 JavaScript UTF-16 code units. Regression cases accept exactly 4,000 units and reject 4,001, including supplementary Unicode characters that occupy two units. No dependency was added and no Solidity source or Foundry configuration changed.

Fresh local checks:

| Check | Result | Evidence |
| --- | --- | --- |
| `forge build` (pinned Solidity 0.8.26) | Passed | [build.txt](build.txt) |
| `forge test --fuzz-seed 0xbf84f3f21fd6f3e756b5aa1b53feb5a083e16964a7b58fcc36f0bcbdb81e70bd` | 479 passed, 0 failed, 0 skipped; 94 suites | [full-suite.txt](full-suite.txt) |
| `forge fmt --check` | Passed | [format.txt](format.txt) |
| Offline mainnet manifest/constructor check | Passed; notes 3,757/4,000 | [manifest.txt](manifest.txt) |
| Python manifest regressions | 5 passed | [python-manifest.txt](python-manifest.txt) |
| Python release artifact regressions | 5 passed | [python-artifacts.txt](python-artifacts.txt) |
| Creation commitments, bytecode sizes and linking | Passed | [artifacts.txt](artifacts.txt) |

All eight release contracts retain the prior creation/runtime template hashes, sizes and immutable byte offsets. Re-exporting the artifacts changed only compiler AST identifiers used as immutable-reference keys. An initial whole-JSON equality assertion was too strict; its diagnostic is preserved in [artifacts-initial-comparison.txt](artifacts-initial-comparison.txt), with the prior artifact content in [artifacts-before.json](artifacts-before.json). Comparing the actual commitments and offsets confirmed unchanged executable bytes. Current artifact metadata, manifest hashes, status records and source/evidence checksum lists have been refreshed.

A separate read-only reviewer inspected the manifest, validator, regression cases and parent report. The reviewer found no substantive issue and confirmed that essential economics, security boundaries, accepted risks and deployment limitations remain consistent. The reviewer did not run tests, builds or network calls. This is supplemental review, not the official platform panel.

The prior protected Hook/Token execution and recorded-block fork evidence remain applicable to the unchanged contract bytecode; they were not rerun for this notes-only repair. The supplied Owners check still lacks its platform helper sources. No fresh official admission result or mainnet deployment is asserted. Platform source reconciliation, final admission/panel/attestation, actual release inputs and deployment/activation receipts remain pending as recorded in [STATUS.json](../STATUS.json).
