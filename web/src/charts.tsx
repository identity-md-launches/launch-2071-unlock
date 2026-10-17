import { useEffect, useRef, useState } from "react";
import { useData } from "./data";
import { number, spotEth, date, RATES, TARGETS } from "./math";
import { source, explorer } from "./config";

export const MILESTONE_LABELS = [
  "Initial",
  "$100K",
  "$250K",
  "$500K",
  "$1M",
  "$2.5M",
  "$5M",
];
function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, entry.contentRect.width)),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
export function UnlockLadder() {
  const { snapshot: s } = useData();
  const [selected, setSelected] = useState(1);
  const { ref, width } = useChartWidth();
  const height = width < 500 ? 240 : 280;
  const left = 44,
    right = width - 28,
    top = 32,
    bottom = height - (width < 330 ? 56 : 45);
  const x = (i: number) => left + (i * (right - left)) / 6;
  const y = (p: number) => bottom - (p / 100) * (bottom - top);
  const tier = s ? (s.fullyUnlocked ? 6 : s.tier) : -1;
  const rate = (i: number) => Number(RATES[i]) / 100;
  const isConfirmed = s && selected <= tier;
  const selectPoint = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) * width) / rect.width;
    setSelected(
      Math.max(0, Math.min(6, Math.round(((px - left) / (right - left)) * 6))),
    );
  };
  return (
    <div className="ladder-wrap" ref={ref}>
      <div className="chart-title">
        <h2>Unlock ladder</h2>
        <span className="tag">Protocol rules</span>
      </div>
      <div className="chart-legend">
        <span className="earned">━ Confirmed rights</span>
        <span className="target">┄ Future checkpoints</span>
        <span className="selected">┆ Selection</span>
      </div>
      <svg
        className="ladder-chart"
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label="Unlock ladder. Categorical milestones, not a linear FDV axis. Select a checkpoint to explore its rules."
        onPointerMove={(e) => {
          if (e.pointerType === "mouse")
            selectPoint(e.clientX, e.currentTarget.getBoundingClientRect());
        }}
        onPointerDown={(e) =>
          selectPoint(e.clientX, e.currentTarget.getBoundingClientRect())
        }
      >
        <text x={left} y={14} className="axis-label">
          Sell allowance rate (%)
        </text>
        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}>
            <line
              x1={left}
              x2={right}
              y1={y(p)}
              y2={y(p)}
              className="grid-line"
            />
            <text
              x={left - 10}
              y={y(p) + 4}
              textAnchor="end"
              className="axis-label"
            >
              {p}
            </text>
          </g>
        ))}
        {RATES.map((_, i) => (
          <line
            key={i}
            x1={x(i)}
            x2={x(i)}
            y1={top}
            y2={bottom}
            className="grid-line vertical"
          />
        ))}
        {RATES.slice(0, -1).map((_, i) => (
          <g key={i}>
            <path
              d={`M${x(i)},${y(rate(i))} H${x(i + 1)}`}
              fill="none"
              stroke={tier >= i ? "var(--earned)" : "var(--target)"}
              strokeWidth="2"
              strokeDasharray={tier >= i ? undefined : "5 4"}
            />
            <path
              d={`M${x(i + 1)},${y(rate(i))} V${y(rate(i + 1))}`}
              fill="none"
              stroke={tier >= i + 1 ? "var(--earned)" : "var(--target)"}
              strokeWidth="2"
              strokeDasharray={tier >= i + 1 ? undefined : "5 4"}
            />
          </g>
        ))}
        <line
          x1={x(selected)}
          x2={x(selected)}
          y1={top - 5}
          y2={bottom}
          stroke="var(--selection)"
          strokeDasharray="3 4"
        />
        {RATES.map((_, i) => (
          <g key={i}>
            <circle
              cx={x(i)}
              cy={y(rate(i))}
              r={selected === i ? 7 : 4}
              fill={i <= tier ? "var(--earned)" : "var(--surface)"}
              stroke={
                selected === i
                  ? "var(--selection)"
                  : i <= tier
                    ? "var(--earned)"
                    : "var(--target)"
              }
              strokeWidth="2"
            />
            <text
              x={x(i)}
              y={y(rate(i)) - 14}
              textAnchor="middle"
              className={i <= tier ? "point-earned" : "point-target"}
            >
              {i === 6 ? "Full" : `${rate(i)}%`}
            </text>
            <text
              x={x(i)}
              y={bottom + (width < 330 ? (i % 2 === 0 ? 20 : 34) : 23)}
              textAnchor="middle"
              className="axis-label"
            >
              {MILESTONE_LABELS[i]}
            </text>
            <rect
              x={x(i) - Math.min(40, (right - left) / 6 - 2) / 2}
              y={top - 22}
              width={Math.min(40, (right - left) / 6 - 2)}
              height={bottom - top + 52}
              fill="transparent"
              role="button"
              tabIndex={0}
              aria-label={`${MILESTONE_LABELS[i]}: ${i === 6 ? "permanent full quota bypass" : `${rate(i)}% of eligible acquisitions`}`}
              aria-pressed={selected === i}
              onFocus={() => setSelected(i)}
              onClick={() => setSelected(i)}
              onKeyDown={(e) => {
                if (
                  [
                    "ArrowRight",
                    "ArrowLeft",
                    "Home",
                    "End",
                    "Enter",
                    " ",
                  ].includes(e.key)
                ) {
                  e.preventDefault();
                  const next =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 6
                        : e.key === "ArrowRight"
                          ? Math.min(6, i + 1)
                          : e.key === "ArrowLeft"
                            ? Math.max(0, i - 1)
                            : i;
                  setSelected(next);
                  (
                    e.currentTarget.ownerSVGElement?.querySelectorAll(
                      '[role="button"]',
                    )[next] as SVGElement
                  )?.focus();
                }
              }}
            />
          </g>
        ))}
        <text
          x={(left + right) / 2}
          y={height - 3}
          textAnchor="middle"
          className="axis-label"
        >
          Milestones · categorical USD FDV
        </text>
      </svg>
      <div className="ladder-readout" aria-live="polite" aria-atomic="true">
        <div>
          <span className="small muted">
            {isConfirmed ? "Confirmed" : "Hypothetical"}
          </span>
          <strong className={isConfirmed ? "earned" : "target"}>
            {MILESTONE_LABELS[selected]} <span className="muted">→</span>{" "}
            {selected === 6 ? "Full quota bypass" : `${rate(selected)}% rate`}
          </strong>
        </div>
        <span className="small muted">
          {selected === 0
            ? "Initial rule"
            : selected === 6
              ? "24h sequential confirmation"
              : "6h sequential confirmation"}
        </span>
      </div>
      <p className="chart-note ladder-note">
        Crossing a target alone does not confirm an unlock.{" "}
        <a href={source("src/UnlkHook.sol")} target="_blank" rel="noreferrer">
          Rule source ↗
        </a>
      </p>
    </div>
  );
}

