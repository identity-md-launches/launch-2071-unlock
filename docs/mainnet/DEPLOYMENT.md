# Current Ethereum mainnet release

[release/OPERATIONS.md](release/OPERATIONS.md) is the current factory and owner-wallet handoff for the new launch. [SPOT_PRICE.md](SPOT_PRICE.md) defines the active stateless source. Historical sampler/proof-source deployment instructions under `docs/unlock-gates/` and `docs/mainnet/revision/` do not govern this release.

The active source has no warm-up, sampling transaction or keeper. A successful factory stage1 creates the official hooked pool with trading inactive. Owner-signed source staging, companion deployment, actual round0 certification and atomic `configureAndActivate` remain necessary. Do not broadcast stage1 before the actual release has an executable owner-signing path and mandatory admission.

Current source/build/test evidence is in [release/VALIDATION.md](release/VALIDATION.md). Actual published commit, deployment addresses, transactions, PoolId and sealed activation evidence remain downstream outputs; none is fabricated from a local rehearsal.
