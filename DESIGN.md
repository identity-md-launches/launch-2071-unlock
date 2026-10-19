# UNLOCK terminal design

## Overview

UNLOCK is an Ethereum trading/research terminal: compact data, a geometric diamond brand, dark surfaces, emerald emphasis and locally hosted monospace type. This upgrade retains the swap, quota ladder, claims, treasury/NFT inventory and whitepaper while adding dense Labs markets, token research, project profiles and guided audit scope selection. Labs is the default entry; Trade remains immediately available.

The source of truth is `web/src/styles.css`, the retained trading components and `web/src/labs/{Labs,Markets,TokenDetails,Candles,Profiles,Radar,Audit}.tsx`. Labs styles are in `labs.css`, `market-radar.css` and `terminal.css`. The standalone whitepaper has its own matching public stylesheet. No marketing hero pushes the main action below the phone's first screen.

## Colors

Reuse the existing CSS custom properties; do not introduce an approximate second palette.

| Token | Exact value | Implemented use |
| --- | --- | --- |
| `--ink` | `#09090b` | Page, input background, primary-button text |
| `--surface` | `#111114` | Panels, table headers, chart field, empty states |
| `--hover` | `#1c1c21` | Neutral interaction/selection |
| `--text` | `#f4f4f5` | Main text |
| `--muted` | `#a1a1aa` | Secondary text, axes, timestamps |
| `--line` | `#27272a` | Structural/table/grid separators |
| `--control` | `#71717a` | Form/control boundaries |
| `--accent` | `#34d399` | Emerald action, active tabs, positive changes/buy candles |
| `--warning` | `#fbbf24` | Snapshot/stale status, future quota gates |
| `--focus` | `#22d3ee` | Keyboard focus, wallet control, crosshair |
| `--sell` | `#f472b6` | Negative changes/sell candles |
| `--error` | `#fca5a5` | Recoverable errors |

Statuses also have text/signs, not color alone. Editorial and sponsored labels state their meaning explicitly. The rendered taste probe passed its contrast check, and the scanned axe states returned no contrast violations; that is not a claim about every third-party image or wallet interface.

## Typography

JetBrains Mono throughout, as requested, with `ui-monospace, SFMono-Regular, Consolas, monospace` fallbacks. The regular 400 and semibold 600 WOFF2 files are canonical in `web/public/fonts/`; `@font-face` in `styles.css` references those public assets and Vite emits relative CSS URLs. The app/whitepaper share them; duplicate source/imported copies are removed. The SIL license remains with the fonts. No synthetic font weights or new family were added.

The six-size scale is `--small:12px`, `--body:14px`, `--input:16px`, `--subhead:20px`, `--heading:24px`, `--large:28px`. Body line height is 1.5, headings 1.2; h1 tracking is -0.035em, h2 -0.025em. Dense tables/labels use 12px, controls 16px, smaller action labels 12–14px. Digits use tabular numerals. Paragraph measure is generally capped at 75ch. Long addresses/PoolIds wrap; full values remain in details/API data instead of being silently clipped. Chart axes use a width-responsive SVG viewBox to keep type readable on mobile, with an HTML value table as an alternative.

## Layout

The main/header container is at most 1344px including 32px desktop insets; mobile insets are 16px. The primary brand sits left, utilities right, navigation wraps when needed. Labs intro is short, followed by tool navigation and the working surface. Typical gaps are 8/12px within groups and 16/20/24px between groups.

Markets uses a compact summary, static horizontal gainers rail, search/filter toolbar, horizontally scrollable view buttons and a wide comparison table. The table scrolls **inside its labeled region**; the page reflows. Search spans both mobile columns below 700px. Unknown/stale markets leave an actionable empty state, never decorative invented rows. The first 390px screen includes the product and market search/refresh actions.

Token detail places a large chart beside a 240–300px evidence column. Below 1100px the evidence moves underneath. At 700px the chart toolbar becomes two columns and pool selection spans both. SVG width follows its actual container; prices and volume bars remain legible. Crosshair data and zoom/pan controls wrap in normal document flow. Data tabs and table regions scroll locally.

Profiles uses form plus preview at desktop and one column below 700px. Audit uses workspace plus recovery sidebar and becomes one column below 850px. The file tree has a bounded scroll region, literal paths, native checkboxes and persistent selection across search. Radar retains its event/wallet layout, adds group buttons and an evidence timeline, and stacks on mobile. The retained trading layout has its existing 1100/900/600/360px adaptations.

