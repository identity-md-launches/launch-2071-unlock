import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import { useData } from "./data";
import { useWallet } from "./wallet";
import {
  abi,
  addresses as a,
  explorer,
  REPO,
  source,
  SOURCE_COMMIT,
  LAUNCH_API,
} from "./config";
import { b } from "./live";
import {
  Amount,
  AddressLink,
  DataStamp,
  Notice,
  PageHeading,
  Stat,
} from "./components";
import {
  allowance,
  confirmationState,
  date,
  duration,
  exact,
  number,
  RATES,
  scenario,
  short,
  SUPPLY,
  TARGETS,
  UNIT,
  usd,
} from "./math";
import { Withdrawal } from "./Trade";
import { Rewards } from "./Rewards.tsx";
import { WalletOverview } from "./Unlock";
import { UnlockLadder } from "./charts";
export function MyUnlock() {
  const d = useData();
  const w = useWallet();
  const s = d.snapshot;
  const v = d.wallet;
  return (
    <>
      <PageHeading title="My Unlock">
        Your balance, cumulative acquisitions and official-pool sell allowance.
      </PageHeading>
      <WalletOverview />
      {s && s.pendingPayer[1] > 0n && (
        <section className="payer-sync">
          <h2>Original payer allocation</h2>
          <p>
            <AddressLink address={s.pendingPayer[0]} /> has{" "}
            <Amount value={s.pendingPayer[1]} /> of proven allocation credit
            pending. Anyone may synchronize it; the credit only goes to this
            recorded payer.
          </p>
          <button
            className="button"
            disabled={
              w.busy || w.network !== 11155111 || !w.address || !!d.error
            }
            onClick={() =>
              w.review({
                title: "Sync original payer credit",
                description:
                  "Credit the fixed original payer allocation once. This action cannot redirect credit or change the payer.",
                address: a.hook,
                abi: abi.hook,
                functionName: "syncPayer",
                onSuccess: d.refresh,
              })
            }
          >
            Review payer sync
          </button>
        </section>
      )}
      <Withdrawal />
      <Rewards />
      <DataStamp />
    </>
  );
}
export function Milestones() {
  const d = useData();
  const s = d.snapshot;
  const w = useWallet();
  const [choice, setChoice] = useState(1);
  const [mode, setMode] = useState<"example" | "wallet">("example");
  const [input, setInput] = useState({ W: "1250", E: "1500", S: "250" });
  let values: { W: bigint; E: bigint; S: bigint } | null = null;
  let inputError = "";
  try {
    if (mode === "wallet") {
      if (d.wallet) values = d.wallet;
    } else {
      if (Object.values(input).some((v) => !/^\d+(?:\.\d{1,18})?$/.test(v)))
        throw Error("Use nonnegative amounts with up to 18 decimals.");
      values = {
        W: parseUnits(input.W, 18),
        E: parseUnits(input.E, 18),
        S: parseUnits(input.S, 18),
      };
    }
  } catch (e) {
    inputError = (e as Error).message;
  }
  const rate = mode === "example" ? 2500n : (s?.p ?? 2500n);
  const full = mode === "wallet" && !!s?.fullyUnlocked;
  const current = values
    ? allowance(values.W, values.E, values.S, rate, full)
    : null;
  const future = values
    ? scenario(values.W, values.E, values.S, RATES[choice], rate, full)
    : null;
  return (
    <>
      <PageHeading title="Milestones">
        Verified targets raise cumulative sell rights permanently. Falling
        prices never revoke an achieved tier.
      </PageHeading>
      <div className="milestone-overview">
        <Stat
          label="Achieved rate"
          value={s ? `${Number(s.p) / 100}%` : "Reading…"}
          note={s ? `Tier ${s.tier} of 6` : "On-chain state"}
        />
        <Stat
          label="Current verified FDV"
          value={usd(s?.fdv)}
          note="Invalid data is unavailable, never zero"
        />
        <Stat
          label="Final unlock target"
          value="$5,000,000"
          note="Removes quotas for all holders"
        />
      </div>
      <section className="panel milestone-chart">
        <UnlockLadder />
      </section>
      <OraclePanel />
      <section className="scenario-section">
        <div className="section-heading">
          <div>
            <h2>Hypothetical allowance</h2>
            <p>
              Hypothetical results. W, E and S stay fixed; no future price or
              execution is promised.
            </p>
          </div>
        </div>
        <div className="segmented scenario-mode">
          <button
            aria-pressed={mode === "example"}
            onClick={() => setMode("example")}
          >
            Worked example
          </button>
          <button
            aria-pressed={mode === "wallet"}
            disabled={!d.wallet}
            onClick={() => setMode("wallet")}
          >
            Connected wallet
          </button>
        </div>
        <div className="scenario-layout">
          <div>
            <div className="scenario-inputs">
              {(["W", "E", "S"] as const).map((key) => (
                <label key={key} htmlFor={`scenario-${key}`}>
                  {key} ·{" "}
                  {key === "W"
                    ? "Wallet balance"
                    : key === "E"
                      ? "Eligible acquisitions"
                      : "Sales already used"}
                  <input
                    id={`scenario-${key}`}
                    inputMode="decimal"
                    value={
                      mode === "wallet" && d.wallet
                        ? exact(d.wallet[key])
                        : input[key]
                    }
                    readOnly={mode === "wallet"}
                    onChange={(e) =>
                      setInput({ ...input, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <label className="scenario-target" htmlFor="scenario-tier">
              Hypothetical milestone
              <select
                id="scenario-tier"
                value={choice}
                onChange={(e) => setChoice(Number(e.target.value))}
              >
                {RATES.map((r, i) => (
                  <option value={i} key={String(r)}>
                    {i === 0
                      ? "Initial"
                      : `$${TARGETS[i].toLocaleString("en-US")}`}{" "}
                    · {Number(r) / 100}%
                  </option>
                ))}
              </select>
            </label>
            <p className="error" role="status">
              {inputError}
            </p>
          </div>
          <div className="scenario-result">
            <span>Within allowance at this scenario</span>
            <strong>
              <Amount value={future?.within} />
            </strong>
            <div>
              <span>
                Current allowance in this{" "}
                {mode === "example" ? "example" : "wallet"}
              </span>
              <Amount value={current?.within} />
            </div>
            <div>
              <span>
                {future?.achieved
                  ? "Selected tier already achieved"
                  : "Increase over current allowance"}
              </span>
              <strong>
                {future?.achieved ? (
                  "No rights are revoked"
                ) : (
                  <Amount value={future?.increase} />
                )}
              </strong>
            </div>
            <p className="small">
              {choice === 6
                ? "Final unlock uses W, including transfer-only holdings."
                : "Cᵣ = min(W, max(0, floor(E × r / 10,000) − S))."}{" "}
              Liquidity and transaction costs remain separate.
            </p>
          </div>
        </div>
        <details>
          <summary>Why cumulative acquisitions matter</summary>
          <p>
            Example: buy 1,000 UNLK, sell 250, then buy 500 more. E is 1,500, S
            is 250 and W is 1,250. At 25%, the cumulative cap is 375; after the
            250 already sold, 125 remain within the allowance. At 35%, the cap
            is 525 and the allowance is 275: an increase of 150. Ordinary
            transfers change W, but never E or S.
          </p>
        </details>
      </section>
      <DataStamp />
    </>
  );
}
export function OraclePanel() {
  const d = useData();
  const s = d.snapshot;
  const w = useWallet();
  const status = s ? confirmationState(s) : null;
  const checkpointOld =
    !!s?.last && s.timestamp - s.last.time > s.checkpointAge;
  const fresh = !!s && !d.error && Date.now() - s.fetchedAt < 60000;
  return (
    <section className="oracle-panel">
      <div className="section-heading">
        <div>
          <h2>Milestone confirmation</h2>
          <p>{status?.label ?? "Reading the oracle and confirmation state…"}</p>
        </div>
        <span className={`tag ${s?.fdv == null ? "warning" : ""}`}>
          {s?.fdv == null ? "Oracle unavailable" : "Valid oracle reading"}
        </span>
      </div>
      {s && (
        <>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Progress from recorded valid confirmations, not elapsed wall-clock time"
            aria-valuenow={status?.progress ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${status?.progress ?? 0}%` }} />
          </div>
          <div className="oracle-grid">
            <div>
              <span>Recorded pending start</span>
              <strong>
                {s.qualifyingSince > 0n
                  ? date(s.qualifyingSince)
                  : "Not started"}
              </strong>
            </div>
            <div>
              <span>Last valid confirmation</span>
              <strong>
                {s.lastConfirmation > 0n
                  ? date(s.lastConfirmation)
                  : "None recorded"}
              </strong>
            </div>
            <div>
              <span>Latest checkpoint</span>
              <strong>
                {s.last
                  ? `${duration(s.timestamp - s.last.time)} old${checkpointOld ? " · stale" : ""}`
                  : "No observations"}
              </strong>
            </div>
            <div>
              <span>ETH/USD update</span>
              <strong>
                {s.feedTime > 0n
                  ? `${duration(s.timestamp - s.feedTime)} old`
                  : "Unavailable"}
              </strong>
            </div>
            <div>
              <span>Observations</span>
              <strong>
                {s.observations.toString()} · {duration(s.window)} TWAP
              </strong>
            </div>
            <div>
              <span>Required duration for next tier</span>
              <strong>
                {s.fullyUnlocked
                  ? "All tiers achieved"
                  : duration(status!.required)}
              </strong>
            </div>
          </div>
          {s.oracleError && (
            <Notice tone="warning">
              {s.oracleError} Invalid data blocks new tiers, not earned rights
              or otherwise valid trades.
            </Notice>
          )}
          <details>
            <summary>Observation, liquidity and confirmation rules</summary>
            <p>
              The oracle needs a {duration(s.window)} warm-up and a valid full
              TWAP window. The last checkpoint must be no older than{" "}
              {duration(s.checkpointAge)}; ETH/USD must be coherent, positive
              and no older than {duration(s.feedAge)}.
            </p>
            <p>
              Confirmations are sequential: {duration(s.confirmation)} for each
              intermediate tier and {duration(s.finalConfirmation)} for the
              final tier. Valid confirmations must be at least{" "}
              {duration(s.minInterval)} apart and no more than{" "}
              {duration(s.maxGap)} apart. A longer gap restarts the next valid
              run. A valid below-target reading clears the pending start. An
              invalid reading does not advance the clock.
            </p>
            <p>
              Liquidity validation checks the factory’s actual seed position,
              price inside its recorded range, liquidity of at least{" "}
              {s.minLiquidity.toString()}, opening-value capacity of at least{" "}
              <Amount value={s.minCapacity} unit="test ETH" />, zero protocol
              fee and the 1.25% pool fee. Recorded seed quote capacity is{" "}
              <Amount value={s.seedQuoteCapacity} unit="test ETH" />; it is not
              ETH reserves or a manipulation-cost guarantee.
            </p>
            <p>
              Elapsed time alone cannot unlock a tier. A valid on-chain call
              must confirm it. Targets may never occur.
            </p>
          </details>
        </>
      )}
      <div className="oracle-actions">
        <button
          className="button"
          disabled={!w.address || w.network !== 11155111 || w.busy || !fresh}
          onClick={() =>
            w.review({
              title: "Checkpoint pool state",
              description:
                "Record the current pool state in the oracle. This permissionless transaction costs gas. It does not itself call updateMilestone or guarantee a valid FDV.",
              address: b.oracle,
              abi: abi.oracle,
              functionName: "checkpoint",
              onSuccess: d.refresh,
            })
          }
        >
          Review checkpoint
        </button>
        <button
          className="button"
          disabled={
            !w.address ||
            w.network !== 11155111 ||
            w.busy ||
            !fresh ||
            s?.fullyUnlocked
          }
          onClick={() =>
            w.review({
              title: "Update milestone",
              description:
                "Checkpoint the pool and attempt a milestone confirmation using the deployed rules. This costs gas even if no tier changes. An invalid oracle reading can leave the tier unchanged.",
              address: a.hook,
              abi: abi.hook,
              functionName: "updateMilestone",
              onSuccess: d.refresh,
            })
          }
        >
          Review milestone update
        </button>
        {!w.address && (
          <button className="text-button" onClick={w.open}>
            Connect to take an action
          </button>
        )}
      </div>
      <p className="small muted">
        These calls are permissionless and require explicit signing. This static
        site does not maintain observations when nobody submits transactions.
      </p>
    </section>
  );
}
export function Activity() {
  const d = useData();
  const [tab, setTab] = useState<"holders" | "activity">("holders");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  useEffect(() => setPage(0), [tab, search, kind]);
  const holders = (d.holders ?? []).filter(
    (h) =>
      h.address.toLowerCase().includes(search.toLowerCase()) ||
      h.label.toLowerCase().includes(search.toLowerCase()),
  );
  const events = (d.index?.events ?? [])
    .filter(
      (e) =>
        [
          "Executed",
          "Transfer",
          "Claimed",
          "Attested",
          "NativeWithdrawn",
          "Milestone",
        ].includes(e.kind) &&
        (kind === "all" || e.kind === kind) &&
        [e.account, e.from, e.to, e.hash].some((x) =>
          x?.toLowerCase().includes(search.toLowerCase()),
        ),
    )
    .reverse();
  const rows = tab === "holders" ? holders : events;
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const active = Math.min(page, pages - 1);
  return (
    <>
      <PageHeading title="Holders & activity">
        Real token holders and contract activity, indexed from verified Sepolia
        events.
      </PageHeading>
      <div className="activity-summary">
        <Stat
          label="Nonzero addresses in covered history"
          value={d.holders ? d.holders.length : "Reading…"}
          note="Includes infrastructure; excludes the zero address"
        />
        <Stat
          label="Covered pool swaps"
          value={
            d.index
              ? d.index.events.filter((e) => e.kind === "Swap").length
              : "Reading…"
          }
          note="Only the official PoolId"
        />
        <Stat
          label="History coverage"
          value={
            d.index?.complete
              ? "Complete interval"
              : d.index
                ? "Partial interval"
                : "Loading…"
          }
          note={
            d.index
              ? `Blocks ${d.index.from}–${d.index.to}`
              : "From the deployment block"
          }
        />
      </div>
      <Notice>
        Addresses are wallets or contracts, not people. PoolManager is shared
        infrastructure: its token balance is not this pool’s reserves. Balances
        are read at the latest displayed block; address discovery and activity
        lag by two blocks.
      </Notice>
      <div className="table-controls">
        <div className="segmented">
          <button
            aria-pressed={tab === "holders"}
            onClick={() => setTab("holders")}
          >
            Holders
          </button>
          <button
            aria-pressed={tab === "activity"}
            onClick={() => setTab("activity")}
          >
            Activity
          </button>
        </div>
        <label htmlFor="activity-search">
          Filter by address or transaction
          <input
            id="activity-search"
            type="search"
            placeholder="0x…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {tab === "activity" && (
          <label htmlFor="event-kind">
            Event
            <select
              id="event-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="all">All covered events</option>
              {[
                "Executed",
                "Transfer",
                "Claimed",
                "Attested",
                "NativeWithdrawn",
                "Milestone",
              ].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {d.historyError && (
        <Notice tone="warning">
          History is incomplete or unavailable. {d.historyError.slice(0, 180)}{" "}
          <button className="text-button" onClick={d.refresh}>
            Retry reads
          </button>
        </Notice>
      )}
      {tab === "holders" ? (
        <table>
          <caption>
            Current balances and verified official-pool allowances for
            discovered addresses
          </caption>
          <thead>
            <tr>
              <th scope="col">Address / role</th>
              <th scope="col">Balance</th>
              <th scope="col">Supply share</th>
              <th scope="col">Within current allowance</th>
            </tr>
          </thead>
          <tbody>
            {holders.slice(active * 10, active * 10 + 10).map((h) => (
              <tr key={h.address}>
                <td data-label="Address / role">
                  <AddressLink address={h.address} />
                  <span className="small muted">{h.label}</span>
                </td>
                <td data-label="Balance">
                  <Amount value={h.balance} />
                </td>
                <td data-label="Supply share">{h.share}</td>
                <td data-label="Within allowance">
                  <Amount value={h.within} />
                  {h.E === 0n && !d.snapshot?.fullyUnlocked && (
                    <span className="small muted">No eligible credit</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table>
          <caption>
            Covered transactions; only successful emitted events are listed
          </caption>
          <thead>
            <tr>
              <th scope="col">Event / time</th>
              <th scope="col">Account</th>
              <th scope="col">Amount / output</th>
              <th scope="col">Transaction</th>
            </tr>
          </thead>
          <tbody>
            {events.slice(active * 10, active * 10 + 10).map((e) => {
              const swap = d.index?.events.find(
                (x) => x.hash === e.hash && x.kind === "Swap",
              );
              return (
                <tr key={e.id}>
                  <td data-label="Event / time">
                    <strong>
                      {e.kind === "Executed"
                        ? swap?.amount0 == null
                          ? "Swap executed"
                          : swap.amount0 < 0n
                            ? "↗ Buy executed"
                            : "↘ Sell executed"
                        : e.kind}
                    </strong>
                    <span className="small muted">
                      {date(e.time)} · {e.block.toString()}
                    </span>
                  </td>
                  <td data-label="Account">
                    {(e.account ?? e.to) ? (
                      <AddressLink address={(e.account ?? e.to)!} />
                    ) : (
                      <span>Pool state</span>
                    )}
                    {e.from && (
                      <span className="small muted address">From {e.from}</span>
                    )}
                  </td>
                  <td data-label="Amount / output">
                    {e.kind === "Milestone" ? (
                      "Milestone event"
                    ) : (
                      <Amount
                        value={e.output ?? e.amount}
                        unit={
                          e.kind === "NativeWithdrawn" ||
                          (e.kind === "Executed" &&
                            !!swap?.amount0 &&
                            swap.amount0 > 0n)
                            ? "test ETH"
                            : "UNLK"
                        }
                      />
                    )}
                  </td>
                  <td data-label="Transaction">
                    <a
                      href={explorer(e.hash, "tx")}
                      target="_blank"
                      rel="noreferrer"
                      title={e.hash}
                    >
                      {short(e.hash)} ↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!rows.length && (
        <p className="empty-state">
          {d.historyLoading
            ? "Loading covered events and current balances…"
            : search
              ? "No matching records. Clear the filter to see all covered records."
              : "No records available in the covered interval."}
        </p>
      )}
      <div className="pagination">
        <span>
          {rows.length}{" "}
          {tab === "holders" ? "matching addresses" : "matching events"} · page{" "}
          {active + 1} of {pages}
        </span>
        <div>
          <button
            className="button compact"
            disabled={active === 0}
            onClick={() => setPage(active - 1)}
          >
            Previous
          </button>
          <button
            className="button compact"
            disabled={active + 1 >= pages}
            onClick={() => setPage(active + 1)}
          >
            Next
          </button>
        </div>
      </div>
      <DataStamp />
    </>
  );
}
const FAQs: [string, string][] = [
  [
    "What does “within your current sell allowance” mean?",
    "Before permanent unlock, the official pool lets a wallet sell up to floor(E × p / 10,000) minus S, capped by its current balance W. E is cumulative eligible acquisitions, S is executed token sales and p is the achieved rate. It is an allowance for this pool, not a promise that a trade can execute. Liquidity, fees, approvals and pending transactions still matter.",
  ],
  [
    "Are my tokens locked or escrowed?",
    "No. UNLK stays in your wallet and remains transferable. “Outside your current allowance” describes the portion you cannot currently sell through the official pool. It does not describe custody or escrow. Ordinary transfers, donations and liquidity never move, create or reset E or S.",
  ],
  [
    "Which acquisitions earn quota credit?",
    "Authenticated buys through the bound UnlkSwapRouter credit the actual tokens received. The original payer can synchronize its proven 3% allocation once. Native reward claims become eligible only after proof attestation and hook synchronization. Unclaimed rewards, transfers and liquidity do not create credit.",
  ],
  [
    "Can transferred tokens be sold?",
    "Before full unlock, a transfer-only holder with E = 0 has no sell allowance in this official pool. A holder with existing eligible credit can sell only within its remaining quota and balance. At permanent full unlock, every holder can sell its whole balance here, including transfer-only holders, subject to execution conditions. Other pools can bypass this official-pool restriction.",
  ],
  [
    "What changes at a milestone?",
    "The achieved rate starts at 25%. Verified USD FDV targets of $100K, $250K, $500K, $1M and $2.5M raise it to 35%, 45%, 55%, 70% and 85%. The $5M final milestone permanently removes quotas. Confirmations are sequential and depend on valid oracle data and on-chain calls; prices can fall without revoking earned rights. Targets may never occur.",
  ],
  [
    "Why is spot FDV different from verified FDV?",
    "Spot FDV is the current pool price times one billion tokens, using a valid ETH/USD feed. Milestone FDV comes from the deployed two-hour token/ETH TWAP and a valid ETH/USD reading. A stale checkpoint, invalid feed or invalid interval makes verified FDV unavailable. Neither value establishes an independent fair market valuation.",
  ],
  [
    "Who maintains the oracle?",
    "Anyone can checkpoint or attempt a milestone update, paying Sepolia gas. Official trades also checkpoint and attempt updates. This static website is not a keeper service. Without callers, observations become stale and valid-confirmation gaps can restart the next run. A timer reaching zero does not automatically unlock anything.",
  ],
  [
    "What are the fees and where does ETH go?",
    "The pool fee is 1.25%, split into 1% for the payer and 0.25% for IMD; the hook adds no fee. Network gas is separate. Sell proceeds and unused buy prefunding accumulate in router.nativeCredit for the same trader. Call withdrawNative separately to receive ETH in that wallet. A rejecting recipient can retry withdrawal; nobody can redirect the credit.",
  ],
  [
    "How do rewards work?",
    "The native distributor stores a round root, release time, funded amount, claimed flags and swept state. The app checks IMD’s exact proof against that root. Native claim, evidence attestation and hook.syncRewards are three recoverable transactions, each deduplicated on chain. The evidence contract requires certification of the complete unique-recipient tree. Certification is not a prerequisite for the native claim itself.",
  ],
  [
    "What does principal protection establish?",
    "The official hook accepts only the factory’s seed position. Nonzero liquidity removal reverts; the factory can collect fees. This protects position principal from that removal path, not its price or economic value. Trades change the seed’s ETH/UNLK composition. Opening-value quote capacity is not actual ETH reserves, and PoolManager balances span other pools.",
  ],
  [
    "Can these rules change?",
    "The activated setup is immutable: no later hook upgrade, reset, exemption, pause control or replacement companion. That does not freeze external dependencies. PoolManager protocol fees can cause the official hook to halt trades, and feed governance remains external. The treasury can open funded reward rounds and receives eligible swept unclaimed rewards; synchronized claims can create additional eligible acquisitions.",
  ],
  [
    "What can go wrong?",
    "A sustained, manipulated pool price can permanently unlock quotas. The existing economic review reproduces this risk. Other pools can bypass the restrictions, protocol-fee changes can halt official trading, and treasury reward powers affect eligible acquisitions. These rules give no safety or return guarantee. Review findings and worker tests are evidence, not certification of safety.",
  ],
  [
    "Is there a mainnet launch date?",
    "No mainnet date or final configuration is decided. More tiers or higher targets may be considered later; they are not the current Sepolia rules. This site only uses Sepolia test assets with no real monetary value.",
  ],
];
export function HowItWorks() {
  return (
    <>
      <PageHeading title="Rules & risks">
        A transparent experiment in cumulative acquisitions, earned sell rights
        and permanent unlock.
      </PageHeading>
      <div className="how-intro">
        <div>
          <h2>
            One balance.
            <br />
            Three ledger values.
          </h2>
          <p>
            <strong>W</strong> is what your wallet holds. <strong>E</strong>{" "}
            records eligible acquisitions over time. <strong>S</strong> records
            the tokens already sold through the official route.
          </p>
          <p>
            Transfers affect your balance, but not your acquisition or sales
            history. Selling uses a cumulative allowance; receiving more tokens
            does not erase what you have sold.
          </p>
          <a className="text-link" href="#/milestones">
            Try the worked example ↗
          </a>
        </div>
      </div>
      <section className="faq-list" aria-label="Frequently asked questions">
        {FAQs.map(([q, a], i) => (
          <details key={q} open={i === 0}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
      <div className="split-note">
        <p>
          Read the existing{" "}
          <a
            href={source("docs/SECURITY_REVIEW.md")}
            target="_blank"
            rel="noreferrer"
          >
            review findings
          </a>{" "}
          and{" "}
          <a
            href={source("docs/REVISION_2026-10-13.md")}
            target="_blank"
            rel="noreferrer"
          >
            revision record
          </a>
          . The site makes no independent audit claim.
        </p>
        <a className="button" href="#/contracts">
          Inspect source and contracts ↗
        </a>
      </div>
    </>
  );
}
export function Contracts() {
  const d = useData();
  const s = d.snapshot;
  const rows = [
    ["Token", "UnlkToken", a.token],
    ["Official hook", "UnlkHook", a.hook],
    ["Bound swap router", "UnlkSwapRouter", a.router],
    ["Native distributor", "MerkleDistributor", a.distributor],
    ["Claim evidence", "MerkleClaimEvidence", b.rewards],
    ["Milestone oracle", "UnlkOracle", b.oracle],
  ];
  return (
    <>
      <PageHeading title="Contracts & evidence">
        The existing Sepolia deployment, its verified bindings and the limits of
        the evidence.
      </PageHeading>
      <div className="transparency-intro">
        <div>
          <span className="tag">Sepolia · chain 11155111</span>
          <h2>Launch 1560</h2>
          <p>
            Source commit{" "}
            <a
              className="address"
              href={`${REPO}/commit/${SOURCE_COMMIT}`}
              target="_blank"
              rel="noreferrer"
            >
              {SOURCE_COMMIT}
            </a>
          </p>
          <p className="small muted">
            Parent job 407c3cbb-d967-4666-99e6-0ab7139c141f. No new token, pool
            or chain deployment is part of this website.
          </p>
        </div>
        <div>
          <h3>What was verified</h3>
          <p>
            Token and hook canonical ABI hashes match the supplied pins. Five
            project runtimes match the accepted-source build after immutable
            normalization. Live reciprocal bindings and the PoolKey are
            rechecked before transaction signing.
          </p>
          <a
            className="text-link"
            href="./evidence/chain-verification.json"
            target="_blank"
            rel="noreferrer"
          >
            Read block-stamped verification evidence ↗
          </a>
        </div>
      </div>
      <div className="contract-list">
        {rows.map(([label, name, address]) => (
          <article key={label}>
            <div>
              <h3>{label}</h3>
              <span className="small muted">{name}</span>
            </div>
            <AddressLink address={address} />
            <div className="contract-links">
              <a href={`./abi/${name}.json`} download>
                ABI ↓
              </a>
              <a
                href={source(
                  name === "MerkleDistributor"
                    ? "test/imd/MerkleDistributor.sol"
                    : `src/${name}.sol`,
                )}
                target="_blank"
                rel="noreferrer"
              >
                Source ↗
              </a>
            </div>
          </article>
        ))}
      </div>
      <section className="pool-record">
        <h2>The official pool, exactly.</h2>
        <dl className="details">
          <div>
            <dt>Currency 0</dt>
            <dd>
              Native ETH{" "}
              <code className="address">
                0x0000000000000000000000000000000000000000
              </code>
            </dd>
          </div>
          <div>
            <dt>Currency 1</dt>
            <dd>
              <AddressLink address={a.token} />
            </dd>
          </div>
          <div>
            <dt>Fee / spacing</dt>
            <dd>12500 (1.25%) / 60 ticks</dd>
          </div>
          <div>
            <dt>Hook</dt>
            <dd>
              <AddressLink address={a.hook} />
            </dd>
          </div>
          <div>
            <dt>PoolId</dt>
            <dd>
              <code className="address">{b.poolId}</code>
            </dd>
          </div>
          <div>
            <dt>PoolManager</dt>
            <dd>
              <AddressLink address={a.manager} />
            </dd>
          </div>
          <div>
            <dt>StateView</dt>
            <dd>
              <AddressLink address={a.stateView} />
            </dd>
          </div>
          <div>
            <dt>ETH/USD feed</dt>
            <dd>
              <AddressLink address={b.feed} />
            </dd>
          </div>
          <div>
            <dt>Launch factory</dt>
            <dd>
              <AddressLink address={b.factory} />
            </dd>
          </div>
          <div>
            <dt>Original payer</dt>
            <dd>
              <AddressLink address={b.payer} />
            </dd>
          </div>
        </dl>
      </section>
      <section className="allocation-section">
        <h2>One billion. Three allocations.</h2>
        <div
          className="allocation-bar"
          role="img"
          aria-label="10% contributor rewards, 87% pool allocation, 3% original payer"
        >
          <span style={{ width: "10%" }} />
          <span style={{ width: "87%" }} />
          <span style={{ width: "3%" }} />
        </div>
        <div className="allocation-labels">
          <Stat
            label="Contributor rewards"
            value="10%"
            note="100,000,000 UNLK"
          />
          <Stat
            label="Pool allocation"
            value="87%"
            note="870,000,000 UNLK policy share"
          />
          <Stat
            label="Original payer"
            value="3%"
            note="30,000,000 UNLK eligible credit"
          />
        </div>
        <p>
          Factory seeding has bounded token rounding; the remainder goes to the
          original payer without increasing its 3% eligible credit. Recorded
          seeded principal: <Amount value={s?.seedTokens} />. Recorded
          opening-value quote capacity:{" "}
          <Amount value={s?.seedQuoteCapacity} unit="test ETH" digits={8} />.
        </p>
        <p>
          Current seed-position principal:{" "}
          <Amount value={s?.poolEth} unit="test ETH" digits={8} /> and{" "}
          <Amount value={s?.poolTokens} />, derived from the live position
          liquidity and price, excluding fees. This is not the manager’s total
          balance.
        </p>
        <a
          className="text-link"
          href={source("src/UnlkHook.sol")}
          target="_blank"
          rel="noreferrer"
        >
          Inspect principal-removal restrictions ↗
        </a>
      </section>
      <section className="review-record">
        <h2>Evidence has boundaries.</h2>
        <p>
          The published review documents sustained-price manipulation,
          outside-pool bypass, protocol-fee-triggered halts and treasury
          reward-round powers. Repairs and local tests do not remove those
          risks. No safety or return guarantee is made.
        </p>
        <div className="document-links">
          <a
            href={source("docs/SECURITY_REVIEW.md")}
            target="_blank"
            rel="noreferrer"
          >
            Review findings ↗
          </a>
          <a
            href={source("docs/REVISION_2026-10-13.md")}
            target="_blank"
            rel="noreferrer"
          >
            Contract revision record ↗
          </a>
          <a href={LAUNCH_API} target="_blank" rel="noreferrer">
            Public launch record ↗
          </a>
          <a href="./evidence/round-0.json" target="_blank" rel="noreferrer">
            Native round-0 proofs ↗
          </a>
          <a href="./evidence/validation.md" target="_blank" rel="noreferrer">
            Website validation notes ↗
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            GitHub repository ↗
          </a>
        </div>
      </section>
      <DataStamp />
    </>
  );
}
