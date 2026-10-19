# UNLOCK LABS repair validation

The production export is delivered in `dist/`; the service/indexers are operator source. **No external API was deployed, no paid job was opened and no mainnet transaction or approval was sent.** Shipped `apiBase` remains empty. Static observations are labeled snapshots and grant no current market eligibility.

| Area | Implemented and checked | Operational result / limitation |
| --- | --- | --- |
| Markets pipeline | Durable paginated catalog, legacy-cache migration, fair work/seller/history cursors, independent queues/budgets, read-only doctor, retries/fallback and persistent Retry-After cooldowns | 292 discovered assets; 0 admitted, 292 excluded with explicit reasons and recovery progress |
| Eligibility | Exact Uniswap identity, current per-position USD inventory, active-liquidity reconciliation, real-account full-router sell check; no writes/overrides | Supplied RPCs refuse historical position logs; tested sellers have account allowance/quota gaps. No listing policy was relaxed |
| Metrics / identities | Provider-reported cap with exact-pool provenance; FDV separate; real observed cap sorting; resolved ZTO/FREE1376/EMBEO; INFER/OG ambiguities evidenced | Four distinct mainnet INFER deployments and two OG tickers remain unselected editorially. Supplied IMUSD identity is preserved; supported authoritative PoolKey unresolved |
| NFT Radar | Persistent deployment-to-head owner reconstruction, mints/transfers/burns, checkpoint/reorg recovery, rotating ownerOf/balance checks and exact sorting | 10 discovered/verified IDs of 2000 total from a separate recent lane; **0 IDs replayed from deployment history**, 1,136,625 archive blocks pending. Partial candidates, never a global ranking |
| IMD / chart evidence | Independent holder/flow index, canonical recent interval, fair verification, incremental swaps/attribution and event-block USD references | 203 retained recent IMD transfers, with known timestamp omissions disclosed; 7 currently checked IMD candidate wallets. 10 indexed trades produce 6 USD/quote trade buckets across three pools; archive gaps remain incomplete |
| Details / P&L | Recent chart intervals cannot bridge archive gaps or certify opening inventory; fixed attribution/FIFO regressions preserved | Production-rendered fixture remains partial/null before reconciliation, then $14 realized/$12 unrealized after its complete proof; real mainnet excluded tokens stay excluded |
| Profiles / Audit | Explicit source/runtime/registry immutable authority policy; signed-session guards; owner() outage denial; numbered searchable file wizard; order-bound payments/recovery and matching PDF | Mainnet policy evaluation passed UNLK/OG and refused three older inconsistent receipt/block records. Checkout stays disabled until operator/backend/tariff configuration; paid recovery/report equivalence tested with isolated fixtures |
| Static website | Preserved terminal, Trade/claims/treasury/whitepaper, relative assets/hash links; title/favicon/description/OG metadata | Product and Refresh checks fit the first 390px screen. No page overflow at 320/390/768/1440 in tested views |

## Actual read-only observations

`doctor.json` records the repaired run at **2026-10-19 12:48:44 UTC**, confirmed block **26226709**. `baseline.json` records a fresh database using the original supplied defaults at commit `cd95d08507d635239da996518ed0a7df4dc78338`: zero admitted listings, missing seller plans, refused position-log reads and no IMD pool start. The baseline was run before the implementation changed.

The repaired catalog completed its historical walk; the page count includes subsequent head polling. Catalog size is independent of the 12-asset work budget. The legacy truncated cache explicitly restarts discovery, rather than trusting a cursor whose earlier assets were discarded. Extra launch IDs and failed seller candidates have persistent fair cursors.

Exclusion categories overlap: 158 provider, 158 seller, 126 pricing, 131 indexing, 4 unsupported pool, 3 liquidity. The JSON gives the address, reasons, replay progress and next action for every exclusion. Unsupported means unsupported/unknown, never verified zero liquidity. An expired/missing allowance affects the tested account, never proves token-wide unsellability. All tables, gainers, editorial and sponsored paths retain the common gate.

PublicNode returned HTTP 403 with an archive personal-token requirement. dRPC returned HTTP 400/free-plan range refusals for bounded historical requests. Read-only chain, current state, selected archive calls and recent logs succeeded. These refusals are preserved with provider/block provenance; no endpoint or identity rotation bypassed quotas. Configured private RPC URLs are redacted from public provenance, and 429 cooldowns persist across restarts.

NFT deployment block **25090085**, IMD token deployment **23501863**, supplied IMUSD deployment **26166419**, IMD pool start **25640607**, and UNLK pool start **26211921** have recorded code/zero-to-initialized state evidence in `production-seeds.json`. Initialize log replay is still required for liquidity admission. The NFT global cursor remains immediately before deployment because historical logs are refused. Recent NFT discovery, ownerOf and balances are shown separately from full-history replay. No 32-ID truncation remains. Known custody accounts are separated from individual whale results.

