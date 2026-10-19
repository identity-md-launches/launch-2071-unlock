import { useEffect, useMemo, useState } from "react";
import {
  dateLabel,
  downloadHolderCsv,
  holderRequest,
  isAddress,
  isMarketsData,
  safeLink,
  shortAddress,
  timestamp,
  usd,
  useLabsResource,
  type LabsDataProps,
  type Market,
} from "./data";
import "./market-radar.css";

function ExternalLink({ href, children }: { href?: string | null; children: React.ReactNode }) {
  const safe = safeLink(href);
  return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}<span className="sr-only"> (opens in a new tab)</span></a> : null;
}

function PriceHistory({ market }: { market: Market }) {
  const points = (market.chart || []).filter((point) => Number.isFinite(point.price) && point.price > 0 && timestamp(point.time) != null).sort((a, b) => timestamp(a.time)! - timestamp(b.time)!).slice(-200);
  if (points.length < 2) return <p className="muted small">Historical chart unavailable for this pool. A current quote alone is not a price history.</p>;
  const low = Math.min(...points.map((point) => point.price));
  const high = Math.max(...points.map((point) => point.price));
  const start = timestamp(points[0].time)!;
  const end = timestamp(points[points.length - 1].time)!;
  const range = high - low || high * 0.02 || 1;
  const coordinates = points.map((point) => `${12 + ((timestamp(point.time)! - start) / (end - start || 1)) * 576},${100 - ((point.price - low) / range) * 80}`).join(" ");
  return <figure className="lab-price-chart">
    <svg viewBox="0 0 600 116" role="img" aria-label={`${market.symbol} observed USD prices from ${dateLabel(points[0].time)} to ${dateLabel(points[points.length - 1].time)}. Lowest ${usd(low)}; highest ${usd(high)}.`}>
      <line x1="12" x2="588" y1="100" y2="100" className="lab-chart-axis" />
      <polyline points={coordinates} className="lab-chart-line" />
    </svg>
    <figcaption className="small muted">Observed prices · {dateLabel(points[0].time)} → {dateLabel(points[points.length - 1].time)} · {points.length} points</figcaption>
    <details className="lab-chart-values"><summary>Read chart values</summary><div className="lab-chart-value-list">{points.map((point, index) => <p key={`${point.time}-${index}`}>{dateLabel(point.time)} · {usd(point.price)}</p>)}</div></details>
  </figure>;
}

