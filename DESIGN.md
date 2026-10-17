# UNLOCK terminal design

## Overview

UNLOCK is a Sepolia trading interface for cumulative sell allowances and permanent milestones. The final design is a compact, flat terminal: one chart/form workspace, aligned numerical ledgers, thin separators and explicit state labels. It follows the density of the inspected Sato reference while using UNLK’s own categorical milestone rules, emblem, copy and interactions. There is no marketing hero, serif typography, decorative coin, gradient or large diamond.

The canonical implementation is `web/src/styles.css`; `App.tsx` provides navigation and `Terminal.tsx` composes the entry view. `charts.tsx`, `Trade.tsx` and `Unlock.tsx` are the primary reuse points.

## Colors

All colors are opaque sRGB hex tokens. There is one intentionally dark theme.

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#09090B` | Page and input background |
| `--surface` | `#111114` | Flat panels/dialogs |
| `--surface-hover` | `#1C1C21` | Hover, selected neutral surfaces |
| `--line` | `#27272A` | Panel borders, separators, supplemental graph grid |
| `--control` | `#71717A` | Input/button boundaries and outside-allowance bar |
| `--text` | `#F4F4F5` | Primary text |
| `--text-muted` | `#A1A1AA` | Supporting text and chart axes |
| `--earned` | `#34D399` | Buy, confirmed sell rights |
| `--target` | `#FBBF24` | Future milestones, hypothetical results, unavailable oracle |
| `--selection` / `--focus` | `#22D3EE` | Wallet actions, chart cursor, keyboard focus |
| `--sell` | `#F472B6` | Sell and ETH-credit settlement |
| `--error` | `#F87171` | Errors and execution blockers |

`--accent-solid` inherits emerald and becomes pink inside `.sell-mode`; filled actions use near-black text. Buy and Sell tabs use restrained dark tints (`#10261F` / `#2B1925`) with both text and pressed-state cues. Colors never carry status alone.

Measured text contrast against `--surface`: primary 17.149:1, muted 7.355:1, emerald 9.805:1, amber 11.291:1, cyan 10.430:1, pink 7.117:1, red 6.814:1. Control boundaries measure 3.900:1. Opaque rendered surfaces were inspected; the detailed token calculations are in `artifacts/contrast.json`. Disabled controls are intentionally dimmed and are not represented as active actions.

## Typography

JetBrains Mono is bundled as local Regular (400) and SemiBold (600) WOFF2 files in `web/src/assets/fonts/`. The SIL OFL license ships in `web/public/fonts/JetBrains-Mono-OFL.txt`. Fallbacks are `ui-monospace`, SFMono-Regular, Consolas and monospace. No font request goes to a third-party host.

Six sizes: `--small` 12px for data labels/axes, `--body` 14px, `--input` 16px, `--subhead` 20px, `--heading` 24px and `--large` 28px for trade input. Body line-height is 1.5; headings use 1.3. All numerical values use tabular figures. Copy is naturally cased without tracked kicker labels. Mobile form inputs/selects are at least 16px. Text remains selectable; long addresses and amounts wrap rather than clip. `Amount` exposes exact wei-derived decimal values in its title while the visible value uses conservative precision.

## Layout

The main workspace is at most 1280px with 24px outer margins on larger screens. The desktop chart/form grid is `minmax(0,1fr) 360px`, separated by 16px; at 1100px the form becomes 340px. At 850px the header navigation becomes a second compact row and chart/form stack. At 560px the form becomes a single column directly after the chart, with a connection action immediately after Buy/Sell tabs while disconnected. My Unlock follows the workspace and data freshness stamp.

Spacing is built around 12/16/24px, with 4/8px adjustments for compact controls and data rows. At phone widths outer margins are 12px. The actual SVG ladder is 240px tall on narrow displays and 280px on desktop. A ResizeObserver uses the rendered width so 12px chart labels stay 12px; narrow category labels stagger to prevent overlap. The axis explicitly says categorical USD FDV. The ladder’s plot and history plot retain fixed height through loading and unavailable states.