`metrics.json` contains actual exact-pool DEX Screener observations used by the sorting test: six provider-reported cap values, plus unknown values. No circulating-supply claim or FDV substitution is made. `services/labs/editorial-identities.json` binds the required names to authoritative Ethereum records; launch 1376 is SCOOP, while FREE1376 is launch 775. Four INFER addresses actually return the same symbol; both launch 1040 (OG) and launch 2160 (Og Club) return OG. This later identity review at 13:15 UTC supersedes the editorial decisions in the earlier doctor capture; its registry sources, checked blocks and source commits are retained in that source JSON. These ambiguous badges default to none. The operator can choose an exact evidenced address in editorialSelections; no symbol-based guess is made. `public-attributions.json` records why vitalik.eth is sourced, Binance custody is not CZ's personal wealth, and no Asem address is guessed.

`logos.json` records an actual official IMD SVG and successful sanitized service-cache response with image/svg+xml, sandbox CSP and nosniff. Registry logos support restricted SVG and validated PNG; unsupported/unsafe formats are explicit fallbacks. Checked generated launch records have `logo.link: null`; no undocumented image URL was invented. JPEG/WebP, complex SVG features and unavailable generated logos remain limitations.

`authority.json` records real read-only authority evaluation. UNLK additionally binds initialRecipient and immutable hook setupAuthority to the reviewed registry requester. A runtime/receipt mismatch blocks even a configured policy. An owner() timeout/revert never selects that policy or authorizes a requester. The new treasury inventory wallet acquires no beneficiary/edit authority merely by receiving payments.

## Commands and results

The worker installed the unchanged `web/package.json` and `web/package-lock.json` with **npm ci** into a temporary directory because repository node_modules writes are prohibited. Production Vite and full TypeScript checks used those exact locked dependencies with external resolution paths; build options remain the repository's base `./`, React plugin, root dist, no sourcemaps and unchanged warning threshold. No manifest/lockfile was changed.

| Check | Actual result |
| --- | --- |
| TypeScript 5.9.2, `tsc --noEmit` with full web source/scripts/tests and identical compiler options | Pass |
| Vite 7.1.7 production build, locked dependencies | Pass; 523 modules, 32 exported files |
| `node --test services/labs/tests.mjs services/labs/*.test.mjs` with external viem test accounts and Playwright | **82 passed, 0 failed, 0 skipped** |
| Native esbuild compilation of existing web tests; Node test runner | **60 passed, 0 failed** |
| `node web/scripts/check-repair.mjs http://127.0.0.1:4174` against exact dist and REAL local backend/SQLite | **20 interaction/reflow groups passed**, no page errors or missing local resources |
| Retained production-export attribution/P&L browser regression | Chromium 390/1440 passed: partial/null → supported $14/$12; actual candles unchanged. Explicit isolated fixtures, distinct from mainnet evidence |
| Minimal copy matching Docker service/runtime files, without npm | Startup, HTTP health 200, settings configured=false, Markets warming response passed |
| `node web/scripts/check-export.mjs` | Pass: relative local assets, title/favicon/description/OG, claims/recovery/whitepaper, protected paths and complete export |
| `python3 scripts/candidate/dependencies.py --check` | 1995 retained ordinary dependency files verified |
| `git diff --check` | Pass |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | **13/16**; all applicable render/layout/target/contrast/share checks pass; three documented brand/navigation exceptions below |

Service tests include fresh catalog/cursor reproduction, more than 12 assets and 32 NFT IDs, SQLite restarts/reorgs, ownerOf mismatch tainting, allowance failure followed by another valid seller, exact router/no-overrides enforcement, real-value cap sorting, secure SVG rejection, provider cooldown/private-URL handling, separate recent candle proofs, and current-flow time bounds independent of old archive progress. Existing order binding, duplicate transfer prevention, lost-response recovery, PDF exact UTF-8 attachment/equivalence, partial-cost-basis and attribution backlog cases remain passing. No paid API is contacted by those tests.

The actual integration test exercises market search/views/sort/refresh, exclusion pagination, UNLK hash deep links/reload/retry, wallet dialog keyboard focus/Escape, NFT coverage, current IMD transfers/balances, period and real API next/previous pagination, profile access guards, real IMD/GitHub import and file filtering/selection retention, preserved Trade, and whitepaper under a static subpath. The static snapshot includes all **766 retained combined 7d event rows** for local pagination, not merely the first API page. It remains historical, partial and explicitly labeled.

