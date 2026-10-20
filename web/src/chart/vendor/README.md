# Chart runtime provenance

TradingView Lightweight Charts 5.2.1, unmodified standalone production ES module and upstream TypeScript declarations. Downloaded from the official npm `lightweight-charts@5.2.1` package on 2026-10-20. No package manifest or configured dependency was changed.

- `lightweight-charts.mjs`: `dist/lightweight-charts.standalone.production.mjs`, SHA-256 `1bb1ee79f9d4dd17261b53d930f7a8995748276f80e7ba0e24412b5068062f5f`.
- `lightweight-charts.d.mts`: `dist/typings.d.ts`, SHA-256 `e3d7cd2e718e92c4f61413f1b15aebb39f20c9e987a138b30e575c7843cc8c71` (renamed for the local ES module).
- License: `web/licenses/lightweight-charts-5.2.1.txt`, Apache-2.0.
- Upstream NOTICE: `web/public/chart-NOTICE.txt`, obtained from `https://raw.githubusercontent.com/tradingview/lightweight-charts/v5.2.1/NOTICE`.

The visible chart includes the library attribution logo, the NOTICE text, and the TradingView link. This is a chart renderer only. Market data comes directly from GeckoTerminal's public API, not TradingView or DEXTools. No DEXTools branding or assets are used.

The necessary runtime is retained locally for static/IPFS hosting; no CDN script or npm registry is needed in production. The npm archive is not part of the submission.
