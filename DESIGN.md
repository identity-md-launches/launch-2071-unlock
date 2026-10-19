# UNLOCK terminal design

## Overview

UNLOCK is a compact Ethereum UNLK/IMD trading terminal. Preserve its diamond wordmark, dense mono data, amber categorical unlock staircase and adjacent swap. UNLOCK Labs adds public market discovery, a bounded transaction Radar and scoped public-code audits while retaining the Price chart and readable English whitepaper. It does not replace the established brand or transaction components.

The source of truth is `web/src/styles.css`, `App.tsx`, `MarketTerminal.tsx`, `PriceChart.tsx` and `NextRelease.tsx`, plus `web/src/labs/{Labs,Audit,Markets,Radar}.tsx`. Labs reuses the same tokens in `labs.css` and `market-radar.css`. The physical whitepaper uses matching tokens in `web/public/whitepaper/whitepaper.css`. Mainnet execution remains behind the existing wallet review and validation path. A narrowly validated native-funding exception permits only the verified Labs exact-output ETH→IMD route; original UNLK swaps remain token-funded.

## Colors

The existing single dark theme uses these exact tokens:

| Token | Value | Role |
| --- | --- | --- |
| `--ink` | `#09090b` | Page, fields, primary-button text |
| `--surface` | `#111114` | Terminal panels, chart backgrounds and dialogs |
| `--hover` | `#1c1c21` | Hover and selected neutral controls |
| `--text` | `#f4f4f5` | Main text |
| `--muted` | `#a1a1aa` | Secondary text, chart axes and timestamps |
| `--line` | `#27272a` | Structural borders and chart grids |
| `--control` | `#71717a` | Interactive boundaries |
| `--accent` | `#34d399` | Buy action, earned rights, line chart and rising candles |
| `--warning` | `#fbbf24` | Future gates and stale/unconfirmed status |
| `--focus` | `#22d3ee` | Focus, selected scenario and crosshair |
| `--sell` | `#f472b6` | Sell action and falling candles |
| `--error` | `#fca5a5` | Errors |

Status always includes text or geometry. Rising candles are hollow; falling candles are filled. Color alone does not convey selection, freshness or direction. The design probe measured its resolved text pairs and passed contrast checks; its output is retained. Those measurements do not cover every SVG pixel, external image or untested dynamic state. On the rendered Labs audit view, computed solid pairs measured 18.100:1 for text/ink, 7.763:1 for muted/ink and 10.349:1 for primary-button ink/emerald; see `web/evidence/labs-contrast.json`.

## Typography

Use locally hosted **JetBrains Mono 400/600** throughout, including prose, as required by the brief. Files are `web/src/assets/fonts/jetbrains-mono-{regular,semibold}.woff2`; the static whitepaper uses identical files in `web/public/fonts/`. The OFL notice remains in that public directory. Fallbacks are UI monospace/Consolas/monospace. Production browser checks confirmed both whitepaper faces loaded.

The terminal's six tokens are `--small:12px`, `--body:14px`, `--input:16px`, `--subhead:20px`, `--heading:24px` and `--large:28px`. Use 400 for body/data and 600 for emphasis/actions. Body line height is 1.5, headings 1.2; headings tighten tracking slightly. Tabular numerals stabilize live readings. Prose has a 75ch maximum measure. Addresses wrap and remain selectable. Chart axis labels are 12px in a responsive SVG coordinate system; small prices use scientific notation to fit the axis gutter.

Whitepaper body is 14px with 1.65 line height and an 80ch outer content limit including padding. Its h1/h2/h3 use 28/20/16px; mobile h1 is 24px. Print switches to black on white with 10pt body and A4 margins; source URLs remain printable.

## Layout

Header and terminal share a 1344px maximum width, 32px desktop side padding and alignment edges. Existing spacing steps are 8, 12, 16, 20, 24 and 32px. The desktop workspace uses `minmax(0,7fr) minmax(320px,3fr)` with a 16px gap. The mobile swap comes first so its main action remains on the initial screen.

| Breakpoint | Behavior |
| --- | --- |
| Above 1100px | Four live summary cells; chart/ladder beside swap |
| 1100px | Two-by-two summary; header navigation takes its own wrapping row; fewer categorical tick labels |
| 900px | Workspace stacks, swap first; navigation takes a separate row; 24px side padding |
| 600px | 16px side padding; navigation wraps into rows; stacked accounting and docs; chart style controls fill a row; native wallet bottom sheet |
| 360px | Compact heading and ledger spacing; all navigation remains reachable |

The price plot is 300px tall and uses ResizeObserver to keep its coordinate width equal to the rendered width. Its controls wrap; tooltips sit below the plot without covering the swap. Time is linear and timestamp-based, ending at the scanned block timestamp; boundary candles are labeled partial. No-trade buckets remain blank and line segments break across gaps. History tables scroll inside named regions, never the page. NFT cards use a horizontal 144px rail with touch, keyboard and previous/next controls.

The standalone whitepaper has a compact header, contents links and one reading column. Tables and addresses wrap at 320px. Print hides navigation/print controls, preserves all substantive sections and adds source URLs. Terminal layout was checked at 320/390/768/1000/1440; whitepaper at 320/390/1440. Physical devices and native 200% zoom remain unverified.

Labs uses the same content edges. Its introduction has one 28px desktop / 24px mobile product heading and a compact tools nav. Offline login controls are omitted and the visible status names the unhosted backend. Markets puts search above two mobile liquidity/age controls; full coverage is in native details while snapshot/stale warnings stay visible. Radar similarly uses two period/type controls and visible incomplete-history warnings. At 390×844, actual featured IMD price or the first observed event appears on the first screen, alongside Refresh. Audit puts its repository input and Import action first; its 1.6fr/1fr desktop grid stacks at 850px, and accepted reports span both columns. Below 600px, its input/action row and metadata ledger stack. Addresses and source code wrap without clipping.

