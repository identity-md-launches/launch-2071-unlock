/** Shared fail-closed policy. Used by the browser and the separately operated API. */
export const POLICY = Object.freeze({ minimumLiquidityUsd: 20000, maxAgeMs: 600000, maxBlockLag: 64 });
const addr = v => typeof v === 'string' && /^0x[\da-f]{40}$/i.test(v);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const fresh = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 30000 && now - Date.parse(value) <= POLICY.maxAgeMs;
export function eligibility(m, now = Date.now(), head = null) {
  const reasons = [];
  if (m?.chainId !== 1 || !addr(m?.address) || m?.identity?.verified !== true || !m.identity.sourceUrl?.startsWith('https://')) reasons.push('Token identity has no verified Ethereum deployment evidence.');
  const p = m?.pool;
  if (!p || p.verified !== true || p.dex !== 'uniswap' || !['v2','v3','v4'].includes(p.version) || (p.version === 'v4' ? !/^0x[\da-f]{64}$/i.test(p.id || '') : !addr(p.id))) reasons.push('Uniswap pool identity is unverified. A v4 pool needs its PoolId.');
  const l = m?.liquidityCheck;
  if (!l || l.verified !== true || !['v4-position-inventory','v3-position-inventory','v2-reserves'].includes(l.method) || !finite(l.usd) || l.usd < POLICY.minimumLiquidityUsd || !finite(l.activeUsd) || l.activeUsd <= 0 || l.activeUsd > l.usd + 0.000001 || l.complete !== true) reasons.push('Verified current USD liquidity of at least $20,000 and active liquidity are required.');
  if (!l || !fresh(l.checkedAt, now) || !Number.isSafeInteger(l.block) || l.block <= 0 || (head !== null && (head < l.block || head - l.block > POLICY.maxBlockLag))) reasons.push('Liquidity evidence is missing, stale or outside the verified block window.');
  const s = m?.sellCheck;
  if (!s || s.success !== true || s.chainId !== 1 || (!addr(s.account) || BigInt(s.account) === 0n) || !/^[1-9]\d*$/.test(s.amountRaw || '') || !finite(s.amountUsd) || s.amountUsd <= 0 || s.token?.toLowerCase() !== m?.address?.toLowerCase() || s.poolId?.toLowerCase() !== p?.id?.toLowerCase() || s.method !== 'router-eth_call' || s.stateOverrides !== false || !/^0x[\da-f]{64}$/i.test(s.callHash||'')) reasons.push('A representative account and size need a successful full-route sell simulation without state overrides.');
  if (!s || !fresh(s.checkedAt, now) || !Number.isSafeInteger(s.block) || s.block <= 0 || (head !== null && (head < s.block || head - s.block > POLICY.maxBlockLag)) || (l && Math.abs(s.block - l.block) > 2)) reasons.push('Sell simulation is missing, stale or does not match the liquidity check block.');
  return { eligible: reasons.length === 0, reasons, checkedAt: s?.checkedAt || l?.checkedAt || null, block: s?.block || l?.block || null };
}
export function admittedMarkets(data, now = Date.now()) {
  if(data?.eligibilityUnknown===true || data?.stale===true)return [];
  const rows = [...(data?.markets || []), ...(data?.featured ? [data.featured] : [])];
  return [...new Map(rows.filter(m => eligibility(m, now, data?.block ?? null).eligible).map(m => [m.address.toLowerCase(), m])).values()];
}
export function compareNullable(a, b, direction = 'desc') {
  const empty = v => v === null || v === undefined || !Number.isFinite(v);
  if (empty(a)) return empty(b) ? 0 : 1;
  if (empty(b)) return -1;
  return direction === 'asc' ? a - b : b - a;
}
export function validCandles(rows, field = 'usd') {
  return (Array.isArray(rows) ? rows : []).filter(c => Number.isSafeInteger(c.time) && c.time > 0 && c.complete !== false && c[field] && ['open','high','low','close','volume'].every(k => finite(c[field][k]) && c[field][k] >= 0) && c[field].low <= Math.min(c[field].open,c[field].close) && c[field].high >= Math.max(c[field].open,c[field].close)).sort((a,b)=>a.time-b.time).filter((c,i,a)=>!i || c.time !== a[i-1].time);
}
/** FIFO over evidenced swaps. A transfer-in has unknown cost, never zero cost. */
export function traderPnl(events, balance, markUsd, completeHistory = false) {
  const lots = []; let realized = 0, knownSold = 0, unknownSold = 0, proceeds = 0, unsupported = !completeHistory;
  for (const e of [...events].sort((a,b)=>a.time-b.time || (a.block??0)-(b.block??0) || (a.transactionIndex??0)-(b.transactionIndex??0) || (a.logIndex??0)-(b.logIndex??0) || String(a.id).localeCompare(String(b.id)))) {
    const n = Number(e.amount); if (!(n > 0)) continue;
    const valueUsd=e.costBasisSupported===false?null:finite(e.costBasisUsd)?e.costBasisUsd:e.amountUsd;
    if (e.type === 'buy') lots.push({ n, cost: finite(valueUsd) ? valueUsd / n : null });
    else if (e.type === 'transfer' && e.direction === 'in') { lots.push({ n, cost: null }); unsupported = true; }
    else if (e.type === 'sell' || (e.type === 'transfer' && e.direction === 'out')) {
      let left = n; const price = finite(valueUsd) ? valueUsd / n : null;
      while (left > 1e-12 && lots.length) { const lot = lots[0], used = Math.min(left, lot.n); if (e.type === 'sell') { if (lot.cost !== null && price !== null) { realized += used * (price - lot.cost); knownSold += used; proceeds += used * price; } else unknownSold += used; } lot.n -= used; left -= used; if (lot.n < 1e-12) lots.shift(); }
      if (left > 1e-12) { unsupported = true; if (e.type === 'sell') unknownSold += left; }
    }
  }
  const known = lots.filter(l=>l.cost !== null), knownAmount = known.reduce((s,l)=>s+l.n,0), total = lots.reduce((s,l)=>s+l.n,0);
  const reconciled = finite(balance) && Math.abs(total - balance) <= Math.max(1e-9, balance * 1e-8);
  const partial = unsupported || unknownSold > 0 || knownAmount < total || !reconciled;
  return { status: partial ? 'partial' : 'supported', realized: completeHistory && knownSold > 0 ? realized : null, unrealized: completeHistory && reconciled && finite(markUsd) && knownAmount > 0 ? known.reduce((s,l)=>s+l.n*(markUsd-l.cost),0) : null, knownSold, unknownSold, knownAmount, proceeds, note: partial ? 'Partial coverage or missing cost basis. P&L is unavailable without complete opening inventory; fees may be incomplete.' : 'FIFO evidenced swaps; network gas excluded.' };
}
export function coincidentFlows(events, watched, windowSeconds = 900) {
  const allowed = new Set(watched.map(a=>a.toLowerCase())), seen = new Set();
  const swaps = events.filter(e=>['buy','sell'].includes(e.type) && addr(e.wallet) && allowed.has(e.wallet.toLowerCase()) && !e.ambiguousRouting).sort((a,b)=>a.time-b.time).filter(e=> { const k=`${e.hash}:${e.wallet.toLowerCase()}:${e.token.toLowerCase()}`; if(seen.has(k))return false;seen.add(k);return true; });
  const groups=[];
  for(let i=0;i<swaps.length;i++) { const a=swaps[i], rows=swaps.slice(i).filter(b=>b.time-a.time<=windowSeconds&&b.token===a.token&&b.type===a.type), wallets=[...new Set(rows.map(e=>e.wallet.toLowerCase()))]; if(wallets.length<2)continue; const key=rows.map(e=>e.id).join('|'); if(groups.some(g=>g.rows.some(e=>e.id===a.id)))continue; groups.push({key,token:a.token,symbol:a.symbol,type:a.type,from:a.time,to:rows.at(-1).time,wallets,rows,label:'Coincident flows; not evidence of coordination'}); }
  return groups;
}
