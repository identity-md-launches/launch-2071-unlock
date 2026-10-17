import { useState } from "react";
import { useData } from "./data";
import { useWallet } from "./wallet";
import { Amount, AddressLink, Notice } from "./components";
import { RATES, scenario, number } from "./math";
import { MILESTONE_LABELS } from "./charts";

export function WalletOverview() {
  const d = useData(),
    w = useWallet(),
    s = d.snapshot;
  // Never display another account's values, including the render before effects clear them.
  const v =
    d.wallet?.address.toLowerCase() === w.address?.toLowerCase()
      ? d.wallet
      : null;
  const [choice, setChoice] = useState(1);
  const future =
    v && s
      ? scenario(v.W, v.E, v.S, RATES[choice], s.p, s.fullyUnlocked)
      : null;
  return (
    <section
      className="wallet-overview panel"
      aria-labelledby="my-unlock-title"
    >
      <div className="panel-heading">
        <h2 id="my-unlock-title">My Unlock</h2>
        <span className="small muted">
          {s?.fullyUnlocked
            ? "Permanent full bypass"
            : s
              ? `${Number(s.p) / 100}% confirmed rate`
              : "Confirmed rate unavailable"}
        </span>
      </div>
      {!w.address ? (
        <div className="wallet-disconnected">
          <div>
            <strong>Your wallet. Your allowance.</strong>
            <p>Connect to read your balance and earned sell rights.</p>
          </div>
          <button className="button wallet-action" onClick={w.open}>
            Connect wallet ↗
          </button>
        </div>
      ) : (
        <>
          <div className="wallet-heading">
            <AddressLink address={w.address} />
            <span className="small muted">
              {v ? `Block ${v.block}` : "Reading wallet…"}
            </span>
          </div>
          {d.walletError && (
            <Notice tone="error">
              Wallet read failed. {d.walletError}{" "}
              <button className="text-button" onClick={d.refresh}>
                Retry
              </button>
            </Notice>
          )}
          {v ? (
            <>
              <dl className="wallet-ledger">
                <div>
                  <dt>Wallet balance · W</dt>
                  <dd>
                    <Amount value={v.W} />
                  </dd>
                </div>
                <div>
                  <dt>Eligible acquisitions · E</dt>
                  <dd>
                    <Amount value={v.E} />
                  </dd>
                </div>
                <div>
                  <dt>Already sold · S</dt>
                  <dd>
                    <Amount value={v.S} />
                  </dd>
                </div>
                <div>
                  <dt>Currently sellable · C</dt>
                  <dd className="earned">
                    <Amount value={v.within} />
                  </dd>
                </div>
              </dl>
              <div
                className="allowance-bar"
                role="img"
                aria-label={`${number(v.within)} UNLK within current sell allowance; ${number(v.outside)} UNLK outside allowance. Both remain in your wallet.`}
              >
                <span
                  style={{
                    width: `${v.W === 0n ? 0 : Number((v.within * 10000n) / v.W) / 100}%`,
                  }}
                />
              </div>
              <div className="bar-labels">
                <span className="earned">
                  ■ Within allowance <Amount value={v.within} />
                </span>
                <span className="muted">
                  ■ Outside allowance <Amount value={v.outside} />
                </span>
              </div>
              <p className="small muted">
                Both segments stay in your wallet. No tokens are escrowed.
                Transfers never create acquisition credit. Execution also needs
                liquidity, approval and gas.
                {s && s.block !== v.block
                  ? " Wallet values are refreshing."
                  : ""}
              </p>
              <div className="wallet-scenario">
                <label htmlFor="wallet-milestone">
                  Hypothetical milestone
                  <select
                    id="wallet-milestone"
                    value={choice}
                    onChange={(e) => setChoice(Number(e.target.value))}
                  >
                    {RATES.map((r, i) => (
                      <option key={i} value={i}>
                        {MILESTONE_LABELS[i]} ·{" "}
                        {i === 6 ? "Full bypass" : `${Number(r) / 100}%`}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <span className="small muted">
                    Same wallet · hypothetical sell allowance
                  </span>
                  <strong className="target">
                    <Amount value={future?.within} />
                  </strong>
                  <span className="small muted">
                    {future?.achieved
                      ? "Already achieved; earned rights do not decrease."
                      : `Increase: ${future ? number(future.increase) : "Unavailable"} UNLK. No execution promised.`}
                  </span>
                </div>
              </div>
              <details className="formula-details">
                <summary>Exact allowance calculation</summary>
                <p>
                  <code>
                    Q = max(0, floor(E × p / 10000) − S); C = min(W, Q)
                  </code>
                  . All calculations use token wei. The final full unlock uses W
                  for every holder, including transferred tokens. W, E and S
                  stay fixed in the hypothetical preview.
                </p>
              </details>
            </>
          ) : (
            <p className="empty-state">
              {d.walletError
                ? "Wallet data unavailable."
                : "Reading this wallet’s on-chain ledger…"}
            </p>
          )}
        </>
      )}
    </section>
  );
}