Rendered production checks covered 320, 390, 768 and 1440px. Native 200% browser zoom, RTL and physical-device rendering remain unverified; the product is English only.

## Elevation & Depth

Flat tonal layers and thin separators provide hierarchy. Labs adds no decorative shadow or gradient text. Borders identify controls, tables and coverage boundaries. The existing native wallet/review dialogs supply modal focus containment and backdrop separation. No floating Labs action covers content; important forms and recovery controls remain in flow.

## Shapes

Use the existing `--radius:6px` for controls/panels. Small badges use 3–4px corners and token logos are circular 28px images. The fallback is the authored geometric diamond, not a fabricated brand mark. Tables and chart frames stay rectilinear. Image cropping is limited to decorative previews; critical text uses wrapping/scrolling rather than clipping.

## Components

- **`App` / `Labs`:** shared header, one wallet control, hash routing, skip link, concise product title, tool links, status and nonce login. Skipping to main preserves the selected tool. API health must succeed before dependent controls open. A null/failed token response overrides cached eligibility.
- **Buttons/fields:** existing `.button`, `.primary`, `.lab-field`, `.labs-checkbox` styles. Native controls, labels, 44px primary targets, visible 2px cyan focus with 3px offset. Disabled actions have an adjacent reason; failures have a recovery instruction/status region. Small mobile navigation remains spaced and at least 24px.
- **`Markets`:** sortable accessible headers with `aria-sort`, public filters, pressed view buttons, local watchlist buttons, `TokenLogo`, observed-price sparkline, organic gainers and separate sponsored region. Eligibility filters precede every presentation path.
- **`TokenDetails` / `Candles`:** exclusion state, pool/timeframe/unit controls, real OHLCV/volume, pointer/keyboard crosshair, plus/minus zoom, earlier/later pan and reset. A replaced series or currency resets pan/crosshair, and the visible range is clamped so a shorter series remains reachable. Reset stays enabled whenever the underlying valid series has candles. Arrow keys move the crosshair; Page Up/Down pan. Exact chart values remain in a native disclosure table. Empty/unknown history has no seeded chart.
- **Trader coverage:** the existing table renders `Unavailable` for both numerical P&L totals while wallet attribution is incomplete, alongside its textual `partial` status. The existing coverage disclosure explains pending/unresolved counts. Once the API reconciles the backlog, counts and supported P&L update through the normal data-view request. Raw-log and attribution proofs are separate, so actual candles stay visible during attribution backfill. This service-only revision adds no visual tokens or component layout; Chromium verified these states at 390 and 1440px.
- **Badges:** `UNLOCK Pick` is explicitly editorial; `Sponsored` is a paid placement. Neither denotes safety. No badge/placement bypasses eligibility.
- **`Profiles`:** local unpublished preview, PNG upload, up to five social links, verified rights, immutable moderation state, owner tariff settings, saved order review and existing-transfer recovery. There is no default price or unlimited approval.
- **`Radar`:** separate IMD/NFT/public-wallet groups, evidence links, transfer/trade filters, period/page controls, device/server watchlists and configurable coincident-flow timelines. Indexed transfer flows include token-address links so matching symbols stay distinguishable. Identity absence and incomplete coverage are explicit states.
- **`Audit`:** six visible steps, pinned repository/commit, searchable existing-file selection, public scope disclosure, current quote, explicit funding/payment, saved progress/retry and accepted report downloads. Error text says which action to take next.
- **Retained terminal/whitepaper:** continue using the existing trading, quota, claims, treasury and print components; transaction and economic logic remains intact.

## Do's and Don'ts

Start a Labs view inside the existing container and reuse type/color tokens, native controls and 12/16/24px grouping. Keep the task and its primary control high on mobile. Give a long table a labeled local scroll region; give a long identifier its full wrapped value. State snapshot/live coverage and unavailable values next to the data.

Never use FDV as a cap/liquidity fallback, seed invented candles, infer profit from transfers, infer identity from a symbol or wallet connection, or dress a paid placement as organic. Preserve the requested monospace/brand capitals even where a generic visual probe prefers another convention. Add a new page by reusing the Labs heading/nav, one focused working surface, explicit empty/error states and normal-flow controls; do not add a generic hero or a competing palette.

Design guidance attribution: Jakub Krehel's Better Interface (MIT), commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`; documentation method: Paul Bakaus's Impeccable (Apache-2.0), commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Notices/licenses remain in `web/NOTICE.md` and `web/licenses/design-guidance.txt`. Coverage and actual findings/fixes are in `artifacts/validation.md`.
