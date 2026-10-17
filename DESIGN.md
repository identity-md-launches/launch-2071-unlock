# UNLOCK terminal design

The interface is a compact UNLK/IMD trading terminal. Its amber staircase is the visual explanation of permanent selling rights; green indicates earned onchain rights and cyan identifies the selected scenario. Presentation was recovered from `web/src/styles.css` and `App.tsx` at commit `40d70b7bd0853aedf84eac839a40a5f12e6ac341`. Current mainnet execution and signing guards are retained from `ffae6425390ebabad6dd89d83aae0c200d250e26`.

## Colors and surfaces

Canonical tokens are in [`web/src/styles.css`](web/src/styles.css). The interface has one dark theme.

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#09090b` | Page, fields, primary-button text |
| `--surface` | `#111114` | Terminal panels and dialogs |
| `--hover` | `#1c1c21` | Hover and selected neutral surfaces |
| `--line` | `#27272a` | Thin structural borders and dividers |
| `--control` | `#71717a` | Interactive outlines |
| `--text` | `#f4f4f5` | Main text |
| `--muted` | `#a1a1aa` | Labels, secondary text |
| `--accent` | `#34d399` | Earned rights, buy action, brand |
| `--warning` | `#fbbf24` | Future gates, activation status |
| `--focus` | `#22d3ee` | Selected scenario, keyboard focus |
| `--sell` | `#f472b6` | Sell direction and action |
| `--error` | `#fca5a5` | Errors |

Panels use a 1px border and a 6px radius (`--radius`). Small controls/tags use 4px corners. There are no gradients, glass surfaces, decorative shadows or entrance animations. Dialog backdrops darken the page. Color is accompanied by text, line patterns, rings or selected-state semantics. The rendered contrast probe passed its measured text checks; SVG artwork and all possible dynamic states are outside that measurement.

## Typography

Locally hosted **JetBrains Mono** is used throughout, including prose, controls and numbers, as requested. Files are `web/src/assets/fonts/jetbrains-mono-regular.woff2` (400) and `jetbrains-mono-semibold.woff2` (600); the production build fingerprints both. Fallbacks are `ui-monospace, SFMono-Regular, Consolas, monospace`. `font-display: swap`, `font-synthesis: none` and tabular numerals are set on the root.

The six tokens are 12px labels (`--small`), 14px body (`--body`), 16px inputs/subtitles (`--input`), 20px section headings (`--subhead`), 24px compact title (`--heading`) and 28px desktop title (`--large`). Body line height is 1.5; headings use 1.2. Headings tighten tracking slightly; prose uses natural spacing and a maximum 75ch measure. Amounts and accounting retain selectable text. Contract addresses wrap instead of being clipped. SVG label sizes adapt to the chart's scaled coordinate system; they are not an additional document type scale. Mobile inputs remain at least 16px, except the intentionally larger amount field.

## Layout and spacing

The content and header have a 1344px maximum width, 32px desktop side padding and shared alignment edges. Standard gaps are 8, 12, 16, 20, 24 and 32px. The header has brand, six section links and wallet control. A thin mainnet/status strip precedes the UNLK/IMD title and four-cell live summary. The workspace uses `minmax(0, 7fr) minmax(320px, 3fr)` with a 16px gap and aligned top edges.

Below the workspace, the page presents read freshness, wallet accounting/native actions, treasury accounting/NFTs, concise English rules and verified contract links. Required explanations use progressive disclosure where appropriate. No marketing hero separates the product from the action.

| Breakpoint | Implemented behavior |
| --- | --- |
| Above 1100px | Four summary cells, full desktop ticks, ladder/history left and swap right |
| At 1100px | Two-by-two summary, fewer tick labels, tighter header; every gate remains in the select/list |
| At 900px | Workspace stacks with swap first; navigation moves to its own row; 24px page padding |
| At 600px | 16px page padding, compact summary and swap, single-column accounting/docs, native wallet bottom sheet, sparse chart ticks with complete selector |
| At 360px | Header navigation wraps; controls/readouts adapt without horizontal page scroll |

NFTs use a compact horizontal scrolling rail with 144px cards; wheel/touch, keyboard focus and previous/next controls remain available. The history table scrolls within its named region. Representative widths 320, 390, 768, 900, 1000 and 1440 were checked on the production export. Native 200% browser zoom and physical devices were not tested.

## Components and interaction states

- [`App.tsx`](web/src/App.tsx): diamond UNLOCK_ brand, hash navigation with current-section state, skip link, header wallet control, footer.
- [`MarketTerminal.tsx`](web/src/MarketTerminal.tsx): accessible Ladder/History tabs, amber dashed categorical staircase, green earned path, separate current/next/selected marks, native gate selector, all-gates disclosure and wallet-reviewed milestone observation. Initial 20% plus all sixteen gates end at $50M/100%. Selecting a future gate never changes confirmed rights. Native titles provide pointer tooltips; select/list expose every gate by keyboard and touch.
- [`poolHistory.ts`](web/src/poolHistory.ts): official PoolManager/pool Swap events only; explicit complete block coverage, chain/freshness/reorg checks, cancellation and bounded ranges. The view distinguishes loading, verified empty range, real observations and retryable errors. It describes even event spacing and IMD units.
- [`NextRelease.tsx`](web/src/NextRelease.tsx): four-cell summary, buy/sell form, accounting ledgers and native actions. Swap direction, input/receive symbols and action color agree. Inactive trading disables execution while preserving wallet connection and independent claims. Unknown FDV is unavailable, never zero. Review and signing use the existing verified transaction code.
- [`wallet.tsx`](web/src/wallet.tsx): existing EIP-6963 discovery, wallet-browser links, Coinbase Smart Wallet and native review/connect dialogs. Dialogs trap focus, close with Escape and restore focus. Rejection, pending, confirmation, replacement and timeout states never automatically resend.
- [`NftGallery.tsx`](web/src/NftGallery.tsx): collection and ownership verified onchain; ID/image cards, bounded inert image blobs, loading/empty/error/retry states. An image failure preserves the verified ID. Custody is not proof of a fee-funded purchase.

Buttons and fields have visible boundaries; most action controls are at least 44px tall. Compact mobile navigation is 32px; measured targets meet the probe's 24px-or-spacing minimum. Focus uses a 2px cyan outline with 3px offset. Errors and changing status use alert/status/live-region semantics. Reduced-motion preferences disable smooth scrolling and transitions.

## Extending this interface

Use the existing section, heading, ledger and button patterns for another read-only view. Keep source-of-truth labels next to estimates and display coverage/freshness for new data. Use green for earned/buy, amber for future and cyan for selection; retain pink for sell. Keep detailed explanations below the primary interaction, preserve wrapping addresses, and do not introduce a second font or oversized hero. Additional wallet writes must retain the shared review, validation and simulation path.

Applied guidance: [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), Jakub Krehel, MIT; documentation method: [Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), Paul Bakaus, Apache-2.0. Six-domain coverage, fixes, screenshots and limitations are in [`artifacts/validation.md`](artifacts/validation.md).
