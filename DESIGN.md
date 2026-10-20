# UNLOCK terminal design

## Overview

UNLOCK is a compact Ethereum trading terminal for UNLK / IMD. Its geometric diamond, near-black surfaces, emerald emphasis and locally hosted JetBrains Mono identity are preserved. Trade opens first, with a real official-pool trading chart beside the swap on desktop. Separate price-chart and unlock-ladder tabs keep market observations distinct from selling rights. Ordinary activity, rights/claims, treasury/NFTs, Docs and the standalone whitepaper follow in normal flow. Labs is archived and absent from the published UI/runtime.

The sources of truth are `web/src/styles.css`, `web/src/chart/chart.css`, `App.tsx`, `NextRelease.tsx`, `MarketTerminal.tsx`, `PriceChart.tsx` and `PoolActivity.tsx`. The standalone whitepaper retains its public stylesheet. The previous Labs design document is preserved in `archive/labs/DESIGN-previous.md`.

## Colors

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#09090b` | Page, inputs, primary action text |
| `--surface` | `#111114` | Swap/chart panels, empty states |
| `--hover` | `#1c1c21` | Hover/pressed and neutral selection |
| `--text` | `#f4f4f5` | Primary text |
| `--muted` | `#a1a1aa` | Secondary text, source/coverage, chart axes |
| `--line` | `#27272a` | Structural dividers |
| `--control` | `#71717a` | Control borders |
| `--accent` | `#34d399` | Primary action, earned gates, up candles |
| `--warning` | `#fbbf24` | Future gates, cached/unconfirmed data |
| `--focus` | `#22d3ee` | Keyboard focus, header wallet control, gate selection |
| `--sell` | `#f472b6` | Existing sell swap/action state |
| `--error` | `#fca5a5` | Recoverable errors |
| `--chart-down` | `#f87171` | Red down candles, negative loaded-history change |
| `--chart-up` | `#34d399` | Chart's emerald up state, matching `--accent` |

Canvas options in `PriceChart.tsx` mirror these values; the subdued canvas grid is `#202025`. Source, freshness, direction and selection also have text, signs or pressed/selected semantics. Chart color does not establish quota rights. Measured contrast and rendered coverage are recorded in `artifacts/chart/validation.md`.

## Typography

JetBrains Mono throughout, with `ui-monospace, SFMono-Regular, Consolas, monospace` fallbacks. The local regular 400 and semibold 600 WOFF2 files live in `web/public/fonts/` with their SIL license. The app and whitepaper share those assets. `font-synthesis:none`, tabular figures and antialiased text are inherited from `styles.css`.

The six source sizes are `--small:12px`, `--body:14px`, `--input:16px`, `--subhead:20px`, `--heading:24px`, `--large:28px`. Body line height is 1.5; headings 1.2. H1 tracking is -0.035em, H2 -0.025em. Data labels, chart axes and tool buttons use 12px; mobile native chart selects use 16px. Paragraph measure is capped at 75ch. Prices use significant figures, volume has a separate formatter, and full timestamps are UTC. Critical addresses/PoolIds wrap. Tables scroll locally rather than clipping values.

## Layout

Header and main are at most 1344px with 32px desktop insets. Group gaps use the established 4/6/8/12/16/20/24px values. The workspace uses `minmax(0,7fr) minmax(320px,3fr)` with 16px between a large left chart and right swap. The canvas is 450px high and has separate aligned price and volume panes. The price scale reserves at least 90px; the time scale remains below both panes. Controls and OHLCV values wrap above the canvas; source, update, history and native disclosures sit below.

At 1100px the metrics become two columns. At 900px header navigation wraps and the workspace stacks with the swap first, preserving the main action on the first mobile screen. At 600px page insets become 16px, the canvas is 360px high, chart controls/readout wrap and secondary intro prose is hidden. The existing 360px rules refine the smallest terminal layout. A native disclosure contains the recent-candle table; the separate activity table is a named, focusable local scroll region. Neither creates page overflow. Fullscreen uses the browser API, with a fixed expanded view and Escape fallback where the API is absent.

