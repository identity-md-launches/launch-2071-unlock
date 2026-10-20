import { useEffect, useState } from "react";
import { readPoolHistory, cachedPoolHistory, type PoolHistory } from "./poolHistory";
import { formatPrice, formatTime } from "./chart/data";
import { fmt } from "./trading";

/** Retained ordinary pool activity. Independent of chart/API availability and archived research tools. */
export function PoolActivity() {
  const [active, setActive] = useState(location.hash === "#activity");
  const [history, setHistory] = useState<PoolHistory | null>(() => cachedPoolHistory(2000));
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const changed = () => setActive(location.hash === "#activity");
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (document.hidden) { timer = setTimeout(() => void run(), 30000); return; }
      setLoading(true);
      try {
        const next = await readPoolHistory(2000, abort.signal);
        if (!abort.signal.aborted) { setHistory(next); setError(""); }
      } catch {
        if (!abort.signal.aborted) setError("Pool activity RPC unavailable. Retry activity; any saved trades keep their original timestamp.");
      } finally {
        if (!abort.signal.aborted) { setLoading(false); if (location.hash === "#activity") timer = setTimeout(() => void run(), 30000); }
      }
    };
    void run();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [active, version]);
  return <section id="activity" className="section pool-activity" aria-labelledby="activity-title">
    <div className="section-heading"><div><h2 id="activity-title">Pool activity</h2><p>Executed swaps in the official UNLK / IMD pool.</p></div><button className="button" disabled={loading} onClick={() => { setActive(true); setVersion(v => v+1); }}>{loading ? "Reading trades…" : history ? "Refresh activity" : "Load recent trades"}</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <p className="small muted" role="status">{history ? `Partial history · blocks ${history.from}–${history.to} · checked ${formatTime(history.readAt/1000)} · ${history.trades.length} swaps. Latest 30 shown. PublicNode / dRPC; refreshes while Activity is selected.` : loading ? "Reading canonical Swap logs and block timestamps…" : "Select Activity or load recent trades to read the latest 2,000 blocks."}</p>
    {history && (history.trades.length ? <div className="activity-table-wrap" role="region" aria-label="Recent official-pool trades" tabIndex={0}><table className="activity-table"><caption>Pool legs, excluding the separate treasury component. Prices below are post-swap observations.</caption><thead><tr><th scope="col">UTC</th><th scope="col">Side</th><th scope="col">UNLK</th><th scope="col">IMD</th><th scope="col">Price (IMD)</th><th scope="col">Transaction</th></tr></thead><tbody>{history.trades.slice(-30).reverse().map(t => <tr key={`${t.hash}:${t.index}`}><td>{formatTime(t.time).slice(0,19)}</td><td className={t.buy ? "accent" : "sell-text"}>{t.buy ? "Buy" : "Sell"}</td><td>{fmt(t.unlk,4)}</td><td>{fmt(t.imd,6)}</td><td>{formatPrice(t.price)}</td><td><a href={`https://etherscan.io/tx/${t.hash}`} target="_blank" rel="noreferrer" aria-label={`View transaction ${t.hash}`}>{t.hash.slice(0,8)}…{t.hash.slice(-6)} ↗</a></td></tr>)}</tbody></table></div> : <p className="small muted">No swaps in the successfully scanned range. Empty activity is not a zero price.</p>)}
  </section>;
}
