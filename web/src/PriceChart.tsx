import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type Time, type IRange,
} from "./chart/vendor/lightweight-charts.mjs";
import {
  INTERVALS, ChartProviderError, cachedHistory, formatPrice, formatTime, readChartPage,
  type ChartCandle, type ChartHistory, type Currency,
} from "./chart/data";
import { POOL_ID } from "./mainnet";
import { cachedIndex, readIndexedHistory } from "./chart/indexer";
import "./chart/chart.css";

const green = "#34d399", red = "#f87171";
const volume = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 4, maximumSignificantDigits: 7 });
type ChartHandles = { chart: IChartApi; candles: ISeriesApi<"Candlestick">; line: ISeriesApi<"Line">; dots: ISeriesApi<"Line">; volume: ISeriesApi<"Histogram"> };

export function PriceChart() {
  const [interval, setInterval] = useState(3);
  const [currency, setCurrency] = useState<Currency>("IMD");
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [source, setSource] = useState<"gecko" | "rpc">("gecko");
  const [fallbackReason, setFallbackReason] = useState("");
  const [data, setData] = useState<ChartHistory | null>(() => cachedHistory(3600, "IMD"));
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [request, setRequest] = useState({ version: 0, older: false });
  const [inspected, setInspected] = useState<ChartCandle | null>(null);
  const [fullscreen, setFullscreen] = useState(false), [expanded, setExpanded] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const host = useRef<HTMLDivElement>(null), section = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const handles = useRef<ChartHandles | null>(null);
  const rows = useRef(new Map<number, ChartCandle>());
  const currentData = useRef(data);
  const pendingRange = useRef<IRange<Time> | null>(null);
  const populated = useRef(false);
  const navigated = useRef(false);
  const selectedInterval = INTERVALS[interval];
  const correctData = data?.interval === selectedInterval.seconds && data?.currency === currency && (source === "rpc" ? data.source === "rpc" : data.source !== "rpc") ? data : null;
  currentData.current = correctData;
  const candles = correctData?.candles ?? [];
  const last = candles.at(-1);
  const stale = !confirmed || !correctData || clock - correctData.readAt > 120000 ||
    Boolean(correctData.blockCoverage && clock/1000 - correctData.blockCoverage.toTime > 120);

  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#111114" }, textColor: "#a1a1aa", fontFamily: '"JetBrains Mono", monospace', fontSize: 12, attributionLogo: true,
        panes: { separatorColor: "#27272a", separatorHoverColor: "#71717a", enableResize: true } },
      grid: { vertLines: { color: "#202025" }, horzLines: { color: "#202025" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#a1a1aa", labelBackgroundColor: "#27272a" }, horzLine: { color: "#a1a1aa", labelBackgroundColor: "#27272a" } },
      rightPriceScale: { borderColor: "#27272a", minimumWidth: 90 },
      timeScale: { borderColor: "#27272a", timeVisible: true, secondsVisible: false, rightOffset: 3, barSpacing: 8, minBarSpacing: 0.01, shiftVisibleRangeOnNewBar: false },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      localization: { locale: "en-US", timeFormatter: (t: Time) => typeof t === "number" ? formatTime(t) : String(t) },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: green, downColor: red, borderUpColor: green, borderDownColor: red, wickUpColor: green, wickDownColor: red,
      priceFormat: { type: "custom", minMove: 0.0000000001, formatter: formatPrice },
    });
    const line = chart.addSeries(LineSeries, {
      color: green, lineWidth: 2, visible: false,
      priceFormat: { type: "custom", minMove: 0.0000000001, formatter: formatPrice },
    });
    const dots = chart.addSeries(LineSeries, {
      color: green, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2, visible: false,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      priceFormat: { type: "custom", minMove: 0.0000000001, formatter: formatPrice },
    });
    const bars = chart.addSeries(HistogramSeries, { color: green, priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }, 1);
    chart.panes()[0].setStretchFactor(4);
    chart.panes()[1].setStretchFactor(1);
    handles.current = { chart, candles: series, line, dots, volume: bars };
    chart.subscribeCrosshairMove(e => setInspected(typeof e.time === "number" ? rows.current.get(e.time) ?? null : null));
    chart.timeScale().subscribeVisibleTimeRangeChange(range => {
      if (!host.current) return;
      host.current.dataset.visibleFrom = range ? String(range.from) : "";
      host.current.dataset.visibleTo = range ? String(range.to) : "";
    });
    return () => { handles.current = null; populated.current = false; chart.remove(); };
  }, []);

  useEffect(() => {
    const h = handles.current;
    if (!h) return;
    const previous = pendingRange.current ?? h.chart.timeScale().getVisibleRange();
    rows.current = new Map(candles.map(c => [c.time, c]));
    // Whitespace reserves calendar time without making candles or inventing price/volume.
    // Limit materialized empty slots to 50k; larger inactive gaps keep their boundary slots.
    const candleData: ({time: UTCTimestamp} | (ChartCandle & {time: UTCTimestamp}))[] = [];
    const lineData: {time: UTCTimestamp; value?: number; color?: string}[] = [];
    const volumeData: {time: UTCTimestamp; value?: number; color?: string}[] = [];
    let slots = 0;
    candles.forEach((c, i) => {
      const previous = candles[i-1];
      if (previous && c.time - previous.time > selectedInterval.seconds) {
        const missing = (c.time - previous.time) / selectedInterval.seconds - 1;
        const step = slots + missing < 50000 ? selectedInterval.seconds : c.time - previous.time - selectedInterval.seconds;
        for (let t = previous.time + selectedInterval.seconds; t < c.time; t += Math.max(step, selectedInterval.seconds)) {
          const blank = { time: t as UTCTimestamp }; candleData.push(blank); lineData.push(blank); volumeData.push(blank); slots++;
        }
      }
      candleData.push({ ...c, time: c.time as UTCTimestamp });
      // Lightweight Charts colors the outgoing segment by this point. Never bridge no-trade gaps.
      const next = candles[i+1];
      lineData.push({ time: c.time as UTCTimestamp, value: c.close, color: next && next.time-c.time > selectedInterval.seconds ? "transparent" : green });
      volumeData.push({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? green : red });
    });
    h.candles.setData(candleData);
    h.line.setData(lineData);
    h.dots.setData(lineData.map(({ color: _color, ...point }) => point));
    h.volume.setData(volumeData);
    if (candles.length) {
      if (previous && populated.current && (navigated.current || pendingRange.current)) {
        // Preserve the visible *time* range when interval/unit changes after panning.
        const from = Math.max(Number(previous.from), candles[0].time);
        const to = Math.min(Number(previous.to), candles.at(-1)!.time);
        if (from < to) h.chart.timeScale().setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp });
        else h.chart.timeScale().fitContent();
      } else h.chart.timeScale().fitContent();
      populated.current = true;
      if (!correctData?.indexing) pendingRange.current = null;
    }
  }, [correctData, selectedInterval.seconds]);

  useEffect(() => {
    handles.current?.candles.applyOptions({ visible: mode === "candles" });
    handles.current?.line.applyOptions({ visible: mode === "line" });
    handles.current?.dots.applyOptions({ visible: mode === "line" });
  }, [mode]);
  useEffect(() => {
    // A manual price-axis scale in IMD cannot be carried into a differently priced USD series.
    handles.current?.chart.priceScale("right").applyOptions({ autoScale: true });
  }, [currency, source]);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const cached = source === "rpc" ? cachedIndex(selectedInterval.seconds) : cachedHistory(selectedInterval.seconds, currency);
    setData(old => old?.interval === selectedInterval.seconds && old.currency === currency && (source === "rpc" ? old.source === "rpc" : old.source !== "rpc") ? old : cached);
    setConfirmed(false); setError(""); setInspected(null);
    async function refresh(older = false) {
      if (document.hidden) { timer = setTimeout(() => void refresh(older), 30000); return; }
      setLoading(true);
      let delay = 30000;
      try {
        const result = source === "rpc"
          ? await readIndexedHistory(selectedInterval.seconds, abort.signal, page => { if (!abort.signal.aborted) { setData({ ...page, indexing: true }); setConfirmed(true); } })
          : await readChartPage(selectedInterval, currency, abort.signal, currentData.current, older);
        if (abort.signal.aborted) return;
        setData(result); setConfirmed(true); setError(""); failures = 0;
      } catch (e) {
        if (abort.signal.aborted) return;
        failures++;
        delay = e instanceof ChartProviderError ? e.retryAfter * 1000 : Math.min(300000, 30000 * 2 ** (failures - 1));
        const message = e instanceof Error ? e.message : "Chart provider unreachable. Check your connection and retry the chart.";
        setError(source === "rpc" ? `Mainnet history failed. Retry the chart; both public RPC providers were tried. ${message.slice(0,220)}` : message);
        setConfirmed(false);
        if (source === "gecko" && currency === "IMD" && !currentData.current?.candles.length) {
          setFallbackReason(`${message} Switched to official-pool mainnet history in IMD.`);
          setSource("rpc");
        }
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => void refresh(), delay);
        }
      }
    }
    void refresh(request.older);
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    return () => { abort.abort(); clearTimeout(timer); clearInterval(tick); };
  }, [interval, currency, request, source]);

  useEffect(() => {
    const onFull = () => setFullscreen(document.fullscreenElement === section.current);
    document.addEventListener("fullscreenchange", onFull);
    return () => document.removeEventListener("fullscreenchange", onFull);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background: [HTMLElement, boolean][] = [];
    for (let node: HTMLElement | null = section.current; node?.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) if (sibling !== node && sibling instanceof HTMLElement) {
        background.push([sibling, sibling.inert]); sibling.inert = true;
      }
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setExpanded(false); expandButton.current?.focus(); }
      if (e.key === "Tab") {
        const controls = [...section.current!.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter(el => typeof el.checkVisibility === "function" ? el.checkVisibility() : Boolean(el.getClientRects().length));
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    addEventListener("keydown", escape);
    expandButton.current?.focus();
    return () => { document.body.style.overflow = previous; background.forEach(([node, inert]) => { node.inert = inert; }); removeEventListener("keydown", escape); expandButton.current?.focus(); };
  }, [expanded]);
  function rememberRange() {
    const range = handles.current?.chart.timeScale().getVisibleRange() ?? null;
    // A source selected before history arrives has no intentional viewport to preserve.
    navigated.current = Boolean(range && range.from !== range.to);
    pendingRange.current = navigated.current ? range : null;
  }
  function fit() { navigated.current = false; pendingRange.current = null; handles.current?.chart.timeScale().fitContent(); handles.current?.chart.priceScale("right").applyOptions({ autoScale: true }); }
  function zoom(factor: number) {
    navigated.current = true;
    const scale = handles.current?.chart.timeScale(), r = scale?.getVisibleLogicalRange();
    if (scale && r) { const middle = (r.from + r.to) / 2, span = Math.max(3, (r.to - r.from) * factor); scale.setVisibleLogicalRange({ from: middle - span / 2, to: middle + span / 2 }); }
  }
  function pan(direction: number) {
    navigated.current = true;
    const scale = handles.current?.chart.timeScale(), r = scale?.getVisibleLogicalRange();
    if (scale && r) { const delta = (r.to - r.from) * direction / 3; scale.setVisibleLogicalRange({ from: r.from + delta, to: r.to + delta }); }
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement === section.current) await document.exitFullscreen();
    else if (expanded) setExpanded(false);
    else if (section.current?.requestFullscreen) { try { await section.current.requestFullscreen(); } catch { setExpanded(true); } }
    else setExpanded(true);
  }
  const shown = inspected ?? last;
  const inspectedIndex = inspected ? candles.findIndex(c => c.time === inspected.time) : Math.max(0, candles.length - 1);
  const change = last && candles[0] ? (last.close / candles[0].open - 1) * 100 : null;
  const historyLabel = candles.length ? `${formatTime(candles[0].time).slice(0,16)} → ${formatTime(last!.time).slice(0,16)} UTC · ${candles.length.toLocaleString()} active bars` : correctData ? "No traded intervals in the returned source history." : "Coverage not verified yet.";
  const sourceHref = `https://www.geckoterminal.com/eth/pools/${POOL_ID}`;

  return (
    <div ref={section} className={`official-chart ${expanded ? "chart-expanded" : ""}`} role={expanded ? "dialog" : undefined} aria-modal={expanded ? true : undefined} aria-label={expanded ? "UNLK trading chart" : undefined} data-chart-source={source === "rpc" ? "ethereum-logs" : "geckoterminal"} data-pool-id={POOL_ID} data-candle-count={candles.length} data-currency={currency}>
      <div className="trading-chart-heading">
        <div><h2>UNLK <span className="muted">/ IMD</span></h2><span className="small muted">Official v4 pool · Ethereum</span></div>
        <div className="chart-last"><strong>{last ? `${currency === "USD" ? "$" : ""}${formatPrice(last.close)}` : "—"}<small> {currency}</small></strong><span className={`small ${change !== null && change < 0 ? "chart-down" : "accent"}`}>{change === null ? "Awaiting trades" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}% in loaded history`}</span></div>
      </div>
      <div className="trading-chart-toolbar">
        <label className="chart-interval">Interval<select aria-label="Chart interval" value={interval} onChange={e => { rememberRange(); setInterval(Number(e.target.value)); setRequest(r => ({ ...r, older: false })); }}>{INTERVALS.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}</select></label>
        <div className="chart-control-group" role="group" aria-label="Chart style"><button aria-pressed={mode === "candles"} onClick={() => setMode("candles")}>Candles</button><button aria-pressed={mode === "line"} onClick={() => setMode("line")}>Line</button></div>
        <div className="chart-control-group" role="group" aria-label="Price currency">{(["IMD", "USD"] as const).map(c => <button key={c} aria-pressed={currency === c} onClick={() => { if (currency !== c) { rememberRange(); setCurrency(c); if (c === "USD") { setSource("gecko"); setFallbackReason(""); } setRequest(r => ({ ...r, older: false })); } }}>{c}</button>)}</div>
        <button className="chart-tool" onClick={fit} title="Fit all loaded history and reset the price scale">Reset / fit</button>
        <button ref={expandButton} className="chart-tool" aria-label={fullscreen || expanded ? "Exit fullscreen chart" : "Fullscreen chart"} onClick={() => void toggleFullscreen()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={fullscreen || expanded ? "M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6" : "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"} /></svg></button>
      </div>
      <div className="candle-readout" aria-label="Candle values">
        <span>{shown ? formatTime(shown.time) : "Move the crosshair to inspect"}</span>
        <span>{shown ? `O ${formatPrice(shown.open)}  H ${formatPrice(shown.high)}  L ${formatPrice(shown.low)}  C ${formatPrice(shown.close)}` : "O —  H —  L —  C —"}</span>
        <span>{shown ? `Vol ${volume(shown.volume)} ${currency}` : "Vol —"}</span>
      </div>
      <div className="chart-canvas-wrap">
        <div ref={host} className="chart-canvas" onPointerDown={() => { navigated.current = true; }} onWheel={() => { navigated.current = true; }} role="img" aria-label={`${selectedInterval.label} ${mode === "candles" ? "candlestick" : "closing price line"} chart of official UNLK / IMD pool, priced in ${currency}, with aligned executed volume. Use the candle inspector and data table for values.`} />
        {!candles.length && <div className="chart-empty"><strong>{loading ? "Loading official pool history…" : error ? "Chart source unavailable" : "No trades in this history"}</strong><span>{loading ? "The swap stays available while the chart loads." : error ? "Retry below. Mainnet state and the swap are independent." : "No candles or volume are generated for inactive intervals."}</span></div>}
      </div>
      <div className="chart-navigation" role="group" aria-label="Chart navigation"><button onClick={() => pan(-1)} aria-label="Pan chart earlier">←</button><button onClick={() => zoom(0.65)} aria-label="Zoom chart in">+</button><button onClick={() => zoom(1.5)} aria-label="Zoom chart out">−</button><button onClick={() => pan(1)} aria-label="Pan chart later">→</button><span className="small muted">Drag to pan · wheel / pinch to zoom</span></div>
      <div className="chart-feed-status"><span className={stale ? "warning" : "muted"} role="status">{source === "rpc" ? "Ethereum logs" : "GeckoTerminal"} · {correctData ? `${stale ? "Cached / unconfirmed" : "Source checked"} · ${formatTime(correctData.readAt / 1000)}${loading ? " · updating…" : ""}` : loading ? "Fetching exact-pool candles…" : "No confirmed chart data"}</span><button className="text-button" disabled={loading} onClick={() => setRequest(r => ({ version: r.version + 1, older: false }))}>{loading ? "Loading…" : "Refresh chart"}</button></div>
      {fallbackReason && <p className="chart-source-notice small muted">{fallbackReason}</p>}
      <label className="chart-source-choice">Source<select aria-label="Chart data source" value={source} onChange={e => { rememberRange(); const next = e.target.value as "gecko" | "rpc"; setSource(next); if (next === "rpc") setCurrency("IMD"); setFallbackReason(""); }}><option value="gecko">GeckoTerminal</option><option value="rpc">Ethereum logs · IMD</option></select></label>
      {error && <div className="chart-provider-error" role="alert"><p>{error} {correctData && "Saved data keeps its original timestamp. Automatic retries back off to five minutes."}</p><button className="button" disabled={loading} onClick={() => setRequest(r => ({ version: r.version + 1, older: false }))}>Retry chart</button>{source === "gecko" && <button className="button" onClick={() => { rememberRange(); setSource("rpc"); setCurrency("IMD"); }}>Use mainnet / IMD</button>}</div>}
      <div className="chart-history-coverage"><span>Available history: {historyLabel}</span>{correctData?.olderAvailable && <button className="text-button" disabled={loading} onClick={() => setRequest(r => ({ version: r.version + 1, older: true }))}>Load older history</button>}</div>
      <details className="chart-details"><summary>Source, coverage & candle data</summary>
        {source === "rpc" ? <><p><a href="https://ethereum-rpc.publicnode.com" target="_blank" rel="noreferrer">Ethereum PublicNode ↗</a> with <a href="https://eth.drpc.org" target="_blank" rel="noreferrer">dRPC fallback ↗</a>. Official-pool Swap events only. Bounded pages of 2,000 blocks, up to 12 pages per read. Completed pages persist on this device and resume after reload. Recent 12 blocks are reconciled; a deeper reorganization restarts the scan. {correctData?.blockCoverage && `Scanned blocks ${correctData.blockCoverage.from}–${correctData.blockCoverage.to} (${formatTime(correctData.blockCoverage.fromTime)} → ${formatTime(correctData.blockCoverage.toTime)}).`} {!correctData?.blockCoverage ? "No completed mainnet history page has been verified." : correctData.truncated ? "Partial history: the device cache bound was reached." : correctData.olderAvailable ? "Partial history; load older pages to extend coverage." : "Coverage reaches the deployment block, subject to provider access."} {correctData?.truncated && "Device cache is bounded to 6,000 trades; older history is partial."}</p><p>RPC OHLC uses actual post-swap sqrtPriceX96 pool observations, in canonical log order; it differs from execution-average prices on GeckoTerminal. Volume is the actual IMD Swap leg, excluding the separate treasury fee. Both currencies have 18 decimals. Historical USD is unavailable from these logs alone; select USD to use the provider’s historical series. No current-rate conversion is applied.</p></> : <><p><a href={sourceHref} target="_blank" rel="noreferrer">GeckoTerminal · official pool ↗</a>. Free public OHLCV, refreshed every 30s while visible. Partial provider history (up to six months); {correctData?.truncated ? "the most recent 3,000 active bars are retained. " : "coverage is limited to returned bars. "}Boundary candles may be incomplete. Candle openings follow the provider’s previous-close convention.</p><p>{currency === "USD" ? "USD candles and executed USD volume come from the provider’s time-aligned historical series, not today’s IMD rate. Provider conversions can be revised." : "IMD prices use the executed UNLK / IMD pair; volume is the executed IMD leg, excluding the separate treasury fee. Both currencies have 18 decimals. The provider labels IMD as VIBE; addresses are verified, not symbols."}</p></>}
        <p>No empty candles are created. Line mode joins closes in consecutive active intervals and leaves gaps blank. Boundary candles may be partial. Chart prices are informational; only actual contract state grants unlocked selling rights.</p>
        <p className="address small">Ethereum · chainId 1<br />PoolId: {POOL_ID}</p>
        {candles.length > 0 && <><label className="candle-inspector">Inspect candle<input type="range" aria-label="Inspect candle" min="0" max={candles.length - 1} value={inspectedIndex} onChange={e => { const c = candles[Number(e.target.value)]; setInspected(c); handles.current?.chart.setCrosshairPosition(c.close, c.time as UTCTimestamp, mode === "candles" ? handles.current.candles : handles.current.line); }} /></label><div className="candle-table-wrap"><table className="candle-table"><caption>Latest {Math.min(30,candles.length)} active {selectedInterval.label} candles · {currency}</caption><thead><tr><th scope="col">UTC</th><th scope="col">Open</th><th scope="col">High</th><th scope="col">Low</th><th scope="col">Close</th><th scope="col">Volume ({currency})</th></tr></thead><tbody>{candles.slice(-30).reverse().map(c => <tr key={c.time}><th scope="row">{formatTime(c.time).slice(0,16)}</th><td>{formatPrice(c.open)}</td><td>{formatPrice(c.high)}</td><td>{formatPrice(c.low)}</td><td>{formatPrice(c.close)}</td><td>{volume(c.volume)}</td></tr>)}</tbody></table></div></>}
      </details>
      <div className="chart-attribution"><span>TradingView Lightweight Charts™</span><span>Copyright (с) 2025 TradingView, Inc. <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView ↗</a> · <a href="./chart-NOTICE.txt">Notice</a></span></div>
    </div>
  );
}
