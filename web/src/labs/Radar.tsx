import { coincidentFlows } from "./domain.mjs";
import "./terminal.css";
import { useEffect, useMemo, useState } from "react";
import {
  amountLabel,
  dateLabel,
  downloadHolderCsv,
  holderRequest,
  isAddress,
  isRadarData,
  shortAddress,
  timestamp,
  usd,
  useLabsResource,
  type LabsDataProps,
  type RadarEvent,
  type RadarPeriod,
  type RadarWallet,
} from "./data";
import "./market-radar.css";

const periodHours: Record<RadarPeriod, number> = { "1h": 1, "24h": 24, "7d": 168 };
const kindLabel: Record<RadarEvent["type"], string> = { buy: "Buy", sell: "Sell", transfer: "Transfer", liquidity: "Liquidity" };
const validHash = (hash: string) => /^0x[a-fA-F0-9]{64}$/.test(hash);
const isSettlement = (event: RadarEvent) => event.relatedActivity === "swap" || event.relatedActivity === "liquidity";

function AddressLink({ address }: { address: string | null | undefined }) {
  return address && isAddress(address) ? <a className="address" href={`https://etherscan.io/address/${address}`} target="_blank" rel="noopener noreferrer">{address}</a> : <span className="muted">Unavailable</span>;
}

function EventRow({ event }: { event: RadarEvent }) {
  const kind = kindLabel[event.type] || "Unknown event";
  const settlement = event.type === "transfer" && isSettlement(event) ? ` · ${event.relatedActivity} settlement` : "";
  return <li className="lab-event">
    <div className="lab-event-heading"><span className={`lab-event-kind lab-event-${event.type}`}>{kind}{settlement}</span><strong>{event.symbol || "Token unavailable"}</strong><span className="lab-event-amount">{amountLabel(event.amount)} {event.symbol}</span></div>
    <p className="small muted">{dateLabel(event.time)} · Block {event.block.toLocaleString("en-US")}{event.amountUsd != null ? ` · ${usd(event.amountUsd)}` : " · USD value unavailable"}</p>
    <p className="small">{event.wallet && isAddress(event.wallet) ? <><a href={`https://etherscan.io/address/${event.wallet}`} target="_blank" rel="noopener noreferrer">{shortAddress(event.wallet)}</a> · </> : null}{event.attribution || "Trader attribution unavailable; routing infrastructure is not an individual wallet."}</p>
    {event.sale&&<p className="small">Evidenced NFT sale · {amountLabel(event.sale.amountEth)} ETH total · <a href={`https://etherscan.io/address/${event.sale.seller}`}>Seller</a> → <a href={`https://etherscan.io/address/${event.sale.buyer}`}>Buyer</a> · <a href={event.sale.sourceUrl} target="_blank" rel="noreferrer">Verified venue source ↗</a></p>}
    <details><summary>View {kind.toLowerCase()} source</summary><dl className="lab-source-list">
      <div><dt>Transaction</dt><dd>{validHash(event.hash) ? <a className="address" href={`https://etherscan.io/tx/${event.hash}`} target="_blank" rel="noopener noreferrer">{event.hash}</a> : "Unavailable"}</dd></div>
      <div><dt>Token</dt><dd><AddressLink address={event.token} /></dd></div>
      <div><dt>Exact token amount</dt><dd><code>{event.amount ?? "Unavailable"}</code></dd></div>
      {event.poolId && <div><dt>v4 PoolId</dt><dd><code>{event.poolId}</code></dd></div>}
      {event.from && <div><dt>From</dt><dd><AddressLink address={event.from} /></dd></div>}
      {event.to && <div><dt>To</dt><dd><AddressLink address={event.to} /></dd></div>}
    </dl></details>
  </li>;
}