## Elevation & Depth

The interface is intentionally flat. One-pixel borders communicate structure; no decorative shadow, gradient, glass or entrance animation is added. Dialog backdrops darken the background. Chart grids use the existing divider token; crosshair lines are cyan dashed strokes. Selected chart-style controls use a bottom inset mark plus `aria-pressed`, consistent with existing terminal tabs.

## Shapes

Existing panels use `--radius:6px`; small controls and chart-style groups use 4px. Chart dots/rings encode observations/selection. NFT images have an inset neutral 1px white outline at 10% opacity, preserving the existing image treatment. Avoid introducing a competing corner or icon system.

## Components

- **`App.tsx`**: diamond UNLOCK_ wordmark, hash section navigation, visible Whitepaper link, skip link and wallet control. Preserve mobile wrapping when adding navigation.
- **`MarketTerminal.tsx`**: keyboard-operated Unlock ladder / Price chart tabs with roving focus; pointer/native-select gate inspection; current, earned, future and selected states remain separate. Stored onchain rights are distinct from selected scenarios.
- **`PriceChart.tsx`**: line/candlestick controls, interval/coverage selectors, current pool spot and last trade, explicit freshness, responsive SVG, crosshair, touch/drag/pinch, keyboard candle inspector, UTC OHLC/volume readout and accessible trade table. Loading, verified empty, failure, stale retention and retry are separate states. `poolHistory.ts` owns official-pool fetching, timestamped observations, candles, caching, deduplication and reorg checks.
- **`NextRelease.tsx`**: summary, buy/sell, ledgers and native claim/attest/sync actions. Reuse `.button`, `.ledger`, `.section`, `.panel-heading` and existing account/network/signing guards. Treasury and beneficiary have distinct links and labels.
- **`NftGallery.tsx` / `nftInventory.ts`**: the new treasury wallet is the fixed inventory identity. Official-collection filtering and onchain ownership precede cards; metadata is rendered as bounded inert image blobs. Keep ID/verification block even when an image fails. A stale snapshot never proves current ownership or fee-funded purchasing.
- **`wallet.tsx`**: existing EIP-6963 discovery, wallet-browser links, Coinbase Smart Wallet and native modal review. Modals trap focus and restore it on Escape/close. No relay/project ID was introduced.
- **`web/src/labs/Labs.tsx`**: hash tool navigation, domain-bound signed login, expiring session restoration, server eligibility status and service disclosure. A positive UNLK balance is the initial access rule; login never authorizes spending.
- **`web/src/labs/Audit.tsx`**: staged commit import, path selection/check, disclosure, current quote, explicit conversion/approval/payment, persisted-order recovery and accepted report/PDF. Native labels, invalid-field focus, stable status/alert regions and disabled unsupported routes explain consequential states. The report prints complete findings as escaped text with native evidence/code disclosures.
- **`web/src/labs/Markets.tsx`**: public search/liquidity/age filters, separately featured IMD, token metrics, source details and observed-point charts. Missing values read Unavailable; no circulating supply is inferred. Holder sorting, comparisons, watchlists and CSV call server-protected endpoints.
- **`web/src/labs/Radar.tsx`**: observed swap/transfer/liquidity rows, receipt-supported wallet attribution, indexed transfer flows, coverage, supported periods and bounded pagination. Plain transfers and swap/liquidity settlement rows remain separate. Full addresses and atomic balances are available in details.
- **`web/src/labs/data.ts`**: source/link formatting, bounded downloads, response validation and dated fallback/warming/stale behavior. Reuse its formatting so null never becomes zero.
- **`services/labs/pdf.mjs`**: paginated black-on-white Courier 9.5pt report, 12pt leading, 40pt inset, repeated job/page footer and exact attached UTF-8 Markdown. Unsupported characters print as Unicode escapes. It evaluates no HTML or links.
- **`web/public/whitepaper/`**: independent static HTML/CSS/print script, matching local fonts, version/date, full deployed rules, source/ABI links and print media. No wallet is mounted on the reading page.

Buttons generally target 44px. Compact mobile navigation uses 32px rows; the probe passed its 24px-or-spacing minimum. Focus uses a 2px cyan perimeter with 3px offset. Loading/status and errors use status/alert semantics; tooltips also have a keyboard range control. Reduced motion disables existing smooth scrolling/transitions; the chart adds no autoplay animation.

Chart RPC failures use the short “History unavailable. Retrying in {seconds}s.” alert and retain the existing Retry chart control and stale-snapshot explanation. `.price-chart .notice.error` uses `overflow-wrap: anywhere` so long values wrap without clipping or expanding the terminal. Raw provider diagnostics are not rendered in this alert.

## Do's and Don'ts

Reuse the existing terminal section/ledger/button patterns. Place instructions beside the chart, swap or proof control they describe. Label estimates, provenance, coverage and stale data near the values. Add another reading page as a physical static directory with relative assets and the existing tokens.

Keep the new treasury separate from the immutable beneficiary and connected execution account. Preserve mono typography and the swap-first phone layout. Do not invent prices, candles, historical USD conversions, fee-funded provenance or unlock rights. Do not add a marketing hero, second font, decorative effects or a different transaction path.

Guidance attribution: Jakub Krehel's [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), MIT; documentation method adapted from Paul Bakaus's [Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), Apache-2.0. Existing notices remain in `web/NOTICE.md`. Current coverage and limitations are in `artifacts/validation.md`. Current Chromium Labs checks covered 320/390/768/1440, including waiting, empty, expired, refused, stale and missing data. The final source uses no new fonts or color tokens. Physical devices, screen readers and native 200% zoom remain unverified.
