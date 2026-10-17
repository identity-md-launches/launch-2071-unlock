import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatEther, type Address } from "viem";
import {
  mainnetClient as client,
  TOKEN,
  HOOK,
  IMD,
  VAULT,
  ORACLE,
  EVIDENCE,
  DISTRIBUTOR,
  FACTORY,
  REGISTRY,
  POOL_ID,
  POOL_MANAGER,
  UNIVERSAL_ROUTER,
  QUOTER,
  PERMIT2,
  NEXT_THRESHOLDS,
  NEXT_RATES,
  NFT_BENEFICIARY,
} from "./mainnet";
import { readMainnetCandidate, type CandidateSnapshot } from "./mainnetReader";
import { useWallet, errorMessage } from "./wallet";
import {
  getQuote,
  parseAmount,
  parseSlippage,
  quoteCurrent,
  validateQuote,
  swapArgs,
  fmt,
  exact,
  erc20Abi,
  permitAbi,
  executeAbi,
  hookAbi,
  type Quote,
} from "./trading";
import { evidenceAbi, distributorAbi } from "./mainnetAbis";
import { verifyProof, type Leaf } from "./rewards";
import { NftGallery } from "./NftGallery";
import { MarketTerminal } from "./MarketTerminal";
const usd = (value: bigint | null | undefined) =>
  value === null || value === undefined ? "Unavailable" : `$${fmt(value, 2)}`;
const money = (value: number) =>
  value >= 1e6 ? `$${value / 1e6}M` : `$${value / 1000}K`;