function WalletCard({ wallet, period, netFlowSupported, watched, canUseHolder, busy, onWatch }: {
  wallet: RadarWallet;
  period: RadarPeriod;
  netFlowSupported: boolean;
  watched: boolean;
  canUseHolder: boolean;
  busy: boolean;
  onWatch: (address: string) => void;
}) {
  return <article className="lab-wallet-card">
    <div className="lab-wallet-heading"><h3><a href={`https://etherscan.io/address/${wallet.address}`} target="_blank" rel="noopener noreferrer">{shortAddress(wallet.address)}</a></h3><span className="small muted">{wallet.label||"Observed wallet · identity unknown"}</span></div>
    <dl className="lab-wallet-balances">
      {wallet.holdings.map((holding) => <div key={holding.address}><dt>{holding.symbol} holdings</dt><dd>{amountLabel(holding.balance)}<span className="small muted lab-block">{holding.usd == null ? "USD value unavailable" : usd(holding.usd)}</span></dd></div>)}
      {(!wallet.holdings || wallet.holdings.length === 0) && <div><dt>Current holdings</dt><dd>Unavailable</dd></div>}
      {netFlowSupported ? wallet.netFlow.map((flow, index) => <div key={`${flow.chainId}-${flow.address||index}`}><dt>{flow.symbol} indexed transfer flow · {period}{flow.address&&<><br/><a href={`https://etherscan.io/token/${flow.address}`} title={flow.address}>{shortAddress(flow.address)}</a></>}</dt><dd>{flow.amount != null && Number(flow.amount) > 0 ? "+" : ""}{amountLabel(flow.amount)}</dd></div>) : <div><dt>Indexed transfer flow · {period}</dt><dd>Unavailable for this snapshot period</dd></div>}
    </dl>
    {wallet.attributionUrl&&<p className="small"><a href={wallet.attributionUrl} target="_blank" rel="noreferrer">Public attribution evidence ↗</a></p>}
    {wallet.nfts&&wallet.nfts.length>0&&<div><h4>Verified sampled NFT holdings</h4>{wallet.nfts.map(n=><a className="button" href={n.evidenceUrl} key={n.tokenId} target="_blank" rel="noreferrer">{n.name} ↗</a>)}</div>}
    <p className="small muted">{wallet.source || "Bounded sample of observed counterparties. No identity is inferred."}</p>
    <details><summary>View full wallet and coverage</summary><div className="lab-details-content"><AddressLink address={wallet.address} /><dl className="lab-source-list">{wallet.holdings.map((holding) => <div key={holding.address}><dt>Exact {holding.symbol} balance</dt><dd><code>{holding.balance ?? "Unavailable"}</code></dd></div>)}</dl><p className="small muted">Holdings are the latest indexed balance. Indexed transfer flow includes swap and liquidity settlement movements within covered history. It is not cost basis or profit.</p><button className="button" type="button" disabled={!canUseHolder || busy} onClick={() => onWatch(wallet.address)}>{watched ? "Remove wallet from watchlist" : "Save wallet to watchlist"}</button></div></details>
  </article>;
}

