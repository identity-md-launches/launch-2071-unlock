# Archived UNLOCK Labs

Labs is retired from the public static site in this revision. It is not imported or mounted by `web/src/App.tsx`. Legacy `#labs`, `#labs-*` (including Markets, Radar, Audit and profile links) resolve to Trade without loading a Labs module, config, snapshot, login or payment control.

Preserved for possible later work:

- `web/src/labs/`: original frontend, styles, provider/domain/payment code. Unreferenced by the production entry; retained in its original location to preserve existing test imports and operator references.
- The former `labsFunding` action metadata and native-conversion validator remain only inside this archive's frontend directory. The ordinary trading wallet has no Labs import or payment exception and rejects nonzero native value at preparation and both signing checks. The archived native-payment flow would require deliberate wallet integration before any future reactivation.
- `services/labs/`: backend/indexer source, migrations, payment/order/report persistence and operator tools. No service is started by the site or this task.
- `docs/backend.md`, `docs/labs-data.md` and prior validation under `artifacts/repair/`: historical documentation/evidence; not the current public-product description.
- `archive/labs/snapshots/`: intact Markets and Radar JSON previously copied to `dist/labs/`. They are now outside Vite's public directory and are not published.
- `archive/labs/labs-config.json`: previous static configuration, removed from public delivery.
- Existing backend records, migration schemas, saved reports, order/payment records and browser storage are not deleted or migrated. Retiring the runtime does not call `localStorage.clear()` or erase any Labs keys.

Do not re-enable the archived runtime merely to serve the UNLK chart. The current chart uses a free, browser-accessible exact-pool OHLCV source directly, with no Labs API.

Packaging note: the obsolete `artifacts/repair/change.bundle` transport archive was removed. Its accepted source remains in Git history; operational data, snapshots, reports, order/payment schemas and evidence remain intact.
