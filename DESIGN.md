# UNLOCK website design

## Overview

The site is a mainnet UNLK/IMD trading workspace for launch 2071. It keeps the reference site's near-black editorial identity, mint diamond mark, restrained lock motif and numerical ledgers. Trading is first, followed by personal selling rights, the permanent ladder, treasury/NFTs, explanations and contract provenance. The desktop introduction and swap sit side by side; mobile puts the amount and primary action immediately below a short introduction.

The implementation lives in `web/src/App.tsx`, `NextRelease.tsx`, `NftGallery.tsx`, `wallet.tsx` and `styles.css`. Current chain state changes labels and available actions. No sample metrics or seeded NFT holdings are part of the interface.

## Colors

Canonical tokens are in `web/src/styles.css`, using sRGB hex values.

| Token | Value | Role |
| --- | --- | --- |
| `--ink` | `#09090b` | Page background and text on the mint primary button |
| `--surface` | `#111114` | Swap, notes, dialogs and receipt surface |
| `--hover` | `#1b1b20` | Neutral interactive hover/pressed state |
| `--text` | `#f4f4f5` | Main text |
| `--muted` | `#a1a1aa` | Secondary text and descriptive labels |
| `--line` | `#303036` | Structural separators |
| `--control` | `#71717a` | Interactive outlines |
| `--accent` | `#34d399` | Primary action, actual unlocked rights and diamond mark |
| `--warning` | `#fbbf24` | Next gate and inactive/oracle notices |
| `--error` | `#fca5a5` | Errors |
| `--focus` | `#22d3ee` | Two-pixel keyboard focus perimeter |

The site intentionally has one dark theme. State also has text: Current, Unlocked, Next, Locked, unavailable, pending or confirmed. Accent color never establishes quota by itself. The taste probe measured rendered contrast; its final results are in `web/evidence/design-probe.json`.

## Typography

Prose uses Arial/Helvetica/system sans; numbers, addresses and the wordmark use locally bundled JetBrains Mono Regular (400) and SemiBold (600). Their WOFF2 files are in `web/src/assets/fonts`; the OFL ships in `dist/fonts`. Sans bold can use the system 700 face. No external font service is required.

The six token sizes are 12px (`--small`), 14px (`--body`), 16px (`--input`), 20px (`--subhead`), 28px (`--heading`) and 64px (`--display`). At widths up to 1000px the introduction uses 48px, and at 760px or narrower it uses the 28px heading step. Each rendered width stays within six sizes. Numeric inputs are at least 16px; the amount uses 28px. Body line height is 1.55, headings 1.15, and the desktop display 1.03. Headings use balanced wrapping and modest negative tracking; prose has natural tracking and a 75ch maximum measure. Addresses wrap rather than truncate. The header's short connected address has the full address in its title; transaction reviews show it in full.

## Layout

The main content has a 1280px maximum width and 32px side padding. Header maximum width is 1440px. Sections use 56px vertical padding; related controls generally use 12–24px gaps. Desktop workspace columns are `1.2fr 1fr` with an 80px gap. Rights and treasury use equal columns with 64px gaps. The ladder's data list uses four columns, then three below 1000px and two below 760px.

Below 1000px column gaps tighten. Below 760px the workspace, rights, treasury, explanations and contract list stack; side padding becomes 20px and sections use 36px padding. The header navigation wraps below its brand and wallet control. Secondary introduction statistics and the lock illustration leave the mobile first screen so the swap stays visible. They remain available as live information in the dedicated sections. The NFT strip has fixed-size image areas, horizontal scrolling, visible arrow controls, swipe and arrow-key support. It does not make the whole page scroll horizontally.

Rendered widths checked: 320, 390 and 1440px. The 390×844 screenshot includes the complete primary action. Native browser 200% zoom, RTL and physical-device testing were not performed; see validation coverage.

## Elevation & Depth

This is a flat interface. Tonal surfaces and borders communicate grouping; there are no card shadows, glow layers or gradient text. The swap has a 12px radius and one structural border. Section ledgers use separators rather than nested cards. Native dialogs use a translucent black backdrop, and the receipt is a fixed surface limited to 40vh with internal overflow.

## Shapes

`--radius` is 6px for controls. Swap/dialog/receipt surfaces use 12px. Below 640px, dialogs become bottom sheets with 16px top corners, safe-area bottom padding and a 90dvh maximum height. Wallet rows have a 48px minimum height. Small input outlines use 4px. The diamond is a small inline SVG with a 1.5px stroke. The introduction's lock is decorative and omitted on narrow screens. The ladder is a seventeen-step SVG accompanied by a complete text list, so the drawing is never the only explanation.

## Components

- `Swap` in `NextRelease.tsx`: exact-input buy/sell control, labelled amount and slippage fields, quote details, sequential exact token/Permit2 approvals and review. It has disconnected, wrong-network, inactive, loading, expired, error, approval and ready states. Quotes identify minimum output, fees, impact, expiry, allowances and gas balance; the wallet review estimates gas before signing.
- `Ledger`: shared definition-list pattern for aligned names and values. Values wrap, remain selectable and use tabular numbers.
- `Rights`: real mature-credit ledger and separate native claim, attestation, reward sync and payer sync. Native proof import uses a labelled file input and visible validation errors.
- `Gates`: actual stored tier, next gate, estimated price progress and all sixteen FDV gates plus initial 20%. Past sales and permanent global bypass are explained beside the list.
- `NftGallery`: official collection filtering, onchain ownership and metadata verification, loading/error/stale/empty states and bounded inert image rendering. The custody count is read from the collection, not assumed from the indexer.
- `ConnectButton`, `WalletProvider`, `Modal` in `wallet.tsx`: EIP-6963 named browser wallets, phone deep links and Coinbase Smart Wallet in one native dialog. Native modal behavior supplies focus containment and Escape dismissal; focus returns to the trigger. Account/network changes invalidate reviewed actions. Each write has its own wallet confirmation. Final preparation revalidates the action; quote expiry closes review and displays “Get a new quote; nothing was sent” in the existing transaction status surface. The revision adds no visual tokens or layout changes. See `web/evidence/quote-slow-gas.jpg` and the six-domain review in `web/evidence/validation.md`.
- `.button.primary` is the mint action; `.button` is neutral; `.text-button` is an underlined utility. Native disabled states remain legible and have adjacent explanations. Focus uses a 2px outline with 4px offset. Hover is restrained; optional press motion is `scale(.96)` over 150ms. Reduced motion removes transitions and smooth scrolling; forced colors retain system focus.

## Do's and Don'ts

Use the shared tokens, section layout, ledgers, button variants and native controls when adding a section. Start with a labelled heading and a real data/error/empty state. Keep wallet and contract logic in the existing verified adapters. Use bigint for asset and quota calculations; format unavailable values explicitly and preserve exact amounts in consequential reviews.

Keep price estimates separate from stored rights. Do not turn quotes into quota eligibility claims, restore preview labels, insert sample holdings or display a missing price as zero. Avoid extra type sizes, shadows, nested cards, new accent colors and decorative hero content that moves the swap below the first mobile screen.

Design guidance: Jakub Krehel's Better Interface (MIT), pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method: Paul Bakaus's Impeccable (Apache-2.0), commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Notices and licenses are retained in `web/NOTICE.md` and `web/licenses/design-guidance.txt`.
