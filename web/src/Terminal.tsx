import { useState } from "react";
import { useData } from "./data";
import { Trade, Withdrawal } from "./Trade";
import { WalletOverview } from "./Unlock";
import { UnlockLadder, PriceChart, MILESTONE_LABELS } from "./charts";
import { DataStamp, Amount } from "./components";
import { OraclePanel } from "./pages";
import { Rewards } from "./Rewards.tsx";
import { usd, number, short, date } from "./math";
import { explorer } from "./config";

export function Terminal() {
  const d = useData(),
    s = d.snapshot;
  const [chart, setChart] = useState<"ladder" | "history">("ladder");
  return (
    <>
      <div className="terminal-intro">
        <div>
          <h1>
            UNLK <span className="muted">/ ETH</span>
          </h1>
          <span className="tag">Official pool</span>
        </div>
        <p>Trade UNLK with cumulative sell allowances.</p>
      </div>
      <dl className="terminal-metrics">
        <div>
          <dt>Indicative spot / FDV</dt>
          <dd>
            {s?.spotUsd != null ? `$${number(s.spotUsd, 8)}` : "Unavailable"}{" "}
            {s?.spotFdv != null && (
              <span className="muted">
                /{" "}
                {s?.spotFdv == null
                  ? "Unavailable"
                  : new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                      notation: "compact",
                      maximumFractionDigits: 2,
                    }).format(Number(s.spotFdv) / 1e18)}
              </span>
            )}
          </dd>
          <span>USD · spot, not milestone evidence</span>
        </div>
        <div>
          <dt>Confirmed tier</dt>
          <dd className="earned">
            {s
              ? `${s.fullyUnlocked ? "Full bypass" : `${Number(s.p) / 100}%`} · tier ${s.tier}/6`
              : "Unavailable"}
          </dd>
          <span>
            {d.error
              ? "Last read; refresh required"
              : "Rights only advance on chain"}
          </span>
        </div>
        <div>
          <dt>Next milestone</dt>
          <dd className="target">
            {s
              ? s.fullyUnlocked
                ? "All achieved"
                : MILESTONE_LABELS[s.tier + 1]
              : "Unavailable"}
          </dd>
          <span>USD FDV · sequential confirmation</span>
        </div>
        <div>
          <dt>Milestone oracle</dt>
          <dd className={s?.fdv == null ? "target" : "earned"}>
            {s?.fdv == null ? "○ Unavailable" : "● Valid reading"}
          </dd>
          <span>Verified FDV: {usd(s?.fdv)}</span>
        </div>
      </dl>
      <div className="terminal-workspace">
        <section className="graph-panel panel" aria-label="UNLK charts">
          <div className="chart-tabs segmented" aria-label="Chart view">
            <button
              aria-pressed={chart === "ladder"}
              onClick={() => setChart("ladder")}
            >
              Unlock ladder
            </button>
            <button
              aria-pressed={chart === "history"}
              onClick={() => setChart("history")}
            >
              Market history
            </button>
            <span className="small muted">UNLK protocol / 1560</span>
          </div>
          {chart === "ladder" ? <UnlockLadder /> : <PriceChart />}
          <div className="graph-foot">
            <span>
              {chart === "ladder"
                ? "01 / Protocol rules"
                : "02 / Official-pool events"}
            </span>
            <a href="#/milestones">Inspect milestones ↗</a>
          </div>
        </section>
        <Trade />
      </div>
      <DataStamp />
      <WalletOverview />
      <ActivityPreview />
      <div className="terminal-disclosures">
        <details>
          <summary>
            ETH credit & withdrawal{" "}
            <span>Sell proceeds settle as router credit</span>
          </summary>
          <Withdrawal />
        </details>
        <details>
          <summary>
            Rewards & acquisition credit <span>Claim → attest → sync</span>
          </summary>
          <Rewards />
        </details>
        <details>
          <summary>
            Oracle & permissionless actions{" "}
            <span>
              {s?.fdv == null
                ? "Verified FDV unavailable"
                : "Inspect confirmation state"}
            </span>
          </summary>
          <OraclePanel />
        </details>
        <details>
          <summary>
            How it works <span>The allowance, milestones and risks</span>
          </summary>
          <div className="quick-rules">
            <p>
              Official buys, the proven original payer allocation and
              synchronized native claims build eligible acquisitions. Ordinary
              transfers create no credit. The confirmed percentage determines
              the cumulative sell cap, less tokens already sold.
            </p>
            <p>
              At the final $5M verified milestone, quotas are permanently
              bypassed for everyone. Earlier checkpoints require sequential
              confirmations; spot prices and elapsed time alone cannot unlock a
              tier.
            </p>
            <p>
              Liquidity, approvals, fees and gas still apply. Price manipulation
              can permanently unlock quotas; other pools can bypass these rules.
              No milestone or return is promised.
            </p>
            <a className="text-link" href="#/how">
              Read all rules & risks ↗
            </a>
          </div>
        </details>
        <details>
          <summary>
            Deployment & diagnostics{" "}
            <span>Existing Sepolia contracts · no new deployment</span>
          </summary>
          <div className="quick-rules">
            <p>
              {d.error
                ? `Live reads interrupted: ${d.error}`
                : "The site rechecks deployed code and reciprocal contract bindings before signing."}
            </p>
            <p>
              Public transaction evidence is separate from this redesign. The
              activity view lists successful events in the covered interval;
              local tests do not establish a public transaction.
            </p>
            <a className="text-link" href="#/contracts">
              Inspect contracts, ABIs & evidence ↗
            </a>
            <button
              className="text-button"
              onClick={d.refresh}
              disabled={d.loading}
            >
              Retry live reads
            </button>
          </div>
        </details>
      </div>
    </>
  );
}
export function ActivityPreview() {
  const d = useData();
  const [tab, setTab] = useState<"trades" | "holders">("trades");
  const trades = (d.index?.events ?? [])
    .filter((e) => e.kind === "Executed")
    .slice(-5)
    .reverse();
  return (
    <section
      className="activity-preview panel"
      aria-label="Recent official activity"
    >
      <div className="panel-heading">
        <div className="segmented">
          <button
            aria-pressed={tab === "trades"}
            onClick={() => setTab("trades")}
          >
            Recent trades
          </button>
          <button
            aria-pressed={tab === "holders"}
            onClick={() => setTab("holders")}
          >
            Holders
          </button>
        </div>
        <a className="text-link" href="#/activity">
          All activity ↗
        </a>
      </div>
      <table className="compact-table">
        <caption>
          {d.index
            ? `${d.index.complete ? "Covered" : "Partial"} history · blocks ${d.index.from}–${d.index.to} · two-block delay`
            : "Reading covered on-chain history"}
        </caption>
        <thead>
          <tr>
            {(tab === "trades"
              ? ["Side / UTC", "Trader", "Received", "Transaction"]
              : [
                  "Address / role",
                  "Balance · UNLK",
                  "Supply share",
                  "Allowance · UNLK",
                ]
            ).map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tab === "trades"
            ? trades.map((e) => {
                const swap = d.index?.events.find(
                  (x) => x.hash === e.hash && x.kind === "Swap",
                );
                const direction =
                  swap?.amount0 == null ? null : swap.amount0 < 0n;
                return (
                  <tr key={e.id}>
                    <td>
                      <span
                        className={
                          direction === null
                            ? "muted"
                            : direction
                              ? "earned"
                              : "sell"
                        }
                      >
                        {direction === null
                          ? "Swap"
                          : direction
                            ? "↗ Buy"
                            : "↘ Sell"}
                      </span>
                      <span className="small muted">{date(e.time)}</span>
                    </td>
                    <td>
                      {e.account ? (
                        <a
                          href={explorer(e.account)}
                          title={e.account}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {short(e.account)} ↗
                        </a>
                      ) : (
                        "Unavailable"
                      )}
                    </td>
                    <td>
                      <Amount
                        value={e.output}
                        unit={
                          direction === null
                            ? ""
                            : direction
                              ? "UNLK"
                              : "test ETH credit"
                        }
                        digits={6}
                      />
                    </td>
                    <td>
                      <a
                        href={explorer(e.hash, "tx")}
                        title={e.hash}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(e.hash)} ↗
                      </a>
                    </td>
                  </tr>
                );
              })
            : (d.holders ?? []).slice(0, 5).map((h) => (
                <tr key={h.address}>
                  <td>
                    <a
                      href={explorer(h.address)}
                      title={h.address}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(h.address)} ↗
                    </a>
                    <span className="small muted">{h.label}</span>
                  </td>
                  <td>
                    <Amount value={h.balance} unit="" />
                  </td>
                  <td>{h.share}</td>
                  <td>
                    <Amount value={h.within} unit="" />
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
      {(tab === "trades" ? !trades.length : !d.holders?.length) && (
        <p className="empty-state">
          {d.historyLoading
            ? "Reading covered events…"
            : d.historyError
              ? "History unavailable. Retry live reads."
              : "No records in the covered interval."}
        </p>
      )}
      <p className="table-note">
        {d.historyError
          ? "History is incomplete; no missing records are inferred."
          : "Addresses include contracts; they are not a count of people. PoolManager balances span multiple pools."}
      </p>
    </section>
  );
}