At 390×844 the product, ladder, Buy/Sell tabs and full Connect to trade action fit. At 1440×900 the complete chart and initial trade form fit. Reflow was checked at 320, 390, 768 and 1440px in Chromium and 320, 390 and 1440px in WebKit. Native browser zoom and physical devices were not tested.

## Elevation & Depth

Panels use one 1px border and no shadow. Tables and disclosure groups use separators instead of nested cards. Dialogs use a native modal backdrop (`#000B`), a stronger control border and a maximum 88dvh height (90dvh on phones). Persistent transaction notices use a cyan border and stay dismissible. There are no background gradients or noisy glows.

## Shapes

Panels use 6px corners, buttons and inputs 4px, dialogs 8px. The UNLOCK diamond is a small 20–23px header mark and bundled favicon, never a hero illustration. Icons are inline SVG or simple redundant direction symbols; wallet marks remain their official provider assets. `share.svg` and `share.png` reproduce the rule-ladder identity without claiming a live price or tier.

## Components

- **App navigation:** brand, Trade, My Unlock, Milestones, Activity, Docs and wallet action. Hash routing supports static hosting. Route changes focus the main landmark. A skip link preserves the current route.
- **Terminal metrics:** indicative price/FDV, confirmed tier, next milestone, and verified oracle status. Unknown values say unavailable; a valid spot feed never substitutes for milestone FDV.
- **UnlockLadder (`charts.tsx`):** green confirmed segments, amber future steps, cyan selection cursor. SVG buttons support pointer/touch, Tab, Enter/Space, arrows and Home/End. A persistent, live-announced readout labels hypothetical versus confirmed checkpoints; the final point describes quota bypass. No date forecast or invented progress.
- **PriceChart (`charts.tsx`):** official-pool event price line and ETH volume marks, time ranges, crosshair, selected observation/transaction link and keyboard range input. Coverage and freshness stay visible. Sparse events remain sparse and never become candles.
- **Trade (`Trade.tsx`):** two pressed-state tabs, editable amount, balance, percentage fills, output, slippage, fee/gas details and one next-step action. Buy is emerald; Sell is pink. Errors and quota/liquidity/approval blockers remain beside the action. Percentage clicks never sign. The flow progresses through quote, bounded approval if needed, review, wallet confirmation and receipt recovery.
- **WalletOverview (`Unlock.tsx`):** connected-wallet ledger, labelled stacked bar and hypothetical milestone selector. The outside segment is transferable wallet balance, not escrow. Disconnected readers see a Connect action, no fabricated personal amounts. The data provider synchronously filters values by current wallet identity.
- **Details and supporting pages:** native `details/summary` disclose rules, oracle actions, withdrawal, rewards and deployment diagnostics. Activity tables use aligned values and explorer links; the full Activity page retains search and pagination.
- **Wallet dialogs (`wallet.tsx`):** the existing native dialog, discovery and review flow is preserved. Escape/backdrop close and focus restoration were exercised. A connection makes no transaction request. Pending/rejected/reverted/confirmed states remain persistent and recoverable.

Focus uses a 2px cyan outline with a 3px offset; forced-colors rules retain outlines and boundaries. Primary trade and body wallet actions are at least 44px; the compact phone header wallet action is 40px. Dense navigation/chart ranges are at least the 24px baseline or properly spaced; the probe reports these smaller targets transparently. Hover/color transitions are 120ms and allowance updates 200ms, only when reduced motion is not requested. There is no continuous animation or `transition: all`.

## Do’s and Don’ts

Reuse `.panel`, `.panel-heading`, `.segmented`, `.details`, `.notice`, `.button` and the existing amount/address components. New public data needs units, source, coverage and an unavailable state. Keep simulation and wallet confirmation separate, and preserve the bound-router safety checks.

Keep the ladder categorical; do not redraw it as a price curve. Never color a hypothetical milestone as confirmed from spot FDV alone. Never label outside-allowance tokens locked or escrowed. Do not add fabricated market series, automatic unlock dates, economic promises, generic routers, decorative hero sections or unbundled fonts.

Guidance attribution: Better Interface by Jakub Krehel (MIT), pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`; documentation method adapted from Impeccable by Paul Bakaus (Apache-2.0), commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Notices and licenses remain in `web/NOTICE.md` and `web/licenses/design-guidance.txt`.
