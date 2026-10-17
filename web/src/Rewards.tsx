import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { useWallet, errorMessage } from "./wallet";
import { useData } from "./data";
import { abi, addresses as a, LAUNCH_API } from "./config";
import { b, read } from "./live";
import { verifyProof, prepareTree, type ClaimTree, type Leaf } from "./rewards.ts";
import { Amount, Notice } from "./components";
import { exact, date } from "./math";
interface RoundState {
  account?: string;
  round: bigint;
  block: bigint;
  root: Hex;
  funded: bigint;
  claimedAmount: bigint;
  unlocksAt: bigint;
  claimed: boolean;
  swept: boolean;
  certified: boolean;
  attested: boolean;
  openedAt: bigint;
  sweepDelay: bigint;
  session: [bigint, bigint, bigint] | null;
}
let initialProof: Promise<{ data: ClaimTree; source: string }> | null = null;
function loadInitialProof() {
  if (!initialProof)
    initialProof = (async () => {
      try {
        const response = await fetch(`${LAUNCH_API}?claims=1`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw Error("Proof service unavailable");
        const json = await response.json();
        if (!json.claims?.root || !Array.isArray(json.claims.leaves))
          throw Error("Invalid proof response");
        return {
          data: json.claims as ClaimTree,
          source: "IMD public proof service",
        };
      } catch {
        const response = await fetch("./evidence/round-0.json");
        if (!response.ok)
          throw Error(
            "Proof service and bundled proofs are unavailable. Import an authentic proof file.",
          );
        return {
          data: (await response.json()) as ClaimTree,
          source:
            "Bundled IMD round-0 proofs, verified against the current native root",
        };
      }
    })().catch((e) => {
      initialProof = null;
      throw e;
    });
  return initialProof;
}
export function Rewards() {
  const d = useData();
  const w = useWallet();
  const [roundText, setRoundText] = useState("0");
  const [tree, setTree] = useState<ClaimTree | null>(null);
  const [origin, setOrigin] = useState("");
  const [state, setState] = useState<RoundState | null>(null);
  const [leaf, setLeaf] = useState<Leaf | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState<ClaimTree | null>(null);
  const round = /^(0|[1-9]\d*)$/.test(roundText) ? BigInt(roundText) : null;
  useEffect(() => {
    setTree(null);
    setLeaf(null);
    setState(null);
    setOrigin("");
  }, [roundText, w.address, custom]);
  useEffect(() => {
    let alive = true;
    setError("");
    if (round === null || !d.snapshot) return;
    setLoading(true);
    (async () => {
      const block = d.snapshot!.block;
      const [r, swept, certified, openedAt, sweepDelay] = await Promise.all([
        read<{ root: Hex; funded: bigint; claimed: bigint; unlocksAt: bigint }>(
          a.distributor,
          abi.distributor,
          "roundOf",
          [round],
          block,
        ),
        read<boolean>(a.distributor, abi.distributor, "swept", [round], block),
        read<boolean>(b.rewards, abi.evidence, "certified", [round], block),
        read<bigint>(
          a.distributor,
          abi.distributor,
          "openedAt",
          [round],
          block,
        ),
        read<bigint>(a.distributor, abi.distributor, "sweepDelay", [], block),
      ]);
      const [claimed, attested, session] = w.address
        ? await Promise.all([
            read<boolean>(
              a.distributor,
              abi.distributor,
              "claimed",
              [round, w.address],
              block,
            ),
            read<boolean>(
              b.rewards,
              abi.evidence,
              "attested",
              [round, w.address],
              block,
            ),
            read<Hex>(
              b.rewards,
              abi.evidence,
              "sessionOf",
              [w.address, round],
              block,
            ).then((id) =>
              read<[bigint, bigint, bigint]>(
                b.rewards,
                abi.evidence,
                "sessions",
                [id],
                block,
              ),
            ),
          ])
        : [false, false, null];
      if (!alive) return;
      setState({
        account: w.address,
        round,
        block,
        root: r.root,
        funded: r.funded,
        claimedAmount: r.claimed,
        unlocksAt: r.unlocksAt,
        claimed,
        swept,
        certified,
        attested,
        openedAt,
        sweepDelay,
        session,
      });
      let data: ClaimTree | null = custom;
      let source = "Imported proof file";
      if (!data && round === 0n) {
        const loaded = await loadInitialProof();
        data = loaded.data;
        source = loaded.source;
      }
      if (!alive) return;
      if (!data) {
        setOrigin("A proof file is required for this round.");
        return;
      }
      if (data.root.toLowerCase() !== r.root.toLowerCase())
        throw Error(
          "This proof tree does not match the selected native round. Import the correct complete tree.",
        );
      const own =
        data.leaves.find(
          (l) => l.wallet.toLowerCase() === w.address?.toLowerCase(),
        ) ?? null;
      if (own && !verifyProof(own, r.root))
        throw Error(
          "The wallet’s Merkle proof does not match the native root.",
        );
      if (own && BigInt(own.amount) > r.funded)
        throw Error("Proof amount exceeds round funding.");
      setTree(data);
      setLeaf(own);
      setOrigin(source);
    })()
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [roundText, w.address, w.receiptVersion, d.snapshot?.block, custom]);
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024)
        throw Error("Use a JSON proof file smaller than 8 MiB.");
      const json = JSON.parse(await file.text());
      const t = json.claims ?? json;
      if (!Array.isArray(t.leaves) || !t.root)
        throw Error("Expected {root, leaves: [{wallet, amount, proof}]}.");
      setCustom(t);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const ready =
    !!w.address &&
    w.network === 11155111 &&
    !w.busy &&
    !d.error &&
    state !== null &&
    round !== null &&
    state.account === w.address &&
    state.round === round &&
    !loading;
  const released =
    state && d.snapshot && d.snapshot.timestamp >= state.unlocksAt;
  async function nativeClaim() {
    if (!leaf || !state || round === null) return;
    await w.review({
      title: "Claim native reward",
      description:
        "Claim the verified entitlement from the native IMD distributor. Tokens go to the address in the proof. This does not yet credit your sell allowance.",
      address: a.distributor,
      abi: abi.distributor,
      functionName: "claim",
      args: [round, leaf.wallet, BigInt(leaf.amount), leaf.proof],
      details: [
        ["Round", round.toString()],
        ["Entitlement", `${exact(BigInt(leaf.amount))} UNLK`],
        ["Recipient", leaf.wallet],
      ],
      validate: async () => {
        if (!verifyProof(leaf, state.root))
          throw Error("Proof no longer verifies.");
      },
      onSuccess: d.refresh,
    });
  }
  async function attest() {
    if (!leaf || round === null) return;
    await w.review({
      title: "Attest claim evidence",
      description:
        "Prove an already completed native claim to the immutable evidence contract. This is a separate transaction; each wallet’s round can be attested only once.",
      address: b.rewards,
      abi: abi.evidence,
      functionName: "attest",
      args: [round, leaf.wallet, BigInt(leaf.amount), leaf.proof],
      details: [
        ["Round", round.toString()],
        ["Proven amount", `${exact(BigInt(leaf.amount))} UNLK`],
      ],
      onSuccess: d.refresh,
    });
  }
  async function certify() {
    if (!tree || !state || round === null) return;
    try {
      const full = prepareTree(tree);
      if (full.root.toLowerCase() !== state.root.toLowerCase())
        throw Error("Root mismatch");
      if (full.accounts.length <= 1024) {
        await w.review({
          title: "Certify complete reward tree",
          description:
            "Reconstruct the native root and prove that every recipient is unique. Certification never claims rewards or changes the native claim process.",
          address: b.rewards,
          abi: abi.evidence,
          functionName: "certifyRound",
          args: [round, full.accounts, full.amounts],
          details: [
            ["Unique recipients", String(full.accounts.length)],
            ["Native root", full.root],
          ],
          onSuccess: d.refresh,
        });
      } else {
        const submitted = Number(state.session?.[1] ?? 0n);
        if (
          state.session?.[0] &&
          state.session[0] !== BigInt(full.accounts.length)
        )
          throw Error(
            "The active certification session has a different leaf count. Abandon that session before restarting.",
          );
        await w.review({
          title: "Submit certification leaves",
          description:
            "Submit the next 128 leaves in the verified complete tree’s heap order. Each chunk is a separate recoverable transaction.",
          address: b.rewards,
          abi: abi.evidence,
          functionName: "submitLeaves",
          args: [
            round,
            BigInt(full.accounts.length),
            full.accounts.slice(submitted, submitted + 128),
            full.amounts.slice(submitted, submitted + 128),
          ],
          details: [
            ["Starting leaf", String(submitted)],
            ["Total leaves", String(full.accounts.length)],
          ],
          onSuccess: d.refresh,
        });
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <section className="rewards-section" id="rewards">
      <div className="section-heading">
        <div>
          <h2>Rewards & acquisition credit</h2>
          <p>
            Receiving tokens and crediting your cumulative acquisitions are
            separate actions.
          </p>
        </div>
        <label className="round-select" htmlFor="reward-round">
          Native round
          <input
            id="reward-round"
            value={roundText}
            inputMode="numeric"
            onChange={(e) => {
              setRoundText(e.target.value);
              setCustom(null);
            }}
          />
        </label>
      </div>
      {state && (
        <div className="reward-summary">
          <div>
            <span>Round entitlement</span>
            <strong>
              {w.address ? (
                <Amount value={leaf ? BigInt(leaf.amount) : tree ? 0n : null} />
              ) : (
                <span>Connect to check</span>
              )}
            </strong>
          </div>
          <div>
            <span>Release time</span>
            <strong>{date(state.unlocksAt)}</strong>
          </div>
          <div>
            <span>Native round</span>
            <strong>
              {state.swept
                ? "Swept / closed"
                : released
                  ? "Released"
                  : "Release pending"}
            </strong>
          </div>
        </div>
      )}
      {state && leaf && (
        <div className="reward-steps">
          <article>
            <span className="step-number">01</span>
            <h3>Claim tokens</h3>
            <p>
              {state.claimed
                ? "Native claim completed. These tokens were delivered independently of quota credit."
                : state.swept
                  ? "This round was swept. Unclaimed entitlements can no longer be claimed."
                  : !released
                    ? "This entitlement is verified, but the native release time has not arrived."
                    : "Claim your verified entitlement into this wallet."}
            </p>
            <button
              className="button"
              disabled={
                !ready ||
                state.claimed ||
                state.swept ||
                !released ||
                BigInt(leaf.amount) > state.funded - state.claimedAmount
              }
              onClick={nativeClaim}
            >
              {state.claimed ? "Already claimed" : "Review native claim"}
            </button>
          </article>
          <article>
            <span className="step-number">02</span>
            <h3>Attest evidence</h3>
            <p>
              {state.attested
                ? "The evidence contract has recorded this round once."
                : !state.certified
                  ? "The complete unique-recipient tree must be certified before evidence can be attested."
                  : "Prove the completed native claim and exact amount to the evidence contract."}
            </p>
            <button
              className="button"
              disabled={
                !ready || !state.claimed || !state.certified || state.attested
              }
              onClick={attest}
            >
              {state.attested ? "Already attested" : "Review attestation"}
            </button>
          </article>
          <article>
            <span className="step-number">03</span>
            <h3>Sync allowance credit</h3>
            <p>
              Pending quota credit: <Amount value={d.wallet?.pendingReward} />.
              Synchronization adds proven acquisitions to E; the current
              percentage still applies.
            </p>
            <button
              className="button"
              disabled={!ready || !d.wallet?.pendingReward}
              onClick={() =>
                w.review({
                  title: "Sync reward credit",
                  description:
                    "Credit this wallet’s proven, attested native rewards to its cumulative eligible acquisitions. Previously synchronized amounts are never credited twice.",
                  address: a.hook,
                  abi: abi.hook,
                  functionName: "syncRewards",
                  args: [w.address!],
                  onSuccess: d.refresh,
                })
              }
            >
              Review credit sync
            </button>
          </article>
        </div>
      )}
      {!leaf && (
        <Notice>
          {loading
            ? "Checking native round and proof…"
            : w.address && tree
              ? "No entitlement for this wallet in the verified tree. Existing attested credit can still be synchronized below."
              : "Connect a wallet to find its entitlement, or inspect the native round publicly."}
        </Notice>
      )}
      {d.wallet && (
        <dl className="details">
          <div>
            <dt>Cumulative attested native claims</dt>
            <dd>
              <Amount value={d.wallet.attestedAmount} />
            </dd>
          </div>
          <div>
            <dt>Already synchronized into E</dt>
            <dd>
              <Amount value={d.wallet.creditedAmount} />
            </dd>
          </div>
          <div>
            <dt>Pending quota credit</dt>
            <dd>
              <Amount value={d.wallet.pendingReward} />
            </dd>
          </div>
        </dl>
      )}
      {d.wallet && !leaf && d.wallet.pendingReward > 0n && (
        <button
          className="button"
          disabled={!ready}
          onClick={() =>
            w.review({
              title: "Sync reward credit",
              description:
                "Synchronize all of this wallet’s pending proven native reward credit.",
              address: a.hook,
              abi: abi.hook,
              functionName: "syncRewards",
              args: [w.address!],
              onSuccess: d.refresh,
            })
          }
        >
          Review credit sync
        </button>
      )}
      <p className="small muted">
        {origin}{" "}
        {state
          ? `· ${state.certified ? "Complete tree certified on chain" : "Tree not yet certified"}`
          : ""}
      </p>
      <details>
        <summary>Proof files and round certification</summary>
        <p>
          Round 0 is fetched from IMD, with a bundled copy as fallback. Every
          wallet proof is checked against the native round’s root and exact
          amount. Other rounds require their authentic proof file. Native claims
          remain independent of certification and synchronization.
        </p>
        <label className="file-input">
          Import authentic proof JSON
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => importFile(e.target.files?.[0])}
          />
        </label>
        <p className="small">
          Format:{" "}
          <code>
            {
              '{"root":"0x…","leaves":[{"wallet":"0x…","amount":"token wei","proof":["0x…"]}]}'
            }
          </code>
          . Certification requires the complete tree, not just a membership
          proof.
        </p>
        {state && !state.certified && (
          <>
            <p>
              The complete tree is reconstructed locally and recipients are
              checked for duplicates. Up to 1,024 leaves use{" "}
              <code>certifyRound</code>; larger trees use recoverable{" "}
              <code>submitLeaves</code> and <code>reduce</code> transactions.
            </p>
            <button
              className="button"
              disabled={
                !ready ||
                !tree ||
                (!!state.session?.[0] && state.session[1] === state.session[0])
              }
              onClick={certify}
            >
              Review{" "}
              {tree && tree.leaves.length > 1024
                ? "next leaf chunk"
                : "complete certification"}
            </button>
            {state.session && state.session[0] > 0n && (
              <>
                <p>
                  Session: {state.session[1].toString()} /{" "}
                  {state.session[0].toString()} leaves;{" "}
                  {state.session[2].toString()} internal nodes reduced.
                </p>
                <button
                  className="button"
                  disabled={!ready || state.session[1] !== state.session[0]}
                  onClick={() =>
                    w.review({
                      title: "Reduce certification tree",
                      description:
                        "Compute up to 256 internal nodes of this wallet’s submitted tree. The final reduction certifies only if the complete root matches.",
                      address: b.rewards,
                      abi: abi.evidence,
                      functionName: "reduce",
                      args: [round!, 256n],
                      onSuccess: d.refresh,
                    })
                  }
                >
                  Review next reduction
                </button>
                <button
                  className="text-button"
                  disabled={!ready}
                  onClick={() =>
                    w.review({
                      title: "Abandon certification session",
                      description:
                        "Discard only this wallet’s current round certification session. This does not affect native claims or another submitter’s session.",
                      address: b.rewards,
                      abi: abi.evidence,
                      functionName: "abandonSession",
                      args: [round!],
                      onSuccess: d.refresh,
                    })
                  }
                >
                  Review session reset
                </button>
              </>
            )}
          </>
        )}
        {state && (
          <p className="small">
            Native root: <code className="address">{state.root}</code>
            <br />
            Round funding: <Amount value={state.funded} />. Already claimed
            across all recipients: <Amount value={state.claimedAmount} />. Sweep
            eligible after{" "}
            {date(
              state.openedAt + state.sweepDelay > state.unlocksAt
                ? state.openedAt + state.sweepDelay
                : state.unlocksAt,
            )}
            .
          </p>
        )}
      </details>
      <p className="error" role="status">
        {error}
      </p>
    </section>
  );
}
