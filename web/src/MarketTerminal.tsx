import { useEffect, useRef, useState } from "react";
import { HOOK, NEXT_RATES, NEXT_THRESHOLDS } from "./mainnet";
import { readMainnetCandidate, type CandidateSnapshot } from "./mainnetReader";
import { hookAbi } from "./mainnetAbis";
import { useWallet } from "./wallet";
import { fmt } from "./trading";
import { PriceChart } from "./PriceChart";

const targets = [0, ...NEXT_THRESHOLDS];
export const gateLabel = (i: number) =>
  i === 0
    ? "Initial"
    : targets[i] >= 1e6
      ? `$${targets[i] / 1e6}M`
      : `$${targets[i] / 1000}K`;
const x = (i: number) => 64 + i * 54;
const y = (i: number) => 244 - i * 12;
const path = (tier: number) =>
  `M${x(0)} ${y(0)}${Array.from({ length: tier }, (_, i) => `H${x(i + 1)}V${y(i + 1)}`).join("")}H${tier < 16 ? x(tier + 1) : x(tier) + 30}`;
const state = (index: number, snapshot: CandidateSnapshot | null) =>
  !snapshot
    ? "Unverified"
    : index === snapshot.tier
      ? "Current onchain"
      : index < snapshot.tier
        ? "Earned"
        : index === snapshot.tier + 1
          ? "Next gate"
          : "Future gate";