Reproduction commands and operator setup are in `README.md` and `docs/backend.md`; `checks.json`, `interactions.json`, `taste.json`, `doctor.json`, `source.json` and screenshots preserve the actual results. The upstream main branch was checked read-only and still equals the requested base commit.

## Better Interface review: all six domains

The pinned workflow, core principles in all six domains, relevant form/focus/data-table guidance and documentation method were applied while implementing. The requested compact dark/emerald JetBrains Mono terminal takes precedence over generic type/casing preferences.

| Domain | Source finding and implemented fix | Verification / limit |
| --- | --- | --- |
| Accessibility | `Markets.tsx:43` recovery uses native disclosures and labeled pagination; `Audit.tsx:220` exposes active step and `Audit.tsx:231` labels native file checkboxes; existing focus ring/modal retained | Browser roles, native selections, keyboard Tab/Escape and target probe passed. Screen reader, forced colors and physical assistive devices not verified |
| Layout | `terminal.css:11` reuses existing surface/margins/wrapping; recovery and `Radar.tsx:169` progress stay in normal flow; pages bound long lists without discarding catalog records | Markets, token exclusion, Radar, Profiles, Audit and Trade fit 320/390/768/1440; first 390 screen shows product/main action. 200% zoom/RTL not verified |
| Writing | `Markets.tsx:43` replaces silent zero results with categories/actions; `Radar.tsx:169` separates discovered IDs, deployment replay and total, and names an untouched cursor as Replay not started; cap labels explicitly say provider-reported | Rendered states checked for truthful loading/empty/partial/error copy. Externally blocked operations remain labeled; no live/global/complete-profit fiction |
| Typography | `styles.css:30` six-size scale; new recovery styles use existing 12/14px roles; literal addresses remain available in full disclosures | Local font/resources loaded; probe scale/tracking passed. Monospace prose is deliberately retained by the brief |
| Colors | `styles.css:16` established palette retained; status words/signs accompany accent/warning colors; no new competing palette | Probe's rendered solid-background contrast check passed; no unmeasured numerical contrast ratio claimed |
| UI | `Audit.tsx:215` six-step progress and 100-file pages retain selection; refresh/retry/error controls remain visible; custody/coverage use existing disclosures | 20 actual interaction groups, real pagination and secure logo route verified. Wallet signing/payment success is not claimed |

Taste's casing finding is the required `UNLOCK LABS` brand. The eyebrow findings are navigation/status elements near headings, retained as functional terminal navigation. Its monospace-prose finding conflicts with the explicit preserved typography. These three are recorded exceptions, not silently marked passes. No applicable high finding remains from the rendered checks. Screenshots include Markets at 390/1440, NFT progress, actual flow records and Audit file selection. `DESIGN.md` documents the final tokens/components/responsive behavior.

## Remaining blockers and packaging

- **Provider/data:** Historical logs and some deployment receipt/block reads need an operator provider/authoritative-record investigation. Global NFT/IMD backfill remains unfinished. More capable RPC access must not weaken admission or mismatch checks.
- **Identity/data:** INFER/OG editorial selections, IMUSD PoolKey, generated logo URLs and reliable CZ/Asem personal attributions remain unresolved with evidence. Unsupported pools stay excluded until an adapter/identity is reviewed.
- **Hosting/settings:** The operator must host the API/indexers with persistent SQLite, HTTPS/origin configuration and capable RPC, then set the real `apiBase`. Owner tariffs/refund terms/moderation are intentionally unset; checkout remains disabled. This submission does not claim ongoing operation.
- **Unperformed checks:** WebKit could not start due to missing host libraries; the browser MCP Chrome launcher was unavailable, so actual rendering used Playwright Chromium. Docker build, physical wallets/devices, native screen readers/zoom/RTL, paid audits/mainnet payments and unchanged Solidity tests were not run in this repair.

Source, static runtime assets, fonts, ABIs, claims, existing historical evidence archives, manifests/lockfiles and Solidity configuration/dependencies remain complete. The only packaging removal is the optional 2.3 MB esbuild WASM compiler archive; the configured locked Vite build and native test bundler pass, and the backend remains npm-free. Its historical package metadata/licenses are retained; the inventory is refreshed. No node_modules, registry mirror/cache, submodule or dependency tarball is submitted.

`artifacts/repair/` has an explicit **2 MiB** ignore-path budget, including the incremental Git commit bundle. The original repository `.git/` is read-only by task scope: the reviewable commit is created in a temporary object store and delivered as `change.bundle`, with the original base as prerequisite. The bundle omits its own container/packaging metadata to avoid self-reference; the workspace contains the full delivery. Final sizes/commit/export digests are recorded in `delivery.json` after packaging.