export function Radar({ apiBase, session }: LabsDataProps) {
  const [period, setPeriod] = useState<RadarPeriod>("24h");
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const [snapshotPage, setSnapshotPage] = useState(0);
  const path = `radar?period=${period}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const resource = useLabsResource(apiBase, path, "./labs/radar.json", isRadarData);
  const [kind, setKind] = useState("swaps");
  const [watchlist, setWatchlist] = useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("unlk-radar-watch-v2")||"[]").filter(isAddress).slice(0,20);}catch{return [];}});
  const [category,setCategory]=useState("imd"),[flowWindow,setFlowWindow]=useState("900"),[watchInput,setWatchInput]=useState("");
  const [watchOnly, setWatchOnly] = useState(false);
  const [busy, setBusy] = useState("");
  const [holderError, setHolderError] = useState("");
  const [message, setMessage] = useState("");
  const canUseHolder = Boolean(apiBase && session?.eligible);
  useEffect(() => {
    let active = true;
    setWatchOnly(false);
    setHolderError("");
    setMessage("");
    if (canUseHolder) {
      void holderRequest<{ addresses: string[] }>(apiBase, "holder/watchlist", session).then((result) => {
        if (active) setWatchlist(Array.isArray(result.addresses) ? result.addresses.filter(isAddress) : []);
      }).catch((error) => { if (active) setHolderError(error instanceof Error ? error.message : "Unable to load watchlist. Try again."); });
    }
    return () => { active = false; };
  }, [apiBase, session?.token, canUseHolder]);

  const end = timestamp(resource.data?.coverage.toTime) || timestamp(resource.data?.updatedAt) || Date.now();
  const from = end - periodHours[period] * 3_600_000;
  const filteredEvents = useMemo(() => [...(resource.data?.events || []),...(category==="nft"?resource.data?.nftEvents||[]:[])].filter((event) => {
    if(category==="nft"&&event.token!=="0x0000ec93127baa929e58e97dd0095a2bfb38ec1d")return false;
    if(category==="public"&&!resource.data?.wallets.some(w=>w.category==="public"&&[event.wallet,event.from,event.to].includes(w.address)))return false;
    const time = timestamp(event.time);
    if (time == null || time < from || time > end) return false;
    if (kind === "swaps" && event.type !== "buy" && event.type !== "sell") return false;
    if (kind === "transfers" && (event.type !== "transfer" || isSettlement(event))) return false;
    if (kind === "settlements" && (event.type !== "transfer" || !isSettlement(event))) return false;
    if (kind === "liquidity" && event.type !== "liquidity") return false;
    return true;
  }), [resource.data, from, end, kind,category]);
  const isSnapshot = resource.fallback || resource.data?.mode === "snapshot";
  const warming = resource.data?.mode === "warming";
  const pageSize = Math.min(200, resource.data?.snapshotPageSize || 100);
  const localPage = isSnapshot || category === "nft";
  const events = localPage ? filteredEvents.slice(snapshotPage * pageSize, (snapshotPage + 1) * pageSize) : filteredEvents.slice(0, 200);
  const wallets = (resource.data?.wallets || []).filter((wallet) => (wallet.category||"imd")===category && isAddress(wallet.address) && (!watchOnly || watchlist.some((address) => address.toLowerCase() === wallet.address.toLowerCase()))).slice(0, 20);
  const netFlowSupported = resource.data?.period === period;
  const coverageStart = timestamp(resource.data?.coverage.fromTime);
  const incompletePeriod = coverageStart != null && coverageStart > from;
  const incompleteHistory = resource.data?.coverage.missingHistory === true;
  const observed = timestamp(resource.data?.updatedAt);
  const stale = observed != null && Date.now() - observed > 15 * 60_000;

  async function perform(key: string, task: () => Promise<void>) {
    setBusy(key);
    setHolderError("");
    setMessage("");
    try { await task(); }
    catch (error) { setHolderError(error instanceof Error ? error.message : "The action failed. Try again."); }
    finally { setBusy(""); }
  }

  async function toggleWatch(address: string) {
    if(!canUseHolder){const next=watchlist.includes(address)?watchlist.filter(a=>a!==address):[...watchlist,address].slice(0,20);setWatchlist(next);try{localStorage.setItem("unlk-radar-watch-v2",JSON.stringify(next));setMessage("Watchlist saved on this device.");}catch{setMessage("Watchlist saved for this visit only.");}return;}
    await perform("watchlist", async () => {
      const next = watchlist.includes(address) ? watchlist.filter((item) => item !== address) : [...watchlist, address];
      const result = await holderRequest<{ addresses: string[] }>(apiBase, "holder/watchlist", session, { method: "PUT", body: JSON.stringify({ addresses: next }) });
      if (!Array.isArray(result.addresses)) throw Error("The watchlist could not be saved. Try again.");
      setWatchlist(result.addresses.filter(isAddress));
      setMessage("Wallet watchlist saved on the server.");
    });
  }

  async function filterWatchlist(next: boolean) {
    if (!next) { setWatchOnly(false); return; }
    if(!canUseHolder){setWatchOnly(true);return;}
    await perform("filter", async () => {
      const result = await holderRequest<{ addresses: string[] }>(apiBase, "holder/watchlist", session);
      if (!Array.isArray(result.addresses)) throw Error("The watchlist is unavailable. Refresh and try again.");
      setWatchlist(result.addresses.filter(isAddress));
      setWatchOnly(true);
      setMessage("Saved wallet filter applied after a server balance check.");
    });
  }

  function choosePeriod(value: RadarPeriod) { setPeriod(value); setCursor(null); setPreviousCursors([]); setSnapshotPage(0); }

  const flows=coincidentFlows(resource.data?.events||[],watchlist,Number(flowWindow));
  return <section className="lab-data" aria-labelledby="labs-radar-title">
    <div className="lab-data-heading"><div><h2 id="labs-radar-title">Radar</h2><p className="muted">Ethereum flows with transaction evidence.</p></div><button className="button" type="button" aria-label="Refresh radar" disabled={resource.loading} onClick={() => { setSnapshotPage(0); resource.refresh(); }}>{resource.loading ? "Loading…" : "Refresh"}</button></div>
    <div className="radar-categories" aria-label="Whale groups">{[["imd","IMD token whales"],["nft","identity.md NFT whales"],["public","Public wallets"]].map(([id,label])=><button className="button" key={id} aria-pressed={category===id} onClick={()=>{setCategory(id);setSnapshotPage(0);if(id==="nft")setKind("all");}}>{label}</button>)}</div>
    {category==="public"&&<p className="small muted">Public personal-wallet attribution needs reliable evidence. Unpublished: {(resource.data?.unresolvedPublicIdentities||["Vitalik","CZ","Asem"]).join(", ")||"none"}. Exchange custody is excluded.</p>}
    {category==="nft"&&<p className="small muted">NFT refresh: {dateLabel(resource.data?.extraUpdatedAt)}. Verified sampled owners; transfers are not purchases. Supported marketplace fills carry separate sale evidence.</p>}
    <div className="lab-radar-controls">
      <label className="lab-field">Observation period<select aria-label="Observation period" value={period} onChange={(event) => choosePeriod(event.target.value as RadarPeriod)}><option value="1h">1 hour</option><option value="24h">24 hours</option><option value="7d">7 days</option></select></label>
      <label className="lab-field">Event type<select aria-label="Event type" value={kind} onChange={(event) => { setKind(event.target.value); setSnapshotPage(0); }}><option value="swaps">Swaps</option><option value="transfers">Transfers</option><option value="settlements">Settlements</option><option value="liquidity">Liquidity</option><option value="all">All activity</option></select></label>
    </div>
    <div className="lab-coverage">
      {warming && <p className="small warning" role="status">Indexer warming; no live readings are available yet.</p>}
      {incompletePeriod && <p className="small warning">Partial {period}: earlier history is missing.</p>}
      {incompleteHistory && !incompletePeriod && <p className="small warning">Incomplete history: index limits can omit activity within this period.</p>}
      {!apiBase && <p className="small muted">Live refresh requires the LABS service.</p>}
      {stale && <p className="small warning">Stale observation · more than 15 minutes old.</p>}
      {apiBase && resource.error && <p className="small warning" role="status">{resource.error}</p>}
      <details><summary>{warming ? "Indexer warming" : isSnapshot ? <span className="warning">Snapshot</span> : "Cached index"} · {warming ? "No observation yet" : dateLabel(resource.data?.updatedAt)}<span className="muted"> · Coverage</span></summary><div className="lab-details-content"><p className="small muted">Coverage {dateLabel(resource.data?.coverage.fromTime)} → {dateLabel(resource.data?.coverage.toTime)} · Blocks {resource.data?.coverage.fromBlock?.toLocaleString("en-US") ?? "unavailable"}–{resource.data?.coverage.toBlock?.toLocaleString("en-US") ?? "unavailable"}</p>{resource.data && !netFlowSupported && <p className="small warning">This response was indexed for {resource.data.period}. Events are filtered to {period}; wallet net flow for {period} is unavailable until the service supplies that period.</p>}{resource.data?.coverage.notes.map((note, index) => <p className="small muted" key={index}>{note}</p>)}{resource.data?.errors.map((error, index) => <p className="small warning" key={index}>{error}</p>)}</div></details>
    </div>
    <div className="lab-radar-layout">
      <section aria-labelledby="radar-events-title"><div className="lab-list-heading"><h3 id="radar-events-title">Observed activity</h3><span className="small muted" role="status">{warming ? "Awaiting first index" : `${events.length} shown${localPage ? ` of ${filteredEvents.length}` : " · up to 200 per page"}`}</span></div>
        <p className="small muted lab-attribution-note">Traders require evidence; router balances do not identify people.</p>
        <ul className="lab-event-list">{events.map((event) => <EventRow event={event} key={event.id} />)}</ul>
        {!resource.loading && !events.length && <div className="lab-empty"><p>{warming ? "The service has not completed its first activity scan. No live activity has been indexed yet." : `No ${kind === "all" ? "activity" : kind} were observed in this covered page and period.`}</p><p className="small muted">Missing history or an indexing limit can also leave this view empty. Try another event type, period or page.</p><button className="button" type="button" onClick={() => { setKind("all"); resource.refresh(); }}>Show all covered activity</button></div>}
        <nav className="lab-pagination" aria-label="Radar event pages"><button className="button" type="button" disabled={resource.loading || (localPage ? snapshotPage === 0 : previousCursors.length === 0)} onClick={() => { if (localPage) { setSnapshotPage((page) => Math.max(0, page - 1)); return; } const previous = [...previousCursors]; setCursor(previous.pop() ?? null); setPreviousCursors(previous); }}>Previous page</button><span className="small muted">Page {(localPage ? snapshotPage : previousCursors.length) + 1}</span><button className="button" type="button" disabled={resource.loading || (localPage ? (snapshotPage + 1) * pageSize >= filteredEvents.length : !resource.data?.nextCursor)} onClick={() => { if (localPage) { setSnapshotPage((page) => page + 1); return; } setPreviousCursors((current) => [...current, cursor]); setCursor(resource.data?.nextCursor || null); }}>Next page</button></nav>
      </section>
      <section aria-labelledby="radar-wallets-title"><div className="lab-list-heading"><h3 id="radar-wallets-title">Wallet watch</h3><span className="small muted">Bounded to 20</span></div><p className="small muted lab-attribution-note">Balances among observed counterparties, not a complete holder ranking. No identities or trading ability are inferred.</p>
        <div className="lab-wallet-list">{wallets.map((wallet) => <WalletCard wallet={wallet} key={wallet.address} period={period} netFlowSupported={netFlowSupported} watched={watchlist.includes(wallet.address)} canUseHolder={true} busy={!!busy} onWatch={toggleWatch} />)}</div>
        {!resource.loading && !wallets.length && <div className="lab-empty"><p>{watchOnly ? "No saved wallets are present in this indexed sample." : "Wallet balances are unavailable for this covered sample."}</p>{watchOnly && <button className="button" type="button" onClick={() => setWatchOnly(false)}>Show all observed wallets</button>}</div>}
      </section>
    </div>
    <section className="lab-holder-panel" aria-labelledby="radar-holder-title"><h3 id="radar-holder-title">Watchlists and exports</h3><p className="small muted">{!apiBase ? "Device watchlists work locally. Server watchlists and exports require the connected Labs service." : !canUseHolder ? "Sign in above with a positive UNLK balance on Ethereum to save wallets and export data." : "The service rechecks your session and current positive UNLK balance for every protected request."} Holding UNLK requires no staking or transfers and does not cover Audit job payments.</p>
      <div className="lab-holder-controls"><label className="lab-check"><input type="checkbox" checked={watchOnly} disabled={!!busy} onChange={(event) => filterWatchlist(event.target.checked)} />Show saved wallets only</label><button className="button" type="button" disabled={!canUseHolder || !!busy} onClick={() => perform("export", async () => { await downloadHolderCsv(apiBase, "radar", session); setMessage("Radar CSV downloaded after a server balance check."); })}>{busy === "export" ? "Preparing CSV…" : "Export radar CSV"}</button></div>
      <p className="small lab-action-status" role="status">{message}</p>{holderError && <p className="small error" role="alert">{holderError}</p>}
    </section>
    <section className="radar-coincidences" aria-labelledby="radar-flow-title"><h3 id="radar-flow-title">Coincident watched-wallet flows</h3><div className="lab-radar-controls"><label className="lab-field">Watch an Ethereum wallet<input value={watchInput} onChange={e=>setWatchInput(e.target.value)} placeholder="0x…"/></label><button className="button" onClick={()=>{if(!isAddress(watchInput)){setHolderError("Enter a full Ethereum address to watch.");return;}void toggleWatch(watchInput.toLowerCase());setWatchInput("");}}>Save wallet</button><label className="lab-field">Coincidence window<select aria-label="Coincidence window" value={flowWindow} onChange={e=>setFlowWindow(e.target.value)}><option value="60">1 minute</option><option value="300">5 minutes</option><option value="900">15 minutes</option><option value="3600">1 hour</option></select></label></div><p className="small muted">Two or more watched wallets buying or selling the same asset in this covered page. Coincident flows are not proven coordination. Multi-swap routing and internal settlement transfers are excluded.</p>{flows.map(g=><article className="radar-flow" key={g.key}><strong>{g.symbol} · {g.type} · {g.wallets.length} wallets</strong><p className="small muted">{dateLabel(g.from)} to {dateLabel(g.to)}</p><ul>{g.rows.map(e=><li className="small" key={e.id}><a href={`https://etherscan.io/address/${e.wallet}`}>{shortAddress(e.wallet)}</a> · {amountLabel(e.amount)} {e.symbol} · <a href={`https://etherscan.io/tx/${e.hash}`}>Transaction ↗</a></li>)}</ul></article>)}{!flows.length&&<p className="small muted">No supported coincident flows among the saved wallets in this covered page.</p>}<div className="labs-actions">{watchlist.map(a=><button className="button" key={a} onClick={()=>void toggleWatch(a)}>Remove {shortAddress(a)}</button>)}</div></section>
    <details className="lab-pool-coverage"><summary>Read pool coverage ({resource.data?.pools.length ?? 0} pools)</summary><div className="lab-details-content">{resource.data?.pools.map((pool, index) => <dl key={pool.poolId || pool.id || pool.address || index} className="lab-source-list"><div><dt>Pool {index + 1}</dt><dd>{pool.symbol || pool.name || "Ethereum IMD ecosystem pool"}</dd></div>{(pool.poolId || pool.id) && <div><dt>{pool.version || "v4"} PoolId</dt><dd><code>{pool.poolId || pool.id}</code></dd></div>}{pool.address && <div><dt>Pool token contract</dt><dd><AddressLink address={pool.address} /></dd></div>}</dl>)}<p className="small muted">A v4 PoolId identifies a pool; the shared PoolManager address does not identify an individual trader. Provider limits, cursor pagination and the stated coverage bound every result.</p></div></details>
  </section>;
}

export default Radar;