export function MarketTerminal({
  snapshot,
}: {
  snapshot: CandidateSnapshot | null;
}) {
  const [tab, setTab] = useState("ladder");
  const [selected, setSelected] = useState(0);
  const [touched, setTouched] = useState(false);
  const wallet = useWallet();
  const historyTab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (snapshot && !touched) setSelected(snapshot.tier);
  }, [snapshot?.tier, touched]);
  useEffect(() => {
    const onHash = () => {
      if (location.hash === "#activity") setTab("history");
      if (location.hash === "#milestones") setTab("ladder");
    };
    onHash();
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const choose = (i: number) => {
    setTouched(true);
    setSelected(i);
  };
  const next =
    snapshot && snapshot.tier < 16 ? targets[snapshot.tier + 1] : null;
  const progress =
    next && snapshot?.fdv != null
      ? Number((snapshot.fdv * 1000n) / (BigInt(next) * 10n ** 18n)) / 10
      : null;
  async function checkpoint() {
    await wallet.review({
      title: "Observe the current milestone",
      description:
        "Evaluate the deployed oracle on chain. A valid touch permanently opens crossed gates; the transaction may leave the tier unchanged.",
      address: HOOK,
      abi: hookAbi,
      functionName: "checkpoint",
      validate: async () => {
        const s = await readMainnetCandidate(null);
        if (!s.activated || s.fdv === null)
          throw Error("Activation and a valid oracle reading are required.");
      },
    });
  }
  return (
    <section
      className="graph-panel"
      id="milestones"
      aria-label="Unlock ladder and official pool price chart"
    >
      <div
        className="chart-tabs"
        id="activity"
        role="tablist"
        aria-label="Market view"
      >
        <button
          id="ladder-tab"
          role="tab"
          aria-selected={tab === "ladder"}
          aria-controls="ladder-view"
          tabIndex={tab === "ladder" ? 0 : -1}
          onClick={() => setTab("ladder")}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "End") {
              e.preventDefault();
              setTab("history");
              historyTab.current?.focus();
            }
          }}
        >
          Unlock ladder
        </button>
        <button
          ref={historyTab}
          id="history-tab"
          role="tab"
          aria-selected={tab === "history"}
          aria-controls="history-view"
          tabIndex={tab === "history" ? 0 : -1}
          onClick={() => setTab("history")}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "Home") {
              e.preventDefault();
              setTab("ladder");
              document.getElementById("ladder-tab")?.focus();
            }
          }}
        >
          Price chart
        </button>
        <span className="small muted">UNLK / IMD</span>
      </div>
      <div
        id="ladder-view"
        role="tabpanel"
        aria-labelledby="ladder-tab"
        hidden={tab !== "ladder"}
      >
        <div className="ladder-wrap">
          <div className="chart-title">
            <h2>The unlock ladder</h2>
            <span className="tag">20% → 100%</span>
          </div>
          <div className="chart-legend">
            <span className="accent">━ Earned onchain</span>
            <span className="warning">┄ Future gates</span>
            <span className="selected-text">◇ Selected</span>
          </div>
          <svg
            className="ladder-chart"
            viewBox="0 0 1000 300"
            aria-label="Categorical unlock staircase. Select any gate using the controls below."
            role="img"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              choose(
                Math.max(
                  0,
                  Math.min(
                    16,
                    Math.round(
                      (((e.clientX - r.left) / r.width) * 1000 - 64) / 54,
                    ),
                  ),
                ),
              );
            }}
          >
            {[0, 4, 8, 12, 16].map((i) => (
              <g key={i}>
                <line
                  className="grid-line"
                  x1="64"
                  x2="958"
                  y1={y(i)}
                  y2={y(i)}
                />
                <text x="8" y={y(i) + 5} className="axis-label">
                  {NEXT_RATES[i] / 100}%
                </text>
              </g>
            ))}
            {targets.map((_, i) => (
              <line
                key={i}
                className="grid-line vertical"
                x1={x(i)}
                x2={x(i)}
                y1="40"
                y2="260"
              />
            ))}
            <path d={path(16)} className="future-path" />
            {snapshot && (
              <path d={path(snapshot.tier)} className="earned-path" />
            )}
            <line
              x1={x(selected)}
              x2={x(selected)}
              y1="35"
              y2="261"
              className="selection-line"
            />
            {targets.map((_, i) => (
              <g key={i}>
                <title>{`${gateLabel(i)} · ${NEXT_RATES[i] / 100}% · ${state(i, snapshot)}`}</title>
                <circle
                  cx={x(i)}
                  cy={y(i)}
                  r={i === snapshot?.tier ? 5 : 3}
                  fill={
                    snapshot && i <= snapshot.tier
                      ? "var(--accent)"
                      : "var(--warning)"
                  }
                />
                {i === selected && (
                  <circle
                    cx={x(i)}
                    cy={y(i)}
                    r="8"
                    fill="none"
                    stroke="var(--focus)"
                    strokeWidth="2"
                  />
                )}
                {snapshot && i === snapshot.tier + 1 && (
                  <circle
                    cx={x(i)}
                    cy={y(i)}
                    r="6"
                    fill="none"
                    stroke="var(--warning)"
                    strokeWidth="1"
                  />
                )}
                <text
                  x={x(i)}
                  y="285"
                  textAnchor="middle"
                  className={`axis-label tick ${i % 4 === 0 ? "major" : "minor"}`}
                >
                  {gateLabel(i)}
                </text>
              </g>
            ))}
            <text
              x={Math.min(840, Math.max(200, x(selected)))}
              y={Math.max(20, y(selected) - 15)}
              textAnchor="middle"
              className="selection-label"
            >
              {gateLabel(selected)} · {NEXT_RATES[selected] / 100}%
            </text>
          </svg>
          <div className="gate-inspector">
            <div className="ladder-readout" aria-live="polite">
              <div>
                <span className="small selected-text">
                  {state(selected, snapshot)}
                </span>
                <strong>
                  {gateLabel(selected)} → {NEXT_RATES[selected] / 100}%
                  allowance
                </strong>
              </div>
            </div>
            <div className="gate-controls">
              <label htmlFor="gate-select">Inspect gate</label>
              <select
                id="gate-select"
                value={selected}
                onChange={(e) => choose(Number(e.target.value))}
              >
                {targets.map((_, i) => (
                  <option key={i} value={i}>
                    {gateLabel(i)} · {NEXT_RATES[i] / 100}% ·{" "}
                    {state(i, snapshot)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="chart-note">
            Equal spacing by gate, not dollar value. Selection is a scenario;
            only the stored onchain tier grants rights. Gates never relock.
          </p>
        </div>
        <div className="graph-foot">
          <span>
            {snapshot
              ? `Confirmed: ${snapshot.p / 100}% · next: ${snapshot.fullyUnlocked ? "none" : gateLabel(snapshot.tier + 1)}`
              : "Confirmed tier unavailable"}
          </span>
          <span>
            {progress === null
              ? "Price progress unavailable"
              : `Next target: ${Math.min(100, progress).toFixed(1)}% (estimate)`}
          </span>
        </div>
        <details className="gate-details">
          <summary>All 16 gates & onchain observation</summary>
          <ol className="gate-list">
            {targets.map((_, i) => (
              <li key={i}>
                <button aria-pressed={selected === i} onClick={() => choose(i)}>
                  <span>{gateLabel(i)}</span>
                  <strong>{NEXT_RATES[i] / 100}%</strong>
                  <small>{state(i, snapshot)}</small>
                </button>
              </li>
            ))}
          </ol>
          <p className="small muted">
            A valid spot touch observed by a successful swap or checkpoint opens
            the highest crossed gate instantly and permanently. Oracle failures
            prevent new gates; existing rights remain. {snapshot?.oracleError}
          </p>
          <button
            className="button"
            disabled={
              !snapshot?.activated ||
              snapshot.fdv === null ||
              wallet.busy ||
              wallet.network !== 1
            }
            onClick={checkpoint}
          >
            Observe milestone onchain
          </button>
        </details>
      </div>
      <div
        id="history-view"
        role="tabpanel"
        aria-labelledby="history-tab"
        hidden={tab !== "history"}
      >
        {tab === "history" && <PriceChart />}
      </div>
    </section>
  );
}