export function PriceChart() {
  const d = useData();
  const { ref, width } = useChartWidth();
  const [range, setRange] = useState("All");
  const [selected, setSelected] = useState<number | null>(null);
  const all = (d.index?.events ?? []).filter(
    (e) => e.kind === "Swap" && e.sqrt !== undefined && e.amount0 !== undefined,
  );
  const anchor = d.snapshot?.timestamp ?? all.at(-1)?.time ?? 0n;
  const span =
    range === "1H"
      ? 3600n
      : range === "24H"
        ? 86400n
        : range === "7D"
          ? 604800n
          : null;
  const trades = all.filter((e) => span === null || e.time >= anchor - span);
  const data = trades.flatMap((e) => {
    const p = spotEth(e.sqrt!);
    return p !== null && p > 0n ? [{ e, p: Number(p) / 1e18 }] : [];
  });
  const height = width < 500 ? 240 : 280,
    left = 66,
    right = width - 20,
    top = 36,
    bottom = height - 78;
  const prices = data.map((x) => x.p),
    lo = prices.length ? Math.min(...prices) * 0.98 : 0,
    hi = prices.length ? Math.max(...prices) * 1.02 : 1;
  const t0 = data[0]?.e.time ?? 0n,
    t1 = data.at(-1)?.e.time ?? 1n;
  const x = (i: number) =>
    left +
    (t1 === t0 ? 0.5 : Number(data[i].e.time - t0) / Number(t1 - t0)) *
      (right - left);
  const y = (i: number) =>
    bottom - ((data[i].p - lo) / (hi - lo)) * (bottom - top);
  const volume = trades.reduce(
    (sum, e) => sum + (e.amount0! < 0n ? -e.amount0! : e.amount0!),
    0n,
  );
  const maxVolume = data.reduce((max, { e }) => {
    const v = e.amount0! < 0n ? -e.amount0! : e.amount0!;
    return v > max ? v : max;
  }, 0n);
  const active = data.length
    ? Math.min(selected ?? data.length - 1, data.length - 1)
    : null;
  const point = active === null ? null : data[active];
  const onPoint = (clientX: number, rect: DOMRect) => {
    if (!data.length) return;
    const px = ((clientX - rect.left) * width) / rect.width;
    let nearest = 0;
    data.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(nearest) - px)) nearest = i;
    });
    setSelected(nearest);
  };
  return (
    <div className="history-wrap" ref={ref}>
      <div className="chart-title">
        <h2>Market history</h2>
        <div className="range-controls" aria-label="History time range">
          {["1H", "24H", "7D", "All"].map((r) => (
            <button
              key={r}
              aria-pressed={range === r}
              onClick={() => {
                setRange(r);
                setSelected(null);
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-legend">
        <span className="earned">━ Event price</span>
        <span className="muted">test ETH / UNLK</span>
        <span className="sell">▥ Event volume</span>
      </div>
      <div className="history-plot" style={{ height }}>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={
            data.length
              ? `Prices and volume from ${data.length} official-pool swap events. Use the event selector below for details.`
              : "No price history available in this range"
          }
          onPointerMove={(e) =>
            onPoint(e.clientX, e.currentTarget.getBoundingClientRect())
          }
          onPointerDown={(e) =>
            onPoint(e.clientX, e.currentTarget.getBoundingClientRect())
          }
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={left}
                x2={right}
                y1={bottom - f * (bottom - top)}
                y2={bottom - f * (bottom - top)}
                className="grid-line"
              />
              {data.length > 0 && (
                <text
                  x={left - 8}
                  y={bottom - f * (bottom - top) + 4}
                  textAnchor="end"
                  className="axis-label"
                >
                  {(lo + f * (hi - lo)).toExponential(2)}
                </text>
              )}
            </g>
          ))}
          {!!data.length && (
            <>
              <path
                d={data
                  .map((_, i) => `${i ? "L" : "M"}${x(i)},${y(i)}`)
                  .join(" ")}
                stroke="var(--earned)"
                strokeWidth="2"
                fill="none"
              />
              {data.map(({ e }, i) => (
                <g key={e.id}>
                  <circle cx={x(i)} cy={y(i)} r="3" fill="var(--earned)" />
                  <rect
                    x={x(i) - 3}
                    y={
                      height -
                      38 -
                      (maxVolume > 0n
                        ? (Number(
                            ((e.amount0! < 0n ? -e.amount0! : e.amount0!) *
                              1000n) /
                              maxVolume,
                          ) /
                            1000) *
                          28
                        : 0)
                    }
                    width="6"
                    height={
                      maxVolume > 0n
                        ? (Number(
                            ((e.amount0! < 0n ? -e.amount0! : e.amount0!) *
                              1000n) /
                              maxVolume,
                          ) /
                            1000) *
                          28
                        : 0
                    }
                    fill={e.amount0! < 0n ? "var(--earned)" : "var(--sell)"}
                    opacity="0.6"
                  />
                </g>
              ))}
              <text x={left} y={height - 8} className="axis-label">
                {new Date(Number(t0) * 1000)
                  .toISOString()
                  .slice(5, 16)
                  .replace("T", " ")}
              </text>
              <text
                x={right}
                y={height - 8}
                textAnchor="end"
                className="axis-label"
              >
                {t1 === t0
                  ? "One event"
                  : new Date(Number(t1) * 1000)
                      .toISOString()
                      .slice(5, 16)
                      .replace("T", " ")}
              </text>
              {active !== null && (
                <>
                  <line
                    x1={x(active)}
                    x2={x(active)}
                    y1={top}
                    y2={height - 35}
                    stroke="var(--selection)"
                    strokeDasharray="3 4"
                  />
                  <line
                    x1={left}
                    x2={right}
                    y1={y(active)}
                    y2={y(active)}
                    stroke="var(--selection)"
                    strokeDasharray="3 4"
                    opacity="0.6"
                  />
                  <circle
                    cx={x(active)}
                    cy={y(active)}
                    r="5"
                    fill="var(--surface)"
                    stroke="var(--selection)"
                    strokeWidth="2"
                  />
                </>
              )}
            </>
          )}
          <text x={left} y={20} className="axis-label">
            Price · test ETH / UNLK
          </text>
          <text x={left} y={height - 57} className="axis-label">
            Volume · test ETH
          </text>
        </svg>
        {!data.length && (
          <div className="chart-empty">
            <strong>
              {d.historyLoading || (!d.index && !d.error && !d.historyError)
                ? "Reading official-pool events…"
                : d.historyError || d.error
                  ? "History unavailable"
                  : "No swaps in this range"}
            </strong>
            <span>Only covered on-chain events appear here.</span>
            <button
              className="text-button"
              onClick={d.refresh}
              disabled={d.loading}
            >
              Refresh history
            </button>
          </div>
        )}
      </div>
      <div className="history-readout" aria-live="polite">
        {point ? (
          <>
            <strong className="earned">
              {number(spotEth(point.e.sqrt!), 12)} ETH / UNLK
            </strong>
            <span>{date(point.e.time)}</span>
            <a
              href={explorer(point.e.hash, "tx")}
              target="_blank"
              rel="noreferrer"
            >
              {number(
                point.e.amount0! < 0n ? -point.e.amount0! : point.e.amount0!,
                8,
              )}{" "}
              ETH · transaction ↗
            </a>
          </>
        ) : (
          <span className="muted">
            No observation selected · price and volume unavailable
          </span>
        )}
      </div>
      {data.length > 0 ? (
        <label className="event-selector">
          Event {active! + 1} / {data.length}
          <input
            aria-label="Select historical swap event"
            type="range"
            min="0"
            max={Math.max(0, data.length - 1)}
            value={active!}
            onChange={(e) => setSelected(Number(e.target.value))}
          />
        </label>
      ) : (
        <div className="event-selector unavailable">
          No event available to select
        </div>
      )}
      <p className="chart-note">
        {d.index
          ? `${d.index.complete ? "Covered" : "Partial"}: blocks ${d.index.from}–${d.index.to} · 2-block delay · read ${new Date(d.index.fetchedAt).toISOString().slice(11, 19)} UTC.`
          : "Coverage unavailable."}{" "}
        {d.index
          ? `${number(volume, 8)} test ETH across ${trades.length} swaps in range.`
          : "Volume unavailable."}
        Lines connect observations; no price is asserted between events.
      </p>
    </div>
  );
}
