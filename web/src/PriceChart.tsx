import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCandles,
  cachedPoolHistory,
  historyBackoff,
  readPoolHistory,
  type Candle,
  type PoolHistory,
} from "./poolHistory";
import { fmt } from "./trading";
const time = (seconds: number) =>
  new Date(seconds * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC");
const price = (n: number) =>
  n.toLocaleString("en", { maximumSignificantDigits: 6 });
const axisPrice = (n: number) =>
  Math.abs(n) < 0.001 || Math.abs(n) >= 1e6
    ? n.toExponential(3)
    : n.toPrecision(5);
type Window = { start: number; end: number };
export function PriceChart() {
  const [count, setCount] = useState(2000);
  const [interval, setIntervalSeconds] = useState(300);
  const [mode, setMode] = useState("line");
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<PoolHistory | null>(() =>
    cachedPoolHistory(2000),
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState<Window | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(700);
  const plot = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, number>());
  const gesture = useRef<{ x: number; view: Window; distance: number } | null>(
    null,
  );
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    setData(cachedPoolHistory(count));
    setError("");
    setLoading(true);
    setView(null);
    setHover(null);
    async function refresh() {
      if (abort.signal.aborted) return;
      if (document.hidden) {
        timer = setTimeout(refresh, 15000);
        return;
      }
      try {
        const result = await readPoolHistory(count, abort.signal);
        if (abort.signal.aborted) return;
        setData(result);
        setError("");
        failures = 0;
      } catch (e) {
        if (abort.signal.aborted) return;
        failures++;
        setError(
          `${e instanceof Error ? e.message : "RPC unavailable."} Retrying in ${historyBackoff(failures) / 1000}s.`,
        );
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
          timer = setTimeout(refresh, historyBackoff(failures));
        }
      }
    }
    void refresh();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      abort.abort();
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [count, version]);
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [Boolean(data)]);
  const candles = useMemo(
    () => buildCandles(data?.trades ?? [], interval),
    [data, interval],
  );
  const coverage: Window = {
    start: data ? Math.floor(data.fromTime / interval) * interval : 0,
    end: data ? data.toTime : interval,
  };
  const clamp = (v: Window): Window => {
    const duration = Math.min(
      coverage.end - coverage.start,
      Math.max(interval * 3, v.end - v.start),
    );
    const end = Math.min(
      coverage.end,
      Math.max(coverage.start + duration, v.end),
    );
    return { start: end - duration, end };
  };
  const visibleWindow = view ? clamp(view) : coverage;
  const visible = candles.filter(
    (c) => c.time >= visibleWindow.start && c.time <= visibleWindow.end,
  );
  const low = visible.length
    ? Math.min(...visible.map((c) => c.low))
    : (data?.spot ?? 1);
  const high = visible.length ? Math.max(...visible.map((c) => c.high)) : low;
  const padding = (high - low) * 0.12 || high * 0.025;
  const left = 12,
    right = Math.max(100, width - 85),
    top = 22,
    bottom = 215;
  const x = (t: number) =>
    left +
    ((t - visibleWindow.start) /
      (visibleWindow.end - visibleWindow.start || 1)) *
      (right - left);
  const y = (p: number) =>
    bottom -
    ((p - low + padding) / (high - low + padding * 2)) * (bottom - top);
  const maxVolume = Math.max(1, ...visible.map((c) => Number(c.imd)));
  const selected = hover === null ? null : candles[hover];
  const last = data?.trades.at(-1);
  const stale = Boolean(
    data && (now - data.readAt > 45000 || now / 1000 - data.toTime > 90),
  );
  function zoom(factor: number) {
    const span = (visibleWindow.end - visibleWindow.start) * factor;
    setView(clamp({ start: visibleWindow.end - span, end: visibleWindow.end }));
  }
  function inspect(clientX: number) {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect || !candles.length) return;
    const target =
      visibleWindow.start +
      ((clientX - rect.left - left) / (right - left)) *
        (visibleWindow.end - visibleWindow.start);
    let best = 0;
    for (let i = 1; i < candles.length; i++)
      if (
        Math.abs(candles[i].time - target) <
        Math.abs(candles[best].time - target)
      )
        best = i;
    setHover(best);
  }
  function pan(direction: number) {
    const delta = (direction * (visibleWindow.end - visibleWindow.start)) / 2;
    setView(
      clamp({
        start: visibleWindow.start + delta,
        end: visibleWindow.end + delta,
      }),
    );
  }
  return (
    <div className="history-wrap price-chart">
      <div className="chart-title">
        <h2>UNLK price</h2>
        <span className="small muted">IMD per UNLK · UTC</span>
      </div>
      <div className="price-controls">
        <div className="chart-toggle" role="group" aria-label="Chart style">
          <button
            aria-pressed={mode === "line"}
            onClick={() => setMode("line")}
          >
            Line
          </button>
          <button
            aria-pressed={mode === "candles"}
            onClick={() => setMode("candles")}
          >
            Candles
          </button>
        </div>
        <label>
          Interval
          <select
            aria-label="Candle interval"
            value={interval}
            onChange={(e) => {
              setIntervalSeconds(Number(e.target.value));
              setHover(null);
            }}
          >
            <option value={60}>1 min</option>
            <option value={300}>5 min</option>
            <option value={900}>15 min</option>
            <option value={3600}>1 hour</option>
          </select>
        </label>
        <label>
          History
          <select
            aria-label="History coverage"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            <option value={2000}>2,000 blocks</option>
            <option value={10000}>10,000 blocks</option>
          </select>
        </label>
      </div>
      <div className="price-readout">
        <strong>
          {data ? `${price(data.spot)} IMD` : "Pool price unavailable"}
        </strong>
        <span>
          {last
            ? `Last recorded trade: ${price(last.price)} IMD · ${time(last.time)}`
            : data
              ? "No trades in the scanned range"
              : "Reading official-pool events…"}
        </span>
      </div>
      <p
        className={`chart-freshness small ${stale || error ? "warning" : "muted"}`}
        role="status"
      >
        {data
          ? `${stale || error ? "Stale / unconfirmed update" : "Fresh snapshot"} · block ${data.to} · read ${Math.max(0, Math.floor((now - data.readAt) / 1000))}s ago · ${time(data.toTime)}`
          : loading
            ? "Loading history and block timestamps…"
            : "No confirmed history"}
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}{" "}
          {data &&
            "Previous data retained with its original block and timestamp."}{" "}
          <button
            className="text-button"
            onClick={() => setVersion((v) => v + 1)}
          >
            Retry chart
          </button>
        </p>
      )}
      {data ? (
        <>
          <svg
            ref={plot}
            className="price-plot"
            viewBox={`0 0 ${width} 300`}
            role="img"
            aria-label={`Official UNLK/IMD ${mode === "line" ? "closing-price line" : "OHLC candlestick"} chart, Unix time axis. ${visible.length} traded intervals visible. Empty intervals have no candle. Use the inspect slider for values.`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pointers.current.set(e.pointerId, e.clientX);
              const values = [...pointers.current.values()];
              gesture.current = {
                x: e.clientX,
                view: visibleWindow,
                distance:
                  values.length === 2 ? Math.abs(values[0] - values[1]) : 0,
              };
              inspect(e.clientX);
            }}
            onPointerMove={(e) => {
              inspect(e.clientX);
              if (!pointers.current.has(e.pointerId) || !gesture.current)
                return;
              pointers.current.set(e.pointerId, e.clientX);
              const values = [...pointers.current.values()],
                g = gesture.current;
              if (values.length === 2 && g.distance > 0) {
                const span =
                  ((g.view.end - g.view.start) * g.distance) /
                  Math.max(10, Math.abs(values[0] - values[1]));
                setView(clamp({ start: g.view.end - span, end: g.view.end }));
              } else if (values.length === 1 && Math.abs(e.clientX - g.x) > 8) {
                const delta =
                  (-(e.clientX - g.x) / (right - left)) *
                  (g.view.end - g.view.start);
                setView(
                  clamp({
                    start: g.view.start + delta,
                    end: g.view.end + delta,
                  }),
                );
              }
            }}
            onPointerUp={(e) => {
              pointers.current.delete(e.pointerId);
              gesture.current = null;
            }}
            onPointerCancel={(e) => {
              pointers.current.delete(e.pointerId);
              gesture.current = null;
            }}
          >
            <title>
              Official UNLK/IMD pool price, with executed IMD volume below
            </title>
            {[0, 0.5, 1].map((f) => {
              const p = high + padding - f * (high - low + padding * 2);
              return (
                <g key={f}>
                  <line
                    x1={left}
                    x2={right}
                    y1={y(p)}
                    y2={y(p)}
                    className="grid-line"
                  />
                  <text x={right + 8} y={y(p) + 4} className="price-axis">
                    {axisPrice(p)}
                  </text>
                </g>
              );
            })}
            <text x={left} y="16" className="price-axis">
              Pool spot · IMD / UNLK
            </text>
            <text x={left} y="242" className="price-axis">
              Executed IMD volume
            </text>
            {visible.map((c, i) => {
              const previous = visible[i - 1],
                cx = x(c.time),
                rising = c.close >= c.open;
              const color = rising ? "var(--accent)" : "var(--sell)";
              const bar = Math.max(
                2,
                Math.min(
                  14,
                  (interval / (visibleWindow.end - visibleWindow.start)) *
                    (right - left) *
                    0.65,
                ),
              );
              return (
                <g key={c.time}>
                  {mode === "line" ? (
                    <>
                      {previous && c.time - previous.time === interval && (
                        <line
                          x1={x(previous.time)}
                          y1={y(previous.close)}
                          x2={cx}
                          y2={y(c.close)}
                          stroke="var(--accent)"
                          strokeWidth="2"
                        />
                      )}
                      <circle
                        cx={cx}
                        cy={y(c.close)}
                        r="2.5"
                        fill="var(--accent)"
                      />
                    </>
                  ) : (
                    <>
                      <line
                        x1={cx}
                        x2={cx}
                        y1={y(c.high)}
                        y2={y(c.low)}
                        stroke={color}
                        strokeWidth="1.5"
                      />
                      <rect
                        x={cx - bar / 2}
                        y={
                          Math.min(y(c.open), y(c.close)) -
                          (c.open === c.close ? 1 : 0)
                        }
                        width={bar}
                        height={Math.max(2, Math.abs(y(c.open) - y(c.close)))}
                        fill={rising ? "var(--surface)" : color}
                        stroke={color}
                      />
                    </>
                  )}
                  <rect
                    x={cx - bar / 2}
                    y={275 - (Number(c.imd) / maxVolume) * 27}
                    width={bar}
                    height={Math.max(1, (Number(c.imd) / maxVolume) * 27)}
                    fill={color}
                    opacity="0.7"
                  />
                </g>
              );
            })}
            {!visible.length && (
              <text
                x={(left + right) / 2}
                y="120"
                textAnchor="middle"
                className="price-axis"
              >
                No trades in this window
              </text>
            )}
            {(width < 500 ? [0, 1] : [0, 0.5, 1]).map((f) => (
              <text
                key={f}
                x={left + f * (right - left)}
                y="295"
                textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
                className="price-axis"
              >
                {new Date(
                  (visibleWindow.start +
                    f * (visibleWindow.end - visibleWindow.start)) *
                    1000,
                )
                  .toISOString()
                  .slice(
                    visibleWindow.end - visibleWindow.start > 86400 ? 5 : 11,
                    16,
                  )
                  .replace("T", " ")}
              </text>
            ))}
            {selected &&
              selected.time >= visibleWindow.start &&
              selected.time <= visibleWindow.end && (
                <g className="crosshair">
                  <line
                    x1={x(selected.time)}
                    x2={x(selected.time)}
                    y1="20"
                    y2="277"
                  />
                  <line
                    x1={left}
                    x2={right}
                    y1={y(selected.close)}
                    y2={y(selected.close)}
                  />
                  <circle cx={x(selected.time)} cy={y(selected.close)} r="4" />
                </g>
              )}
          </svg>
          <div
            className="chart-navigation"
            role="group"
            aria-label="Chart zoom and pan"
          >
            <button
              className="button secondary"
              aria-label="Pan earlier"
              onClick={() => pan(-1)}
              disabled={visibleWindow.start <= coverage.start}
            >
              ←
            </button>
            <button
              className="button secondary"
              aria-label="Zoom in"
              onClick={() => zoom(0.5)}
            >
              +
            </button>
            <button
              className="button secondary"
              aria-label="Zoom out"
              onClick={() => zoom(2)}
            >
              −
            </button>
            <button className="button secondary" onClick={() => setView(null)}>
              Reset
            </button>
            <button
              className="button secondary"
              aria-label="Pan later"
              onClick={() => pan(1)}
              disabled={visibleWindow.end >= coverage.end}
            >
              →
            </button>
          </div>
          <p className="small muted">
            Drag to pan · pinch or +/− to zoom · tap/hover to inspect. Blank
            intervals mean no trades; line segments do not bridge gaps.
          </p>
          {candles.length > 0 && (
            <label className="inspect-control">
              Inspect candle
              <input
                aria-label="Inspect candle"
                type="range"
                min="0"
                max={candles.length - 1}
                value={hover ?? candles.length - 1}
                onChange={(e) => setHover(Number(e.target.value))}
              />
            </label>
          )}
          <div className="chart-tooltip" aria-live="polite">
            {selected ? (
              <>
                <strong>
                  {time(selected.time)} · {interval / 60}m bucket
                  {data &&
                  (selected.time < data.fromTime ||
                    selected.time + interval > data.toTime)
                    ? " · partial bucket"
                    : ""}
                </strong>
                <span>
                  O {price(selected.open)} · H {price(selected.high)} · L{" "}
                  {price(selected.low)} · C {price(selected.close)} IMD
                </span>
                <span>
                  {selected.trades} swaps · {fmt(selected.unlk, 4)} UNLK ·{" "}
                  {fmt(selected.imd, 6)} IMD executed
                </span>
              </>
            ) : (
              <span>
                Inspect a traded interval to read OHLC and volume. OHLC uses
                recorded post-swap sqrtPriceX96 observations; it does not
                include unobserved intratrade extremes or execution averages.
              </span>
            )}
          </div>
          <details className="chart-data">
            <summary>Recent trades & accessible data</summary>
            <div
              className="history-table"
              tabIndex={0}
              role="region"
              aria-label="Recent pool swaps"
            >
              <table>
                <thead>
                  <tr>
                    <th>Time (UTC)</th>
                    <th>Side</th>
                    <th>Pool spot (IMD)</th>
                    <th>UNLK</th>
                    <th>IMD pool leg</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.trades]
                    .reverse()
                    .slice(0, 30)
                    .map((t) => (
                      <tr key={`${t.hash}-${t.index}`}>
                        <td>
                          <a
                            href={`https://etherscan.io/tx/${t.hash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {time(t.time).replace(" UTC", "")} ↗
                          </a>
                        </td>
                        <td>{t.buy ? "Buy" : "Sell"}</td>
                        <td>{price(t.price)}</td>
                        <td>{fmt(t.unlk, 4)}</td>
                        <td>{fmt(t.imd, 6)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!data.trades.length && (
                <p>No swaps in the verified range. This is not a zero price.</p>
              )}
            </div>
          </details>
        </>
      ) : (
        <div className="history-empty" role="status">
          {loading
            ? "Scanning filtered mainnet Swap logs…"
            : "Chart unavailable. Retry when the RPC recovers."}
        </div>
      )}
      <p className="chart-note">
        {data
          ? `Partial history: blocks ${data.from}–${data.to} · ${time(data.fromTime)} to ${time(data.toTime)} · ${data.trades.length} swaps. `
          : "Coverage is confirmed only after a complete scan. "}
        Boundary candles may be partial. Official UNLK/IMD pool only. Volume is
        the actual Swap-event pool leg, excluding the separate treasury
        component. Refreshes about every 15s; failures back off to 120s. No
        historical USD conversion is available. Current USD/FDV is separate.
        Only stored hook state grants tiers.
      </p>
    </div>
  );
}
