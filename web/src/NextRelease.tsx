import { useEffect, useState } from "react";
import { formatEther, parseEther } from "viem";
import { CANDIDATE_DEPLOYMENT, NEXT_THRESHOLDS, NEXT_RATES, NFT_BENEFICIARY, UNIVERSAL_ROUTER, successorFee, type SwapMode } from "./mainnet";
import { mainnetClient as client } from "./mainnet";
import { useWallet } from "./wallet";
import { readMainnetCandidate, type CandidateSnapshot } from "./mainnetReader";
import { NftGallery } from "./NftGallery";
import { readSpot, IMD_ETH_POOL_ID, ETH_USD_FEED, type SpotSnapshot } from "./spotPrice";

export function NextRelease() {
  const wallet = useWallet();
  const [snapshot,setSnapshot]=useState<CandidateSnapshot | null>(null);
  const [readError,setReadError]=useState("");
  useEffect(()=>{
    setSnapshot(null);setReadError("");
    if(!CANDIDATE_DEPLOYMENT)return;
    let active=true;
    const refresh=()=>readMainnetCandidate(CANDIDATE_DEPLOYMENT,client,wallet.address).then(value=>{if(active)setSnapshot(value);}).catch(e=>{if(active){setSnapshot(null);setReadError(e instanceof Error?e.message:"Candidate read failed");}});
    void refresh();const timer=setInterval(refresh,30000);
    return()=>{active=false;clearInterval(timer);};
  },[wallet.address,wallet.receiptVersion]);
  const [spot,setSpot]=useState<SpotSnapshot | null>(null);
  const [spotError,setSpotError]=useState("");
  useEffect(()=>{
    let active=true;
    const refresh=()=>readSpot(client,CANDIDATE_DEPLOYMENT).then(value=>{if(active){setSpot(value);setSpotError("");}}).catch(e=>{if(active){setSpot(null);setSpotError(e instanceof Error?e.message:"Spot read failed");}});
    void refresh();const timer=setInterval(refresh,30000);
    return()=>{active=false;clearInterval(timer);};
  },[]);
  const usd=(value:bigint|null|undefined,digits=6)=>typeof value==="bigint"?`$${Number(formatEther(value)).toLocaleString("en-US",{maximumSignificantDigits:digits})}`:"Unavailable";
  const personal=snapshot?.wallet?.address.toLowerCase()===wallet.address?.toLowerCase()?snapshot?.wallet:null;
  const [imdAmount, setImdAmount] = useState("1");
  const [mode, setMode] = useState<SwapMode>("buyExactIn");
  const buy = mode.startsWith("buy");
  let summary: {poolLeg:bigint; fee:bigint; trader:bigint} | undefined;
  let error = "";
  try {
    if (!/^\d+(?:\.\d{0,18})?$/.test(imdAmount) || imdAmount.length > 40) throw new Error();
    summary = successorFee(mode, parseEther(imdAmount));
  } catch { error="Enter a non-negative IMD amount with at most 18 decimals."; }
  const modeLabels: Record<SwapMode,string> = {
    buyExactIn:"Buy, exact input · gross IMD paid (IMD Explorer)", buyExactOut:"Buy, exact output · executed pool IMD from quote",
    sellExactIn:"Sell, exact input · executed pool IMD from quote (IMD Explorer)", sellExactOut:"Sell, exact output · net IMD wanted",
  };
  return <div className="next-release">
    <div className="page-intro"><p className="small muted">Source preview · undeployed</p><h1>Next release & NFT treasury</h1><p>The successor candidate trades through the standard Uniswap Universal Router (<a href={`https://etherscan.io/address/${UNIVERSAL_ROUTER}`} target="_blank" rel="noreferrer">pinned mainnet router ↗</a>) with empty hookData, the same route the IMD Explorer uses. It is undeployed, a separate review confirms a High shared-executor quota-pooling finding, and instantaneous manipulation of either the UNLK/IMD or the IMD/ETH pool (even within one transaction) can open gates early and permanently, a risk the requester accepted. Valid official-pool UNLK price spikes are accepted by the one-way gate design. Release is blocked. No candidate swap can be sent from this page.</p></div>
    <div className="notice"><strong>Eligibility follows the initiator.</strong> Shared executors pool quota across their users. This High finding blocks release. The account that calls the Universal Router (an EOA or a smart account, as reported by the router's <code>msgSender()</code>) gets the credit E for every official-pool buy in that transaction, and spends its own quota S for every sell. That holds even when a different wallet receives the tokens (TAKE to another address), when the input was prefunded by someone else, and in batches or multihop routes. A wallet that only receives tokens gets the tokens, not the credit. Transfers never move rights. This does not prove who actually paid or who received the tokens.</div>
    <div className="notice"><strong>Buy-credit maturity and account limits.</strong> Before final unlock, new buy credit E becomes spendable only in the next block. This applies on chain across every UI and standard-router call; it prevents atomic recycling of new credit. Earlier mature quota can still be pooled by shared executors. An optional immutable WalletExecutor accepts only its one wallet, fixes funding and proceeds to that wallet, and has a separate executor E/S ledger. It cannot move or merge direct-wallet rights. A smart account that itself shares authority can still pool rights. This does not resolve the High finding.</div>
    <div className="notice">The Trade, My Unlock and Milestones tabs still show the existing live Sepolia rules: 25% initially, seven rates and no NFT hook fee. New rules require a separately reviewed release.</div>
    <section className="panel spot-price"><div className="panel-heading"><h2>Pool-derived spot price</h2><span className="small muted">Indicative · not a milestone input</span></div>
      {spotError && <p role="alert">Spot price unavailable: {spotError}</p>}
      <dl className="wallet-ledger">
        <div><dt>USD per IMD (spot)</dt><dd>{usd(spot?.usdPerImd)}</dd></div>
        <div><dt>USD per UNLK (spot)</dt><dd>{usd(spot?.usdPerUnlk)}</dd></div>
        <div><dt>Indicative fully diluted value · 1B UNLK × spot</dt><dd>{usd(spot?.fdv,8)}</dd></div>
        <div><dt>IMD/ETH pool tick</dt><dd>{spot?String(spot.imdEth.tick):"Unavailable"}</dd></div>
        <div><dt>Chainlink ETH/USD</dt><dd>{spot?`$${(Number(spot.ethUsd.answer)/1e8).toFixed(2)} · updated ${new Date(Number(spot.ethUsd.updatedAt)*1000).toLocaleTimeString()}`:"Unavailable"}</dd></div>
      </dl>
      {spot && <p className="small muted">Ethereum block {spot.block.toString()} · block time {new Date(Number(spot.blockTime)*1000).toLocaleString()} · refreshed every 30s</p>}
      {spot?.unlkUnavailable && <p className="small">{spot.unlkUnavailable}</p>}
      <p className="small">Sources, read at one block: official UNLK/IMD pool slot0 (after deployment) × IMD/native-ETH Uniswap v4 pool <code>{IMD_ETH_POOL_ID.slice(0,10)}…</code> slot0 in the canonical PoolManager × <a href={`https://etherscan.io/address/${ETH_USD_FEED}`} target="_blank" rel="noreferrer">Chainlink ETH/USD ↗</a> (rejected if older than 90 minutes). No stablecoin peg, website price label or price API is used. Gates use exactly this product of current spot prices. FDV is supply times spot, not a circulating market cap and not extractable cash. No price history or candles are shown because none is recorded.</p>
    </section>
    <section className="panel candidate-vault"><div className="panel-heading"><h2>Candidate fee vault</h2><span className="small muted">Not deployed</span></div>
      {readError && <p role="alert">{readError}</p>}
      <dl className="wallet-ledger">{[
        ["Accrued treasury IMD",snapshot?.vault.accrued],["Redeemed treasury IMD",snapshot?.vault.redeemed],["Withdrawn treasury IMD",snapshot?.vault.withdrawn],
        ["Claimable IMD in vault",snapshot?.vault.claimable],["Unredeemed PoolManager claims",snapshot?.vault.pendingClaims],
        ["IMD donations",snapshot?.vault.donations],["UNLK in vault (never fee revenue)",snapshot?.vault.unlkBalance]
      ].map(([label,value])=><div key={String(label)}><dt>{String(label)}</dt><dd>{typeof value==="bigint"?formatEther(value):"Unavailable"}</dd></div>)}</dl>
      {snapshot && <p className="small muted">Mainnet block {snapshot.block.toString()} · read {new Date(snapshot.readAt).toLocaleTimeString()}</p>}
      <p>These are unavailable readings, not zero balances. Once deployed, accrual, pending claims, redeemed funds and donations are separate amounts. Only <a href={`https://etherscan.io/address/${NFT_BENEFICIARY}`} target="_blank" rel="noreferrer">the beneficiary ↗</a> can withdraw to itself.</p>
      <p>Every treasury fee is charged and held in IMD, in all four swap modes, so there is no UNLK fee balance and no conversion step. The vault separates IMD donations from fee revenue and has no access to pool principal or other tokens.</p>
      <p>No marketplace integration, automatic purchase, buyback, burn, floor-price or yield promise.</p>
    </section>
    <section className="panel"><div className="panel-heading"><h2>Candidate wallet ledger</h2><span className="small muted">Ethereum mainnet · undeployed</span></div>
      <dl className="wallet-ledger">{[["UNLK wallet balance",personal?.balance],["IMD wallet balance",personal?.imdBalance],["IMD approval to Permit2",personal?.imdApproval],["Permit2 IMD allowance to router",personal?.permit2Allowance],["Eligible acquisitions · E",personal?.E],["Mature eligible acquisitions",personal?.matureE],["Buy credit waiting for next block",personal?.immatureE],["Executed sales · S",personal?.S],["Sellable now",personal?.sellable]].map(([label,value])=><div key={String(label)}><dt>{String(label)}</dt><dd>{typeof value==="bigint"?formatEther(value):"Unavailable"}</dd></div>)}</dl>
      <p>Current quota percentage: {snapshot ? `${snapshot.p/100}%` : "Unavailable"}. Permit2 expiry: {personal ? new Date(personal.permit2Expiration*1000).toLocaleString() : "Unavailable"}.</p>
      <p>Verified FDV: {snapshot?.fdv !== null && snapshot?.fdv !== undefined ? `$${formatEther(snapshot.fdv)}` : "Unavailable"}. {snapshot?.oracleError ?? "Candidate chain readings begin only after a reviewed deployment is configured."}</p>
      <p>Existing live wallet balances, claims and sync are available under <a href="#/unlock">My Unlock</a>. Their rights belong to the existing contracts.</p>
    </section>
    <section className="panel candidate-fees"><div className="panel-heading"><h2>Fee calculator</h2><span className="small muted">Illustration, not a swap quote</span></div>
      <div className="nft-toolbar"><label>Mode <select value={mode} onChange={e=>setMode(e.target.value as SwapMode)}>{(Object.keys(modeLabels) as SwapMode[]).map(m=><option key={m} value={m}>{modeLabels[m]}</option>)}</select></label><label>IMD <input inputMode="decimal" value={imdAmount} onChange={e=>setImdAmount(e.target.value)} aria-invalid={!!error}/></label></div>
      {error ? <p role="alert">{error}</p> : summary && <dl className="wallet-ledger"><div><dt>Executed IMD pool leg · fee base</dt><dd>{formatEther(summary.poolLeg)}</dd></div><div><dt>75 bps treasury fee, in IMD</dt><dd>{formatEther(summary.fee)}</dd></div><div><dt>{buy?"Trader pays":"Trader receives"}</dt><dd>{formatEther(summary.trader)}</dd></div></dl>}
      <p>The pool fee stays at 1.25% (1% to the payer, 0.25% to IMD) and is charged on the input token. The extra fee is 0.75% of the IMD that actually crossed the pool, and it continues after full unlock. Exact-output buys and exact-input sells are charged after the swap on the executed leg. Exact-input buys and exact-output sells are charged before the swap, at most 1 wei above floor(0.75%). A swap that would only partly fill, or would leave the seed range, reverts completely and pays nothing. Because the two fees are taken on different bases, the nominal 2% is not the exact effective cost. Quotes from the pinned standard Quoter include the treasury fee. Buy approvals cover gross IMD including that fee; sell approvals cover fee-inclusive UNLK input limits. ERC20 approval to Permit2 and Permit2 authorization to the router are separate. Slippage, expiry, quota, insufficient IMD/UNLK and range-exit errors must be resolved before submitting a future reviewed transaction.</p>
      <p>A generic quote is a simulation, not proof that a wallet can sell. A reviewed transaction must also verify the actual wallet balance, eligible acquisitions E, executed sales S and Q = max(0, floor(mature E × p / 10000) − S), limited by the wallet’s actual token balance. E remains cumulative; ordinary transfers create no credit. With E=1000 and S=200 at 20%, a later 30% gate permits only 100 more tokens, not 30% of the remaining 800. Opening a gate never resets S or credits E. At the final gate, quota checks are bypassed for every holder, including transfer-only recipients with E=0.</p>
    </section>
    <section className="panel"><div className="panel-heading"><h2>Candidate one-way unlock gates</h2><span className="small muted">20% initially</span></div><ol className="candidate-tiers">{NEXT_THRESHOLDS.map((target,index)=><li key={target}><strong>${target.toLocaleString("en-US")}</strong><span>{NEXT_RATES[index+1]/100}%</span><small>{index===15?"Touch once · permanent bypass for everyone":"Touch once · never closes"}</small></li>)}</ol>
      <p>A valid instantaneous official-pool price touching a target opens that door for everyone, permanently. One jump opens every crossed door immediately. Each successful official swap evaluates its executed post-swap price; anyone can also call checkpoint() or updateMilestone() against current state. A short-lived spike can open gates and a valid $50M touch permanently bypasses quota for all holders. Selling immediately afterwards, even if the price falls, is intended. This design does not claim manipulation resistance.</p>
      <p>A sale must fit the gate already open before its own post-swap update. An earlier successful buy or checkpoint can open a gate for a later sale in the same transaction, while new buy credit still waits until the next block before final unlock. Reverted transactions leave no new gates, credits or sales. Price declines never reduce rights. The contract cannot discover historical touches it never observed.</p>
      <p>Gate FDV = fixed 1 billion supply × official UNLK/IMD spot × valid IMD/USD reference. There is no UNLK TWAP, sustained price test, confirmation duration, sequential wait or final delay. IMD/USD is the current IMD/ETH v4 pool spot times a fresh Chainlink ETH/USD round (at most 90 minutes old). There is no sampling, warm-up, history, clamp or keeper, and NO manipulation resistance: a same-transaction move of either pool can open gates early and permanently, including the $50M bypass. An outage prevents new gate advancement only: existing rights, within-quota trading, transfers and native claims remain available. Other pools remain outside this hook’s quota.</p>
    </section>
    <NftGallery/>
  </div>;
}