Rendered checks and supported widths are listed in the current validation; a narrow viewport is not a physical phone or native browser zoom.

## Elevation & Depth

This is a flat terminal. Borders and tonal layers separate controls and panels; there are no decorative shadows, gradients, autoplay animations or floating marketing elements. Existing native wallet/review dialogs provide modal separation and focus containment. Fullscreen chart expansion does not change the rest of the page's layout state.

## Shapes

Panels and primary controls use `--radius:6px`; chart tools use 4px corners. The diamond mark and simple fullscreen SVG use current-color strokes. Thin rectilinear chart grid/volume bars retain the terminal's precision. Tables keep full values within local scrolling containers.

## Components

- `App`: shared header, hash navigation, wallet utility and skip link. Missing/retired Labs hashes resolve safely to Trade. No archived module is imported or fetched.
- `MarketTerminal`: native ARIA tablist with roving focus and arrow-key switching; separate Price chart and Unlock ladder panels. All 17 ladder levels, including Initial and $50M, remain inspectable. Selecting a scenario leaves actual rights unchanged.
- `PriceChart`: lazy-loaded maintained canvas renderer with visible attribution. Default 1h candles fit the loaded history. Native selects and pressed buttons control six intervals, chart style, unit and source. The crosshair and keyboard candle inspector expose UTC/OHLCV; pan/zoom buttons complement pointer/wheel/pinch. Reset fits and restores price autoscaling. Fullscreen has a labeled SVG control. Time ranges survive interval/unit changes after panning and progressive backfill. Line mode marks observed closes and only connects consecutive active intervals.
- Chart states: loading retains a stable canvas region; empty has no generated candles; mainnet failure says “Mainnet history is unavailable. Retry chart or choose GeckoTerminal under Source.” beside the existing retry button and Source select. Raw RPC payloads are never appended to that panel. Cached data keeps its timestamp and unconfirmed label. Coverage, source differences and historical USD limitations are readable in native details. No error disables the independent swap.
- `PoolActivity`: retained official-pool trades, executed legs, timestamps and transaction links. Reads only on Activity navigation/manual request; polling stops after leaving. Empty/error states distinguish unavailable data from successfully scanned inactivity.
- `NextRelease`, `wallet`, `NftGallery`: existing swap, slippage/quote/approval guards, rights/claims, treasury authority separation, verified NFT inventory and ordinary wallet flows. The shared wallet accepts zero native transaction value only; retired Labs funding metadata/validation stays in the archived frontend. The UI remains unsigned until the visitor chooses a wallet action; no chart interaction initiates a transaction.
- Existing `.button`, `.primary`, native form labels, `:focus-visible` 2px cyan outline with 3px offset, disabled states and transaction review dialogs remain the shared primitives. Primary controls are 44px; compact chart controls are 36px desktop/40px mobile, with separate boundaries and gaps.

## Do's and Don'ts

Reuse the existing workspace, color/type tokens, native controls and state language. Keep the primary action high on phones and full identifiers available. State source/method, partial coverage, cache age and provider errors next to data. Add a terminal surface by using the shared main container, one clear heading, native controls, a stable data/loading region and the existing error/retry pattern.

Do not reintroduce archived runtime imports, use symbols in place of verified addresses, merge unrelated pools, create empty candles, multiply historical prices by a current FX rate, or let chart observations grant quota rights. Preserve the required monospace identity even when a generic probe prefers proportional prose.

Design guidance: Jakub Krehel's Better Interface (MIT), pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`; documentation method: Paul Bakaus's Impeccable (Apache-2.0), pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Existing notices/licenses remain in `web/NOTICE.md` and `web/licenses/design-guidance.txt`. The current revision's six-domain review, fixes and limitations are in `artifacts/chart-revision/validation.md`; the original chart review remains in `artifacts/chart/validation.md`.