function Change({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <>Unavailable</>;
  return <span className={value > 0 ? "accent" : value < 0 ? "sell-text" : ""}>{value > 0 ? "+" : ""}{value.toFixed(2)}%</span>;
}

function MarketCard({ market, featured, rank, canUseHolder, selected, watched, busy, onSelect, onWatch }: {
  market: Market;
  featured?: boolean;
  rank?: number;
  canUseHolder: boolean;
  selected: boolean;
  watched: boolean;
  busy: boolean;
  onSelect: (address: string) => void;
  onWatch: (address: string) => void;
}) {
  const created = timestamp(market.createdAt);
  const days = created == null ? null : Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
  return <article className={`lab-market-card${featured ? " lab-featured" : ""}`}>
    <div className="lab-market-heading">
      <div>
        <h3>{rank != null && <span className="muted lab-rank">{rank.toString().padStart(2, "0")}</span>}{market.symbol || "Unknown token"} <span className="muted lab-market-name">{market.name}</span></h3>
        <p className="small muted">Ethereum · chain {market.chainId} · {featured ? "Featured separately from launch rankings" : `Launch ${market.launchNumber ?? "number unavailable"}`} · {days == null ? "Age unavailable" : days === 0 ? "Less than 1 day old" : `${days} day${days === 1 ? "" : "s"} old`}</p>
      </div>
      <div className="lab-market-price"><strong>{usd(market.priceUsd)}</strong><span className="small">24h <Change value={market.priceChange24h} /></span></div>
    </div>
    <dl className="lab-market-metrics">
      <div><dt>Volume · 24h</dt><dd>{usd(market.volume24h)}</dd></div>
      <div><dt>Pool liquidity</dt><dd>{usd(market.liquidityUsd)}</dd></div>
      <div><dt>FDV</dt><dd>{usd(market.fdv)}</dd></div>
      {market.marketCap != null && <div><dt>Market cap</dt><dd>{usd(market.marketCap)}</dd></div>}
    </dl>
    <details className="lab-market-detail">
      <summary>View {market.symbol || "token"} chart, contract and pool</summary>
      <div className="lab-details-content">
        <PriceHistory market={market} />
        <dl className="lab-source-list">
          <div><dt>Token contract</dt><dd><a className="address" href={`https://etherscan.io/token/${market.address}`} target="_blank" rel="noopener noreferrer">{market.address}</a></dd></div>
          {market.poolId && <div><dt>PoolId</dt><dd><code>{market.poolId}</code></dd></div>}
          <div><dt>Observed</dt><dd>{dateLabel(market.observedAt)}</dd></div>
          <div><dt>Source</dt><dd>{market.source || "Unavailable"}</dd></div>
          {market.status && <div><dt>Coverage</dt><dd>{market.status}</dd></div>}
        </dl>
        <div className="lab-link-row"><ExternalLink href={market.projectUrl}>{market.symbol || market.name || "Token"} project</ExternalLink><ExternalLink href={market.sourceUrl}>Launch record</ExternalLink><ExternalLink href={market.repoUrl}>Source repository</ExternalLink><ExternalLink href={market.poolUrl}>Open verified pool</ExternalLink><ExternalLink href={market.chartUrl}>Open source chart</ExternalLink></div>
        <p className="small muted">FDV uses total supply. Market cap is shown only when circulating supply is supported. Liquidity does not establish safety.</p>
        <div className="lab-card-actions">
          <label className="lab-check"><input type="checkbox" checked={selected} disabled={!canUseHolder || busy} onChange={() => onSelect(market.address)} />Compare {market.symbol || "token"}</label>
          <button className="button" type="button" disabled={!canUseHolder || busy} onClick={() => onWatch(market.address)}>{watched ? "Remove from watchlist" : "Add to watchlist"}</button>
        </div>
      </div>
    </details>
  </article>;
}

export function Markets({ apiBase, session }: LabsDataProps) {
  const resource = useLabsResource(apiBase, "markets", "./labs/markets.json", isMarketsData);
  const [query, setQuery] = useState("");
  const [liquidity, setLiquidity] = useState("0");
  const [age, setAge] = useState("0");
  const [sort, setSort] = useState("volume");
  const [holderRows, setHolderRows] = useState<Market[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Market[] | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [holderError, setHolderError] = useState("");
  const [message, setMessage] = useState("");
  const canUseHolder = Boolean(apiBase && session?.eligible);
  useEffect(() => {
    let active = true;
    setHolderRows(null);
    setSelected([]);
    setComparison(null);
    setWatchlist([]);
    setHolderError("");
    setMessage("");
    if (canUseHolder) {
      void holderRequest<{ addresses: string[] }>(apiBase, "holder/watchlist", session).then((result) => {
        if (active) setWatchlist(Array.isArray(result.addresses) ? result.addresses.filter(isAddress) : []);
      }).catch((error) => { if (active) setHolderError(error instanceof Error ? error.message : "Unable to load watchlist. Try again."); });
    }
    return () => { active = false; };
  }, [apiBase, session?.token, canUseHolder]);

  const featured = resource.data?.featured;
  const warming = resource.data?.mode === "warming";
  const observed = timestamp(resource.data?.updatedAt);
  const stale = observed != null && Date.now() - observed > 15 * 60_000;
  const rows = holderRows || resource.data?.markets || [];
  const filtered = useMemo(() => rows.filter((market) => {
    if (featured && market.address.toLowerCase() === featured.address.toLowerCase()) return false;
    if (query && !`${market.symbol} ${market.name} ${market.address}`.toLowerCase().includes(query.toLowerCase().trim())) return false;
    if (Number(liquidity) > 0 && (market.liquidityUsd == null || market.liquidityUsd < Number(liquidity))) return false;
    const created = timestamp(market.createdAt);
    if (Number(age) > 0 && (created == null || Date.now() - created < Number(age) * 3_600_000)) return false;
    return true;
  }).slice(0, 60), [rows, featured, query, liquidity, age]);

  async function perform(key: string, task: () => Promise<void>) {
    setBusy(key);
    setHolderError("");
    setMessage("");
    try { await task(); }
    catch (error) { setHolderError(error instanceof Error ? error.message : "The action failed. Try again."); }
    finally { setBusy(""); }
  }

  async function applySort() {
    await perform("sort", async () => {
      const result = await holderRequest<{ markets: Market[] }>(apiBase, `holder/markets?sort=${encodeURIComponent(sort)}`, session);
      if (!Array.isArray(result.markets)) throw Error("The service returned an incomplete ranking. Refresh and try again.");
      setHolderRows(result.markets);
      setMessage("Holder ranking loaded after a server balance check.");
    });
  }

  function select(address: string) {
    setHolderError("");
    if (selected.includes(address)) setSelected((current) => current.filter((item) => item !== address));
    else if (selected.length < 4) setSelected((current) => [...current, address]);
    else setHolderError("Choose up to four tokens to compare. Remove one selection to add another.");
  }

  async function compare() {
    await perform("compare", async () => {
      const result = await holderRequest<{ markets: Market[] }>(apiBase, `holder/markets?addresses=${encodeURIComponent(selected.join(","))}`, session);
      if (!Array.isArray(result.markets)) throw Error("Comparison data is unavailable. Refresh and try again.");
      setComparison(result.markets);
      setMessage(`Loaded ${result.markets.length} comparison rows after a server balance check.`);
    });
  }

  async function toggleWatch(address: string) {
    await perform("watchlist", async () => {
      const next = watchlist.includes(address) ? watchlist.filter((item) => item !== address) : [...watchlist, address];
      const result = await holderRequest<{ addresses: string[] }>(apiBase, "holder/watchlist", session, { method: "PUT", body: JSON.stringify({ addresses: next }) });
      if (!Array.isArray(result.addresses)) throw Error("The watchlist could not be saved. Try again.");
      setWatchlist(result.addresses.filter(isAddress));
      setMessage("Watchlist saved to your wallet session on the server.");
    });
  }

  const unavailableReason = !apiBase ? "Holder tools require the deployed LABS service. This static snapshot supports public browsing." : !session ? "Sign in above with a wallet holding a positive UNLK balance to use holder tools." : !session.eligible ? "This wallet has no eligible balance. A positive UNLK balance on Ethereum unlocks holder tools." : "The server checks your session and current positive UNLK balance for every protected request.";
  const cardProps = (market: Market) => ({ market, canUseHolder, selected: selected.includes(market.address), watched: watchlist.includes(market.address), busy: !!busy, onSelect: select, onWatch: toggleWatch });

  return <section className="lab-data" aria-labelledby="labs-markets-title">
    <div className="lab-data-heading"><div><h2 id="labs-markets-title">Markets</h2><p className="muted">IMD launches with verified pools.</p></div><button className="button" type="button" aria-label="Refresh markets" disabled={resource.loading} onClick={() => { setHolderRows(null); setComparison(null); resource.refresh(); }}>{resource.loading ? "Loading…" : "Refresh"}</button></div>
    <div className="lab-filter-grid">
      <label className="lab-field lab-search">Find a launch<input type="search" name="market-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Symbol, name or 0x address" autoComplete="off" spellCheck={false} /></label>
      <label className="lab-field">Minimum liquidity<select aria-label="Minimum liquidity" value={liquidity} onChange={(event) => setLiquidity(event.target.value)}><option value="0">Any</option><option value="1000">$1,000</option><option value="10000">$10,000</option><option value="100000">$100,000</option></select></label>
      <label className="lab-field">Minimum age<select aria-label="Minimum age" value={age} onChange={(event) => setAge(event.target.value)}><option value="0">Any</option><option value="1">1 hour</option><option value="24">1 day</option><option value="168">7 days</option></select></label>
    </div>
    <div className="lab-coverage">
      {warming && <p className="small warning" role="status">Indexer warming; no live readings are available yet.</p>}
      {!apiBase && <p className="small warning">Live refresh requires the LABS service.</p>}
      {stale && <p className="small warning">Stale observation · more than 15 minutes old.</p>}
      {apiBase && resource.error && <p className="small warning" role="status">{resource.error}</p>}
      <details><summary>{warming ? "Indexer warming" : resource.fallback || resource.data?.mode === "snapshot" ? <span className="warning">Snapshot</span> : "Cached index"} · {warming ? "No observation yet" : dateLabel(resource.data?.updatedAt)}<span className="muted"> · Coverage</span></summary><div className="lab-details-content">{resource.data?.coverage.notes.map((note, index) => <p className="small muted" key={index}>{note}</p>)}{resource.data?.errors.map((error, index) => <p className="small warning" key={index}>{error}</p>)}<p className="small muted">The Any filter includes unavailable values. Liquidity and age filters apply to discovered launches; featured IMD stays separate.</p></div></details>
    </div>
    {featured && <div className="lab-featured-wrap"><p className="lab-section-label">Featured · IMD ecosystem base token</p><MarketCard featured {...cardProps(featured)} /></div>}
    <div className="lab-list-heading"><h3>{holderRows ? "Holder ranking" : "Discovered launches"}</h3><span className="small muted" role="status">{warming ? "Awaiting first index" : `${filtered.length} shown · bounded to 60`}</span></div>
    <ol className="lab-market-list">{filtered.map((market, index) => <li key={market.address}><MarketCard rank={index + 1} {...cardProps(market)} /></li>)}</ol>
    {!resource.loading && !filtered.length && <div className="lab-empty"><p>{warming ? "The service has not completed its first market refresh. Try refreshing after the first indexing scan." : query || liquidity !== "0" || age !== "0" ? "No launches match these filters." : "No launches are available in this registry response."}</p><button type="button" className="button" onClick={() => { setQuery(""); setLiquidity("0"); setAge("0"); resource.refresh(); }}>{warming ? "Refresh first observations" : "Clear filters and refresh"}</button></div>}
    <section className="lab-holder-panel" aria-labelledby="markets-holder-title">
      <h3 id="markets-holder-title">Holder tools</h3>
      <p className="small muted">{unavailableReason} Eligibility is a positive UNLK balance; no staking or token transfer is required. Paid Audit jobs are separate.</p>
      <div className="lab-holder-controls">
        <label className="lab-field">Advanced ranking<select aria-label="Advanced ranking" value={sort} disabled={!canUseHolder || !!busy} onChange={(event) => setSort(event.target.value)}><option value="volume">24h volume · highest first</option><option value="liquidity">Liquidity · highest first</option><option value="change">24h change · highest first</option></select></label>
        <button className="button" type="button" disabled={!canUseHolder || !!busy} onClick={applySort}>{busy === "sort" ? "Loading ranking…" : "Apply ranking"}</button>
        <button className="button" type="button" disabled={!canUseHolder || !!busy || selected.length < 2} onClick={compare}>{busy === "compare" ? "Loading comparison…" : `Compare selected (${selected.length}/4)`}</button>
        <button className="button" type="button" disabled={!canUseHolder || !!busy} onClick={() => perform("export", async () => { await downloadHolderCsv(apiBase, "markets", session); setMessage("Market CSV downloaded after a server balance check."); })}>{busy === "export" ? "Preparing CSV…" : "Export market CSV"}</button>
      </div>
      <p className="small muted">Open a token’s details to select it for comparison or save it to your watchlist.</p>
      <p className="small lab-action-status" role="status">{message}</p>
      {holderError && <p className="small error" role="alert">{holderError}</p>}
      {comparison && <div className="lab-comparison"><h3>Selected comparison</h3><div className="lab-table-wrap" role="region" aria-label="Token comparison, scroll horizontally for more columns" tabIndex={0}><table><caption className="sr-only">Server checked comparison of selected IMD launches</caption><thead><tr><th scope="col">Token</th><th scope="col">USD price</th><th scope="col">24h change</th><th scope="col">24h volume</th><th scope="col">Liquidity</th><th scope="col">FDV</th></tr></thead><tbody>{comparison.map((market) => <tr key={market.address}><th scope="row"><a href={`https://etherscan.io/token/${market.address}`} target="_blank" rel="noopener noreferrer">{market.symbol}<span className="small muted lab-block">{shortAddress(market.address)}</span></a></th><td>{usd(market.priceUsd)}</td><td><Change value={market.priceChange24h} /></td><td>{usd(market.volume24h)}</td><td>{usd(market.liquidityUsd)}</td><td>{usd(market.fdv)}</td></tr>)}</tbody></table></div></div>}
      {watchlist.length > 0 && <div className="lab-saved-list"><h3>Saved addresses</h3><ul>{watchlist.map((address) => <li key={address}><a className="address" href={`https://etherscan.io/address/${address}`} target="_blank" rel="noopener noreferrer">{address}</a><button className="button" type="button" disabled={!!busy} onClick={() => toggleWatch(address)}>Remove {shortAddress(address)}</button></li>)}</ul></div>}
    </section>
    <p className="small muted">Registry discovery is bounded; absent launches and prices remain unavailable. Price, volume and liquidity refer to the identified pool and their stated observation time. IMUSD is excluded until its identity and contract are independently verified.</p>
  </section>;
}

export default Markets;