function External({
  address,
  children,
}: {
  address: string;
  children: ReactNode;
}) {
  return (
    <a
      href={`https://etherscan.io/address/${address}`}
      target="_blank"
      rel="noreferrer"
    >
      {children} ↗
    </a>
  );
}
function Ledger({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="ledger">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Swap({
  snapshot,
  refresh,
}: {
  snapshot: CandidateSnapshot | null;
  refresh: () => void;
}) {
  const wallet = useWallet();
  const [buy, setBuy] = useState(true),
    [amount, setAmount] = useState(""),
    [slippage, setSlippage] = useState("0.5"),
    [quote, setQuote] = useState<Quote | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  useEffect(() => {
    ++generation.current;
    setQuote(null);
    setError("");
  }, [
    buy,
    amount,
    slippage,
    wallet.address,
    wallet.network,
    wallet.receiptVersion,
    snapshot?.activated,
  ]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  let value = 0n,
    amountError = "";
  try {
    if (amount) value = parseAmount(amount);
  } catch (e) {
    amountError = errorMessage(e);
  }
  let bps = 0;
  try {
    bps = parseSlippage(slippage);
  } catch {
    /* Validated when requesting a quote. */
  }
  const personal =
    snapshot?.wallet && snapshot.wallet.address === wallet.address
      ? snapshot.wallet
      : null;
  const fresh = !!snapshot && now - snapshot.readAt < 45000;
  const current =
    quote &&
    quoteCurrent(quote, wallet.address, buy, value, bps, now) &&
    snapshot &&
    snapshot.block <= quote.block + 3n;
  const token = buy ? IMD : TOKEN,
    approval = buy ? personal?.imdApproval : personal?.unlkApproval,
    permit = buy ? personal?.permit2Allowance : personal?.unlkPermit,
    expiration = buy ? personal?.permit2Expiration : personal?.unlkExpiration;
  const needToken = approval === undefined || approval < value;
  const needPermit =
    permit === undefined ||
    permit < value ||
    !expiration ||
    expiration < Math.floor(now / 1000) + 300;
  const disabled =
    loading ||
    wallet.busy ||
    !fresh ||
    !snapshot?.activated ||
    !wallet.address ||
    wallet.network !== 1;
  async function quoteNow() {
    setError("");
    setQuote(null);
    const request = ++generation.current;
    try {
      const parsed = parseAmount(amount);
      const chosenSlippage = parseSlippage(slippage);
      if (!snapshot || !wallet.address) throw Error("Connect a wallet first.");
      setLoading(true);
      const q = await getQuote(
        wallet.address,
        buy,
        parsed,
        chosenSlippage,
        snapshot,
      );
      if (request === generation.current) setQuote(q);
    } catch (e) {
      if (request === generation.current) setError(errorMessage(e));
    } finally {
      if (request === generation.current) setLoading(false);
      else setLoading(false);
    }
  }
  async function approveToken() {
    if (!wallet.address) return;
    await wallet.review({
      title: `Approve ${buy ? "IMD" : "UNLK"} to Permit2`,
      description:
        "Allow Permit2 to transfer this exact input amount. This does not authorize a swap by itself.",
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [PERMIT2, value],
      details: [
        ["Spender", PERMIT2],
        ["Approval", `${exact(value)} ${buy ? "IMD" : "UNLK"}`],
      ],
      validate: async () => {
        if (value <= 0n) throw Error("Enter a positive amount");
      },
      onSuccess: refresh,
    });
  }
  async function approveRouter() {
    if (!wallet.address) return;
    const expires = BigInt(Math.floor(Date.now() / 1000) + 1800);
    await wallet.review({
      title: "Authorize the Universal Router",
      description:
        "Permit2 allowance for this exact input amount, expiring in 30 minutes. This is a separate wallet transaction.",
      address: PERMIT2,
      abi: permitAbi,
      functionName: "approve",
      args: [token, UNIVERSAL_ROUTER, value, Number(expires)],
      details: [
        ["Token", token],
        ["Router", UNIVERSAL_ROUTER],
        ["Amount", exact(value)],
        ["Expires", new Date(Number(expires) * 1000).toLocaleString()],
      ],
      validate: async () => {
        if (BigInt(Math.floor(Date.now() / 1000)) >= expires)
          throw Error("Authorization expired. Review again.");
      },
      onSuccess: refresh,
    });
  }
  async function execute() {
    if (!quote || !current) return;
    const q = quote;
    await wallet.review({
      title: buy ? "Buy UNLK" : "Sell UNLK",
      description:
        "The exact router calldata is simulated from your execution account before confirmation and again before signing. Mainnet uses real assets.",
      address: UNIVERSAL_ROUTER,
      abi: executeAbi,
      functionName: "execute",
      args: swapArgs(q),
      value: 0n,
      details: [
        ["Pay", `${exact(q.amount)} ${q.buy ? "IMD" : "UNLK"}`],
        ["Minimum received", `${exact(q.minimum)} ${q.buy ? "UNLK" : "IMD"}`],
        ["Recipient / quota account", q.account],
        ["Slippage", `${q.slippage / 100}%`],
        ["Deadline", new Date(Number(q.deadline) * 1000).toLocaleTimeString()],
      ],
      validate: () => validateQuote(q),
      onSuccess: () => {
        setQuote(null);
        refresh();
      },
    });
  }
  return (
    <section
      className={`swap-panel ${buy ? "buy" : "sell"}`}
      id="trade"
      aria-labelledby="swap-title"
    >
      <div className="panel-heading">
        <h2 id="swap-title">Swap</h2>
        <span className="small muted">Ethereum mainnet</span>
      </div>
      <div className="segmented" aria-label="Trade direction">
        <button aria-pressed={buy} onClick={() => setBuy(true)}>
          Buy UNLK
        </button>
        <button aria-pressed={!buy} onClick={() => setBuy(false)}>
          Sell UNLK
        </button>
      </div>
      <div className="amount-field">
        <label htmlFor="swap-amount">
          You pay <span>{buy ? "IMD" : "UNLK"}</span>
        </label>
        <input
          id="swap-amount"
          name="swap-amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={!!amountError}
          aria-describedby="amount-error"
        />
        <div className="field-foot">
          <span>
            Balance: {fmt(buy ? personal?.imdBalance : personal?.balance, 4)}
          </span>
          {personal && !buy && (
            <button
              className="text-button"
              onClick={() => setAmount(exact(personal.sellable))}
            >
              Use sellable
            </button>
          )}
        </div>
      </div>
      <div className="receive-field">
        <span>
          You receive <strong>{buy ? "UNLK" : "IMD"}</strong>
        </span>
        <strong className="output-number">
          {current ? fmt(quote.output) : "—"}
        </strong>
      </div>
      <div className="slippage">
        <label htmlFor="slippage">Slippage tolerance</label>
        <div>
          <input
            id="slippage"
            type="number"
            inputMode="decimal"
            min="0.01"
            max="5"
            step="0.01"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
          />
          <span>%</span>
        </div>
      </div>
      <p id="amount-error" role="status" className="error">
        {amountError || error}
      </p>
      {!wallet.address ? (
        <button className="button primary full" onClick={wallet.open}>
          Connect to trade
        </button>
      ) : wallet.network !== 1 ? (
        <button className="button primary full" onClick={wallet.switchNetwork}>
          Switch to Ethereum
        </button>
      ) : (
        <button
          className="button primary full"
          disabled={disabled}
          onClick={quoteNow}
        >
          {loading
            ? "Getting quote…"
            : !snapshot?.activated
              ? "Trading not yet activated"
              : "Get live quote"}
        </button>
      )}
      <p className="swap-caption">
        Pay with {buy ? "IMD" : "UNLK"}. Receive {buy ? "UNLK" : "IMD"}. ETH is
        for gas only.
      </p>
      {snapshot && !snapshot.activated && (
        <p className="inline-status">
          Trading not yet activated. Owner activation is separate. This page
          detects it automatically.
        </p>
      )}
      {wallet.address && !fresh && (
        <p role="status" className="warning">
          State unavailable or stale. Refresh mainnet data to continue.
        </p>
      )}
      {quote && (
        <div className="quote-details">
          <div className="panel-heading">
            <h3>{current ? "Quote ready" : "Quote expired"}</h3>
            <span className="small muted">
              {current
                ? `${Math.max(0, 30 - Math.floor((now - quote.createdAt) / 1000))}s left`
                : "Get a new quote"}
            </span>
          </div>
          <Ledger
            rows={[
              [
                "Minimum received",
                `${exact(quote.minimum)} ${buy ? "UNLK" : "IMD"}`,
              ],
              [
                "Treasury component",
                `${exact(quote.treasury)} IMD${buy ? "" : " (±1 wei estimate)"}`,
              ],
              [
                "Pool + protocol fee",
                `${exact(quote.poolFee)} ${buy ? "IMD" : "UNLK"} (estimate)`,
              ],
              [
                "Directional pool fee",
                `${Number(quote.effectivePips) / 10000}%`,
              ],
              [
                "Price impact, excluding fees",
                `${Number(quote.impactBps) / 100}% (estimate)`,
              ],
              ["Protocol component", `${Number(quote.protocolPips) / 10000}%`],
              [
                "Router deadline",
                new Date(Number(quote.deadline) * 1000).toLocaleTimeString(),
              ],
              ["Gas balance", `${fmt(personal?.ethBalance, 6)} ETH`],
              [
                "Token allowance to Permit2",
                approval === undefined
                  ? "Unavailable"
                  : `${exact(approval)} ${buy ? "IMD" : "UNLK"}`,
              ],
              [
                "Permit2 allowance to router",
                permit === undefined ? "Unavailable" : exact(permit),
              ],
              [
                "Permit2 expiry",
                expiration
                  ? new Date(expiration * 1000).toLocaleString()
                  : "Not authorized",
              ],
            ]}
          />
          <p className="small muted">
            A quote bypasses quota checks. Review swap simulates these exact
            bytes from your account. Gas cost appears in that review.
          </p>
          {current &&
            (needToken ? (
              <button
                className="button full"
                disabled={wallet.busy}
                onClick={approveToken}
              >
                1. Approve {buy ? "IMD" : "UNLK"} to Permit2
              </button>
            ) : needPermit ? (
              <button
                className="button full"
                disabled={wallet.busy}
                onClick={approveRouter}
              >
                2. Authorize router in Permit2
              </button>
            ) : (
              <button
                className="button primary full"
                disabled={disabled}
                onClick={execute}
              >
                Review {buy ? "buy" : "sell"}
              </button>
            ))}
          <p className="small muted">
            Each approval requires its own wallet confirmation. Get a fresh
            quote after confirmation. Recipient defaults to the execution
            account.
          </p>
        </div>
      )}
    </section>
  );
}
function Rights({
  snapshot,
  refresh,
}: {
  snapshot: CandidateSnapshot | null;
  refresh: () => void;
}) {
  const wallet = useWallet(),
    personal =
      snapshot?.wallet && snapshot.wallet.address === wallet.address
        ? snapshot.wallet
        : null;
  const [leaf, setLeaf] = useState<Leaf | null>(null),
    [proofError, setProofError] = useState("");
  useEffect(() => {
    setLeaf(null);
    setProofError("");
    if (!wallet.address || !snapshot) return;
    let live = true;
    fetch("./claims/round-0.json")
      .then((r) => {
        if (!r.ok)
          throw Error(
            "Proof file unavailable. Import your native proof below.",
          );
        return r.json();
      })
      .then((tree) => {
        if (!live) return;
        const row = tree.leaves.find(
          (l: Leaf) => l.wallet.toLowerCase() === wallet.address?.toLowerCase(),
        );
        if (row) {
          if (!verifyProof(row, snapshot.round.root))
            throw Error("Proof does not match the onchain round root.");
          setLeaf(row);
        }
      })
      .catch((e) => {
        if (live) setProofError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [wallet.address, snapshot?.round.root]);
  async function importProof(file: File | undefined) {
    try {
      if (!file) return;
      if (file.size > 1000000) throw Error("Use a proof JSON under 1 MB.");
      const input = JSON.parse(await file.text());
      const row =
        input.leaves?.find(
          (r: Leaf) => r.wallet.toLowerCase() === wallet.address?.toLowerCase(),
        ) ?? input;
      const l = {
        wallet: row.wallet ?? row.account,
        amount: String(row.amount),
        proof: row.proof,
      };
      if (
        !snapshot ||
        l.wallet?.toLowerCase() !== wallet.address?.toLowerCase() ||
        !verifyProof(l, snapshot.round.root)
      )
        throw Error(
          "Proof must match your connected account and the onchain round-0 root.",
        );
      setLeaf(l);
      setProofError("");
    } catch (e) {
      setProofError(errorMessage(e));
    }
  }
  const stale = !snapshot || Date.now() - snapshot.readAt > 45000;
  const enabled = !!personal && wallet.network === 1 && !wallet.busy && !stale;
  const unlocked = !!snapshot && snapshot.blockTime >= snapshot.round.unlocksAt;
  async function action(kind: "claim" | "attest" | "sync" | "payer") {
    if (!wallet.address || !snapshot) return;
    const account = wallet.address;
    const params =
      kind === "claim"
        ? {
            address: DISTRIBUTOR,
            abi: distributorAbi,
            functionName: "claim",
            args: leaf ? [0n, account, BigInt(leaf.amount), leaf.proof] : [],
          }
        : kind === "attest"
          ? {
              address: EVIDENCE,
              abi: evidenceAbi,
              functionName: "attest",
              args: leaf ? [0n, account, BigInt(leaf.amount), leaf.proof] : [],
            }
          : {
              address: HOOK,
              abi: hookAbi,
              functionName: kind === "sync" ? "syncRewards" : "syncPayer",
              args: kind === "sync" ? [account] : [],
            };
    const titles = {
      claim: "Claim native allocation",
      attest: "Attest claimed allocation",
      sync: "Sync selling credit",
      payer: "Sync payer credit",
    };
    await wallet.review({
      ...params,
      title: titles[kind],
      description:
        kind === "claim"
          ? "The native distributor sends UNLK only to the account in the proof. Claiming is independent of activation, attestation and selling-credit sync."
          : kind === "attest"
            ? "Record your already-claimed allocation in the certified evidence contract. This does not claim tokens or sync quota."
            : "Sync only the uncredited eligible amount. Contract deduplication prevents double credit. Rights remain attached to this account.",
      details: [
        ["Account", account],
        ["Round", "0"],
        ...(leaf
          ? [
              ["Native allocation", `${exact(BigInt(leaf.amount))} UNLK`] as [
                string,
                string,
              ],
            ]
          : []),
      ],
      validate: async () => {
        const fresh = await readMainnetCandidate(null, client, account);
        if (
          kind === "claim" &&
          (!leaf ||
            !verifyProof(leaf, fresh.round.root) ||
            fresh.wallet?.claimed ||
            fresh.swept ||
            fresh.blockTime < fresh.round.unlocksAt)
        )
          throw Error(
            "Allocation is unavailable, locked, swept or already claimed. Refresh.",
          );
        if (
          kind === "attest" &&
          (!fresh.certified || !fresh.wallet?.claimed || fresh.wallet.attested)
        )
          throw Error(
            "Claim first; the certified allocation can be attested only once.",
          );
        if (
          (kind === "sync" || kind === "payer") &&
          (!fresh.activated ||
            !fresh.wallet ||
            (kind === "sync"
              ? fresh.wallet.pendingReward
              : fresh.wallet.pendingPayer) === 0n)
        )
          throw Error(
            "No eligible unsynced credit. Refresh after activation or attestation.",
          );
      },
      onSuccess: refresh,
    });
  }
  return (
    <section className="section" id="rights">
      <div className="section-heading">
        <div>
          <h2>My Unlock</h2>
          <p>Tokens and selling credits are separate.</p>
        </div>
        {!wallet.address && (
          <button className="button" onClick={wallet.open}>
            Connect to view rights
          </button>
        )}
      </div>
      <div className="rights-grid">
        <div>
          <div className="big-stat">
            <span>Sellable now</span>
            <strong>
              {personal ? fmt(personal.sellable, 4) : "Connect wallet"}
              <small>{personal ? " UNLK" : ""}</small>
            </strong>
          </div>
          <Ledger
            rows={[
              ["UNLK balance", fmt(personal?.balance)],
              ["Eligible acquisitions (E)", fmt(personal?.E)],
              ["Mature eligible credits", fmt(personal?.matureE)],
              ["One-block pending buys", fmt(personal?.immatureE)],
              [
                "Latest buy credit block",
                personal?.buyBlock.toString() ?? "Unavailable",
              ],
              ["Cumulative sold (S)", fmt(personal?.S)],
              [
                "Remaining quota",
                snapshot?.fullyUnlocked
                  ? "Global bypass"
                  : fmt(personal?.quota),
              ],
              [
                "Current tier",
                snapshot
                  ? `${snapshot.tier}/16 · ${snapshot.p / 100}%`
                  : "Unavailable",
              ],
            ]}
          />
        </div>
        <div className="claim-panel">
          <h3>Native claims & credit sync</h3>
          <p>
            Claim tokens, attest the claim, then sync its selling credit. Each
            is a separate transaction. Native claims remain available before
            trading starts.
          </p>
          <Ledger
            rows={[
              [
                "Round 0 allocation",
                leaf
                  ? `${fmt(BigInt(leaf.amount))} UNLK`
                  : wallet.address
                    ? "No local allocation found"
                    : "Connect wallet",
              ],
              [
                "Claim status",
                personal
                  ? personal.claimed
                    ? "Claimed"
                    : snapshot?.swept
                      ? "Round swept"
                      : unlocked
                        ? "Claim window open"
                        : `Unlocks ${new Date(Number(snapshot?.round.unlocksAt) * 1000).toLocaleString()}`
                  : "Unavailable",
              ],
              [
                "Evidence certification",
                snapshot
                  ? snapshot.certified
                    ? "Round 0 certified"
                    : "Not certified"
                  : "Unavailable",
              ],
              [
                "Attestation",
                personal
                  ? personal.attested
                    ? "Recorded"
                    : "Not recorded"
                  : "Unavailable",
              ],
              [
                "Unsynced reward credit",
                snapshot && !snapshot.activated
                  ? "After activation"
                  : fmt(personal?.pendingReward),
              ],
              ["Unsynced payer credit", fmt(personal?.pendingPayer)],
            ]}
          />
          {snapshot && !snapshot.activated && (
            <p className="small muted">
              Credit sync becomes available after activation. Claiming and
              attestation are independent.
            </p>
          )}
          <div className="claim-actions">
            <button
              className="button"
              disabled={
                !enabled ||
                !leaf ||
                !!personal?.claimed ||
                !unlocked ||
                !!snapshot?.swept
              }
              onClick={() => action("claim")}
            >
              Claim native UNLK
            </button>
            <button
              className="button"
              disabled={
                !enabled ||
                !leaf ||
                !personal?.claimed ||
                personal.attested ||
                !snapshot?.certified
              }
              onClick={() => action("attest")}
            >
              Attest claim
            </button>
            <button
              className="button"
              disabled={
                !enabled || !snapshot?.activated || !personal?.pendingReward
              }
              onClick={() => action("sync")}
            >
              Sync reward credit
            </button>
            <button
              className="button"
              disabled={
                !enabled || !snapshot?.activated || !personal?.pendingPayer
              }
              onClick={() => action("payer")}
            >
              Sync payer credit
            </button>
          </div>
          <details>
            <summary>Import a round 0 proof</summary>
            <p className="small muted">
              JSON: wallet (or account), amount in token wei, proof array. It
              must match your account and the distributor root.
            </p>
            <label className="file-label">
              Choose proof JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => void importProof(e.target.files?.[0])}
              />
            </label>
          </details>
          <p className="error" role="status">
            {proofError}
          </p>
        </div>
      </div>
      <div className="rule-note">
        <strong>Previous sales always count.</strong> 1,000 mature credits allow
        200 sold at 20%. When 30% opens, only 100 more become available.
        Sellable = min(balance, max(0, floor(mature E × rate) − S)). At $50M,
        every holder gets permanent quota bypass, including transfer-only
        recipients.
      </div>
      <p className="small muted">
        Transfers grant no credits. New buy credits mature in the next block.
        Credits and sales belong to the actual Universal Router initiator,
        including a smart account. Shared executors pool their users’ mature
        quota; a recipient can receive tokens without receiving rights.
      </p>
    </section>
  );
}
export function NextRelease() {
  const wallet = useWallet();
  const [snapshot, setSnapshot] = useState<CandidateSnapshot | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0),
    [now, setNow] = useState(Date.now());
  const refresh = () => setVersion((v) => v + 1);
  useEffect(() => {
    let live = true;
    setSnapshot(null);
    setLoading(true);
    setError("");
    let fetching = false;
    const run = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const s = await readMainnetCandidate(null, client, wallet.address);
        if (live) {
          setSnapshot(s);
          setError("");
        }
      } catch (e) {
        if (live) {
          setSnapshot(null);
          setError(errorMessage(e));
        }
      } finally {
        fetching = false;
        if (live) setLoading(false);
      }
    };
    void run();
    const t = setInterval(() => void run(), 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [wallet.address, wallet.network, wallet.receiptVersion, version]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const stale = !snapshot || now - snapshot.readAt > 45000;
  const data = stale ? null : snapshot;
  return (
    <>
      <div className="network-line">
        <span>
          <i aria-hidden="true" />
          Ethereum mainnet · Real assets
        </span>
        <span role="status">
          {loading
            ? "Verifying contracts…"
            : stale
              ? "Live data unavailable"
              : snapshot.activated
                ? "Trading active"
                : "Trading not yet activated"}
        </span>
      </div>
      <div className="terminal-intro">
        <div>
          <h1>
            UNLK <span className="muted">/ IMD</span>
          </h1>
          <span className="tag">Launch 2071</span>
        </div>
        <p>Fixed 1B supply · Permanent unlocks</p>
      </div>
      <dl className="terminal-metrics">
        <div>
          <dt>Price / FDV</dt>
          <dd>
            {data?.fdv != null
              ? `$${fmt(data.fdv / 1000000000n, 10)}`
              : "Awaiting oracle"}
          </dd>
          <dd className="metric-note">
            {data?.fdv != null
              ? `${usd(data.fdv)} FDV`
              : data && !data.activated
                ? "After activation"
                : "USD unavailable"}
          </dd>
        </div>
        <div>
          <dt>Confirmed allowance</dt>
          <dd className="accent">{data ? `${data.p / 100}%` : "Unverified"}</dd>
          <dd className="metric-note">
            {data ? `Onchain · ${data.tier}/16 gates` : "Reading mainnet"}
          </dd>
        </div>
        <div>
          <dt>Next milestone</dt>
          <dd className="warning">
            {data
              ? data.fullyUnlocked
                ? "All gates open"
                : money(NEXT_THRESHOLDS[data.tier])
              : "Unverified"}
          </dd>
          <dd className="metric-note">
            {data
              ? data.fullyUnlocked
                ? "Permanent global bypass"
                : `${NEXT_RATES[data.tier + 1] / 100}% cumulative`
              : "Awaiting chain state"}
          </dd>
        </div>
        <div>
          <dt>Oracle status</dt>
          <dd>
            {data
              ? data.fdv !== null
                ? "Valid observation"
                : data.activated
                  ? "Unavailable"
                  : "Awaiting activation"
              : "Checking…"}
          </dd>
          <dd className="metric-note">
            {data?.fdv != null
              ? "Spot estimate · not earned rights"
              : "FDV unavailable ≠ zero"}
          </dd>
        </div>
      </dl>
      <div className="workspace">
        <MarketTerminal snapshot={data} />
        <Swap snapshot={data} refresh={refresh} />
      </div>
      <div className="read-status">
        <span>
          {snapshot
            ? `Verified at block ${snapshot.block} · ${Math.max(0, Math.floor((now - snapshot.readAt) / 1000))}s ago`
            : error
              ? `Mainnet reads failed: ${error}`
              : "Checking code, PoolKey and companion bindings…"}
        </span>
        <button className="text-button" disabled={loading} onClick={refresh}>
          Refresh data
        </button>
      </div>
      {data?.oracleError && (
        <p className="oracle-notice inline-status" role="status">
          {data.oracleError}
        </p>
      )}
      <Rights snapshot={stale ? null : snapshot} refresh={refresh} />
      <section className="section" id="treasury">
        <div className="section-heading">
          <div>
            <h2>IMD treasury & NFTs</h2>
            <p>Collected in IMD. Intended for manual IMD NFT purchases.</p>
          </div>
          <External address={VAULT}>Treasury vault</External>
        </div>
        <div className="treasury-grid">
          <div>
            <Ledger
              rows={[
                ["Accrued treasury fees", `${fmt(data?.vault.accrued)} IMD`],
                [
                  "Unredeemed fee claims",
                  `${fmt(data?.vault.pendingClaims)} IMD`,
                ],
                [
                  "Actual PoolManager IMD claims",
                  `${fmt(data?.vault.actualClaims)} IMD`,
                ],
                [
                  "Donated PoolManager claims",
                  `${fmt(data?.vault.donatedClaims)} IMD`,
                ],
                ["Redeemed to vault", `${fmt(data?.vault.redeemed)} IMD`],
                ["Withdrawn fees", `${fmt(data?.vault.withdrawn)} IMD`],
                [
                  "Claimable redeemed fees",
                  `${fmt(data?.vault.claimable)} IMD`,
                ],
                [
                  "Vault IMD actually held",
                  `${fmt(data?.vault.imdBalance)} IMD`,
                ],
                [
                  "Vault donations (separate)",
                  `${fmt(data?.vault.donations)} IMD`,
                ],
                [
                  "Vault UNLK (not revenue)",
                  `${fmt(data?.vault.unlkBalance)} UNLK`,
                ],
                ["Custody wallet IMD", `${fmt(data?.vault.custodyImd)} IMD`],
                ["Custody wallet UNLK", `${fmt(data?.vault.custodyUnlk)} UNLK`],
              ]}
            />
          </div>
          <div className="treasury-copy">
            <h3>From fees to a collection</h3>
            <p>
              The pool charges 1.25% on input. A separate 0.75% treasury
              component is based on the IMD that actually crosses the pool.
              Protocol fees can increase the effective pool charge.
            </p>
            <p>
              These components use different bases. With no protocol fee or
              impact, their combined effective cost is approximately 1.9851% on
              buys and 1.990625% on sells, before rounding. Quotes include the
              hook fee; receipts report the actual executed IMD leg.
            </p>
            <p>
              Accrued fees = pending PoolManager claims + redeemed fees.
              Redeemed fees = withdrawn + claimable. Do not add accrued fees to
              those parts again. Actual vault IMD includes claimable fees and
              donations; custody holdings are a separate balance.
            </p>
            <p>
              Only the beneficiary can withdraw fees to itself. NFT purchases
              are manual. Holdings do not prove fee-funded purchases; no
              automatic purchases or returns are promised.
            </p>
            <External address={NFT_BENEFICIARY}>
              Beneficiary & NFT custody
            </External>
          </div>
        </div>
        <NftGallery />
      </section>
      <section className="section" id="how">
        <div className="section-heading">
          <div>
            <h2>How it works / Whitepaper</h2>
            <p>Read the rules before trading.</p>
          </div>
        </div>
        <div className="explain-grid">
          <article>
            <h3>Fixed supply, cumulative rights</h3>
            <p>
              1 billion UNLK were minted once: 87% to the pool, 10% to native
              allocations and 3% to the payer, subject to seed rounding. No new
              minting, counter resets or transfer-created rights. Initially, 20%
              of mature eligible credits may be sold, less every previous sale.
              With 1,000 credits and 200 already sold at 20%, a rise to 30%
              permits 100 more. At $50M, every holder can sell their balance.
            </p>
          </article>
          <article>
            <h3>Price and fees</h3>
            <p>
              USD FDV is official UNLK/IMD spot × IMD/ETH spot × validated
              Chainlink ETH/USD × the fixed supply. It is not circulating market
              cap. The pool fee is 1.25%, plus a separate 0.75% IMD treasury
              component on the executed IMD leg. At zero protocol fee and
              without impact, effective buy/sell costs are about 1.9851% /
              1.990625%, before rounding. The quote shows current directional
              fees.
            </p>
          </article>
          <article>
            <h3>Acquire, then mature</h3>
            <p>
              Official-pool buys credit the account executing the router call.
              New buy credits wait one block. Native allocations require a
              claim, certified attestation and separate credit sync. Transfers
              carry tokens only.
            </p>
          </article>
          <article>
            <h3>One touch is permanent</h3>
            <p>
              A valid spot touch observed by a successful swap or checkpoint
              instantly opens the highest crossed gate. Existing gates stay open
              when price falls or a reference fails. A sale must fit the quota
              open before its own post-swap milestone observation.
            </p>
          </article>
          <article>
            <h3>Understand the risks</h3>
            <p>
              Manipulating either pool, including the external IMD/ETH reference
              within one transaction, can permanently open gates early. Shared
              executors pool mature rights across users. The design provides no
              manipulation resistance, price guarantee or return.
            </p>
          </article>
          <article>
            <h3>NFT treasury</h3>
            <p>
              The IMD treasury component is intended for manual purchases from
              the official IMD NFT collection. Verified custody holdings do not
              prove they were bought with fees. There are no automated
              purchases, burns or guaranteed returns.
            </p>
            <p>
              PublicNode and dRPC provide free RPC reads with rate limits and no
              uptime guarantee. State refreshes every 15 seconds; quotes expire
              after 30 seconds or three blocks. A failed or stale feed is
              unavailable, never a zero price.
            </p>
          </article>
        </div>
        <details>
          <summary>Execution, fees and recovery</summary>
          <p>
            Only the pinned Ethereum Universal Router and Quoter are used, with
            the exact sorted PoolKey, empty hookData and ERC20 settlement.
            Approve the input token to Permit2, then authorize the router for
            the exact amount with a 30-minute expiry. A quote is a price
            simulation and bypasses quota; the exact router call is simulated
            from your execution account at review and before signing. The
            default recipient is that same account. ETH pays gas only; swap
            msg.value is zero.
          </p>
          <p>
            Each write opens a review and your wallet’s confirmation. Rejection
            or revert never triggers a resend. Receipts are tracked for two
            confirmations; a replacement is tracked separately and a timeout
            keeps the pending hash for manual checking. Refresh and review a new
            quote after approvals. Fees continue after the $50M bypass.
          </p>
        </details>
      </section>
      <section className="section" id="contracts">
        <div className="section-heading">
          <div>
            <h2>Verified mainnet contracts</h2>
            <p>Launch 2071 · chain ID 1 · pinned source 40d70b7b</p>
          </div>
          <a
            href="https://explorer.imd.fun/token/0x99fa82b022be4575891a43b757bc770691e18fda"
            target="_blank"
            rel="noreferrer"
          >
            UNLK in IMD Explorer ↗
          </a>
        </div>
        <div className="contract-list">
          {Object.entries({
            UNLK: TOKEN,
            "IMD quote token": IMD,
            Hook: HOOK,
            "Native distributor": DISTRIBUTOR,
            "Claim evidence": EVIDENCE,
            Oracle: ORACLE,
            "IMD treasury vault": VAULT,
            "Launch factory": FACTORY,
            "Launch registry": REGISTRY,
            PoolManager: POOL_MANAGER,
            "Universal Router": UNIVERSAL_ROUTER,
            Quoter: QUOTER,
            Permit2: PERMIT2,
            "Custody wallet": NFT_BENEFICIARY,
          }).map(([name, address]) => (
            <div key={name}>
              <span>{name}</span>
              <External address={address}>
                <code>{address}</code>
              </External>
            </div>
          ))}
        </div>
        <p className="small muted">
          Pool ID <code className="address">{POOL_ID}</code>
        </p>
        <p className="small muted">
          PoolKey: UNLK, IMD (sorted by address), fee 12500, tick spacing 60,
          this hook. Source and ABI validation are recorded in the delivery
          documentation. No activation, deployment or balance migration is
          performed by this site.
        </p>
      </section>
    </>
  );
}
