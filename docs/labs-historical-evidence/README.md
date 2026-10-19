# Historical evidence archive

The complete Git submission has an 8 MiB limit. This folder stores 348 pre-LABS historical evidence documents together in one lossless solid xz archive, following the repository's existing historical-evidence packaging approach. Their original paths contain a short pointer here, so older links still explain where the exact bytes went.

`manifest.json` records each original path, byte length, SHA-256, Git blob hash and file mode, plus checksums for the tar and compressed archive. The original documents total 3,250,134 bytes; `archive.tar.xz` is 416,656 bytes. Nothing is silently discarded or rewritten inside the archive.

The archive contains historical provider captures, deployment/source catalogs, API snapshots and validation logs under `docs/` and `delivery/`. It does **not** contain project source code, dependencies, package manifests or lockfiles, build configuration, ABIs, existing `.xz` archives, current site assets, the static export, or the direct fixtures required by the frontend tests. In particular, `docs/candidate/network/nft-ownership.json`, `docs/candidate/DEPENDENCIES.json`, `docs/mainnet/release/native-distributor-artifact.json` and `web/evidence/mainnet-code.json` remain directly readable. The earlier archive and its manifests under `docs/unlock-gates/` remain unchanged. `delivery/verify.py`, its operations guide and rehearsal Solidity source remain direct files; running the historical delivery verifier requires explicitly restoring its old evidence catalogs first.

Verify every original byte without changing any file:

```sh
python3 scripts/labs/evidence-archive.py
```

Historical tools that expect the original plain JSON/text paths can restore them explicitly before use:

```sh
python3 scripts/labs/evidence-archive.py --restore
```

Restoring expands the working tree and should be done locally after obtaining the submission. The script verifies the compressed/archive/original hashes first, restricts all destinations to historical documentation under `docs/` and `delivery/`, rejects traversal, symlinks, dependency/configuration names and non-regular members, and refuses to overwrite a document edited since packaging. It writes originals only when `--restore` is explicitly provided. Do not run restoration before uploading the bounded submission.

This packaging changes access to old evidence; it does not update its historical claims. Old manifests still describe their original releases, not the new LABS implementation. The current validation results and remaining hosting dependencies are documented in the repository README, `docs/labs-data.md` and `docs/backend.md`.
