import { useEffect, useRef, useState } from "react";
import { NFT_BENEFICIARY, NFT_COLLECTION, nftClient, nftAbi } from "./candidate";
import { cursorParams, fetchBounded, metadataImage, MAX_METADATA } from "./nftSafety";

import { verifyInventoryPage, inventoryIsStale, type Holding } from "./nftInventory";
function NftCard({holding}: {holding: Holding}) {
  const [image, setImage] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController(); let objectUrl: string | undefined;
    const timer = setTimeout(() => abort.abort(), 15000);
    setImage(undefined); setError("");
    metadataImage(holding.uri, abort.signal).then(blob => {
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setImage(objectUrl);
    }).catch(() => { if (!abort.signal.aborted) setError("Image unavailable or unsupported"); })
      .finally(() => clearTimeout(timer));
    const onAbort = () => setError("Image request timed out");
    abort.signal.addEventListener("abort", onAbort);
    return () => { abort.signal.removeEventListener("abort", onAbort); abort.abort(); clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [holding.uri]);
  return <article className="nft-card">
    <div className="nft-image">{image && !error ? <img src={image} alt={`IMD #${holding.id}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setError("Image could not be displayed")}/> : <span>{error || "Loading image…"}</span>}</div>
    <a href={`https://etherscan.io/nft/${NFT_COLLECTION}/${holding.id}`} target="_blank" rel="noreferrer">IMD #{holding.id} ↗</a>
    <small>Ownership verified<br/>at block {holding.block.toString()}</small>
  </article>;
}

export function NftGallery() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [cursor, setCursor] = useState<Record<string,string> | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stamp, setStamp] = useState<number>();
  const [balance, setBalance] = useState<bigint>();
  const [now, setNow] = useState(Date.now());
  const rail = useRef<HTMLDivElement>(null);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const cursors = useRef(new Set<string>());
  async function load(reset: boolean) {
    if (loading && !reset) return;
    active.current?.abort(); const abort = new AbortController(); active.current = abort;
    const request = ++generation.current;
    const timer = setTimeout(() => abort.abort(), 25000);
    setLoading(true); setError("");
    if (reset) { setHoldings([]); setStamp(undefined); setBalance(undefined); setHasLoaded(false); cursors.current.clear(); }
    try {
      const params = new URLSearchParams({type:"ERC-721", ...(reset ? {} : cursor ?? {})});
      const inventory = JSON.parse((await fetchBounded(`https://eth.blockscout.com/api/v2/addresses/${NFT_BENEFICIARY}/nft?${params}`, MAX_METADATA * 8, abort.signal)).text);
      if (await nftClient.getChainId() !== 1) throw new Error("Mainnet read service returned a different chain");
      const block = await nftClient.getBlockNumber({cacheTime:0});
      const owned = await verifyInventoryPage(inventory, block,
        id => nftClient.readContract({address:NFT_COLLECTION,abi:nftAbi,functionName:"ownerOf",args:[id],blockNumber:block}),
        id => nftClient.readContract({address:NFT_COLLECTION,abi:nftAbi,functionName:"tokenURI",args:[id],blockNumber:block}),
        abort.signal);
      const total = await nftClient.readContract({address:NFT_COLLECTION,abi:nftAbi,functionName:"balanceOf",args:[NFT_BENEFICIARY],blockNumber:block});
      if (request !== generation.current || abort.signal.aborted) return;
      const next = cursorParams(inventory.next_page_params);
      if (next) {
        const encoded = JSON.stringify(next);
        if (cursors.current.has(encoded)) throw new Error("Indexer repeated its cursor; refresh to retry");
        cursors.current.add(encoded);
      }
      if (request !== generation.current || abort.signal.aborted) return;
      setHoldings(previous => [...new Map([...(reset ? [] : previous),...owned].map(row => [row.id,row])).values()]);
      setCursor(next); setBalance(total); setStamp(Date.now()); setHasLoaded(true);
    } catch (e) {
      if (request === generation.current) setError(abort.signal.aborted ? "Inventory request timed out. Retry when the read services recover." : e instanceof Error ? e.message : "Inventory unavailable");
    } finally { clearTimeout(timer); if (request === generation.current) setLoading(false); }
  }
  useEffect(() => { void load(true); const timer=setInterval(()=>setNow(Date.now()),30000); return () => { ++generation.current; active.current?.abort(); clearInterval(timer); }; }, []);
  function scroll(direction: number) { rail.current?.scrollBy({left: direction * Math.max(180, rail.current.clientWidth * .8), behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"}); }
  const stale = inventoryIsStale(holdings, now) || (stamp !== undefined && now - stamp > 60000);
  return <section className="panel nft-gallery" aria-labelledby="nft-title">
    <div className="panel-heading"><h2 id="nft-title">Treasury’s IMD collection</h2><span className="small muted">Ethereum mainnet · read only</span></div>
    <p>Current holdings of <a href={`https://etherscan.io/address/${NFT_BENEFICIARY}`} target="_blank" rel="noreferrer">the fixed beneficiary ↗</a>. Holdings do not prove fee-funded purchases. NFT buying is manual after withdrawal.</p>
    <div className="nft-toolbar"><span aria-live="polite">{loading ? "Loading and verifying ownership…" : stamp ? `${holdings.length} verified here / ${balance?.toString() ?? "?"} held · read ${new Date(stamp).toLocaleTimeString()}` : "Ownership data unavailable"}</span><button className="button secondary" onClick={()=>void load(true)} disabled={loading}>Refresh ownership</button></div>
    {stale && <p role="status" className="notice">Stale snapshot. Ownership may have changed; refresh before relying on it.</p>}
    {error && <p role="alert" className="notice error">{error} Previous cards, if shown, retain their original verification block.</p>}
    <div className="nft-rail" ref={rail} tabIndex={0} role="region" aria-label="Verified NFT cards. Swipe or use arrow keys."
      onKeyDown={e=>{if(e.key==="ArrowRight"||e.key==="ArrowLeft"){e.preventDefault();scroll(e.key==="ArrowRight"?1:-1);}}}>
      {holdings.map(holding=><NftCard key={`${holding.id}-${holding.block}`} holding={holding}/>)}
      {hasLoaded && holdings.length===0 && !loading && <p>No verified IMD tokens on the loaded page.{cursor ? " More inventory pages are available." : ""}</p>}
    </div>
    <div className="nft-controls"><button className="button secondary" aria-label="Previous NFT cards" onClick={()=>scroll(-1)}>←</button><span className="small muted">Swipe · arrow keys</span><button className="button secondary" aria-label="Next NFT cards" onClick={()=>scroll(1)}>→</button>{cursor && <button className="button secondary" disabled={loading} onClick={()=>void load(false)}>Load next inventory page</button>}</div>
    <p className="small muted">Discovery: paginated Blockscout inventory. Verification: ownerOf and tokenURI at the displayed Ethereum block. Indexing may lag; the balance count can exceed the loaded cards. No mainnet transaction or signature is requested.</p>
  </section>;
}
