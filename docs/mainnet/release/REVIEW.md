> Imported release history for the previous source. Current admission repair, verification results and release responsibilities are in [../../admission-fix/REPORT.md](../../admission-fix/REPORT.md) and [STATUS.json](STATUS.json).

# Supplemental independent reviews

These are contributor-agent reviews of this adaptation, not the mandatory platform panel or an external audit certificate. The actual job's `audit_math`, `audit_permissions`, `audit_economics`, `audit_flow` and `audit_judge` remain downstream of adaptation acceptance; see `network/current-job.json`. No reviewer approved a public deployment or inspected new-launch receipts, because none exist yet.

## Reviewer 1: spot source and oracle

Reviewed `ImdSpotUsdSource`, `ImdSpotMath`, `UnlkImdOracle`, setup/source admission and binding, preparation code and relevant tests. No additional confirmed security finding. Chain/code identity, PoolKey, currency/decimal/liquidity checks, Chainlink freshness, exact arithmetic and one-time setup checks are present. Invalid reference reads withhold new gates without revoking existing rights; the active source has no warm-up or recorder.

Independently ran18 tests across `SpotOracleTest`, `ImdSpotMathTest` and `V4ActivationTest`:18 passed,0 failures/skips. Both fuzz tests used256 cases and the assignment's seed. Those executions preceded the final protocol-fee repair. Final read-only inspection confirmed that swap admission and FDV no longer reject core protocol fees while retaining LP-fee, seed-range and liquidity checks. The reviewer also supplied256 independent Python-big-integer vectors; the root agent executed their512 directional assertions in scratch tests. Scratch scaffolding is not part of the submitted test suite.

## Reviewer 2: hook, quotas, fees and manifest

Reviewed mainnet hook admission, four trade modes, fees, quota/maturity accounting, principal protection, native claim evidence and manifest selection. Independently reproduced both imported medium findings. A pre-fix Foundry regression using actual recorded runtimes with synthetic local launch state confirmed that the core controller's nonzero protocol fee caused router buy/sell and FDV failures, with principal still locked.

Final read-only review found both findings resolved: the root manifest selects the mainnet IMD hook/permissions, and core protocol fees no longer pause swaps or gates. Fixed LP fee12500 and treasury75bps remain. No additional confirmed production-code defect. This reviewer did not independently rerun the root agent's439-test suite or102-test recorded-block rehearsal, and did not review the new wallet wrapper in detail.

## Reviewer 3: factory and owner setup path

Reviewed factory release compatibility, source staging, companion prediction, native tree certification and atomic activation. The preserved low-level preparation helper did not establish all identities/tree correctness or provide a complete large-tree wallet sequence. A new strict wrapper now validates the actual distributor, funded tree/root, paid owner/payer, chain and independently resolved hook runtime plus factory/manager/router/quoter/Permit2/IMD/fees/registry pins. It returns explicit transaction envelopes and bounded certification chunks. The production contracts and authority model did not change for this hardening.

The final read-only review found no confirmed new defect. The rehearsal executes generated source/companion/certification calldata and verifies the final activation calldata against the immediately executed activation call. The active source reads the actual recorded pool/feed without warm-up. The delivered repository URL is now an explicit provenance field rather than incorrectly requiring the import URL; empty-URL rejection and distinct-URL acceptance are tested. No new builds/tests/broadcasts were performed by this reviewer during final review.

For a real release, `Expected` values must be independently verified from the actual paid request, accepted runtime and assigned launch. Local synthetic identities, allocations and funding do not satisfy that requirement. The release service must bind the full provenance record to its actual signed attestation.

## Risk disposition

Both imported medium findings reproduced and were fixed with regression coverage; neither was dismissed. Mature shared-executor quota pooling and manipulation of either spot pool, including flash manipulation of the external IMD reference and permanent global bypass, remain possible and are explicitly accepted. No manipulation resistance is claimed. These accepted risks are not carried forward as unwaived release blockers.

Later native remediation/reward rounds authorized by the platform treasury can create further claim eligibility; this is a separate preserved trust assumption. Core governance can change protocol fees, and Chainlink or service changes can withhold new gates; the repair prevents nonzero core fees from pausing otherwise valid official trading. Mandatory platform admission, final source review and actual setup verification are not waived.
