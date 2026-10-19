import { useEffect, useMemo, useRef, useState } from "react";
import { validCandles } from "./domain.mjs";
import { dateLabel, usd } from "./data";
export type Candle = { time: number; complete?: boolean; usd: OHLC | null; quote: OHLC | null };
type OHLC = { open: number; high: number; low: number; close: number; volume: number };
export function Candles({ candles, currency, quoteSymbol }: { candles: Candle[]; currency: "usd"|"quote"; quoteSymbol: string }) {
  const figure=useRef<HTMLElement>(null),[width,setWidth]=useState(1000);
  useEffect(()=>{if(!figure.current)return;const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width));observer.observe(figure.current);return()=>observer.disconnect();},[]);
  const [count,setCount]=useState(80),[offset,setOffset]=useState(0),[cross,setCross]=useState<number|null>(null);
  const all=useMemo(()=>validCandles(candles,currency),[candles,currency]);
  useEffect(()=>{setOffset(0);setCross(null);},[all]);
  const visibleOffset=Math.min(offset,Math.max(0,all.length-10));
  const end=all.length-visibleOffset, rows=all.slice(Math.max(0,end-count),end);
  const W=Math.max(300,Math.min(1200,Math.round(width))),H=W<600?360:400,left=14,right=100,top=24,bottom=70,plotH=H-top-bottom,plotW=W-left-right;
  const lows=rows.map(c=>c[currency]!.low), highs=rows.map(c=>c[currency]!.high), min=Math.min(...lows), max=Math.max(...highs), spread=(max-min)||max*.02||1;
  const low=min-spread*.06, high=max+spread*.06, y=(v:number)=>top+(high-v)/(high-low)*plotH, x=(i:number)=>rows.length===1?left+plotW/2:left+8+(rows[i].time-rows[0].time)/(rows.at(-1)!.time-rows[0].time)*(plotW-16);
  const maxVolume=Math.max(...rows.map(c=>c[currency]!.volume),1), selected=rows[Math.min(rows.length-1,Math.max(0,cross??rows.length-1))], data=selected?.[currency];
  const axisTime=(t:number)=>W<600?new Date(t*1000).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"UTC"}):dateLabel(t);
  const price=(n:number)=>currency==="usd"?usd(n):`${n.toLocaleString("en-US",{maximumSignificantDigits:7})} ${quoteSymbol}`;
  const pan=(d:number)=>{setOffset(v=>Math.max(0,Math.min(Math.max(0,all.length-10),v+d)));setCross(null);};
  const zoom=(d:number)=>{setCount(v=>Math.max(10,Math.min(300,v+d)));setCross(null);};
  return <figure ref={figure} className="candle-figure"><div className="chart-readout" aria-live="off">{selected&&data?<><time>{dateLabel(selected.time)}</time><span>O {price(data.open)}</span><span>H {price(data.high)}</span><span>L {price(data.low)}</span><span>C {price(data.close)}</span><span>Vol {price(data.volume)}</span></>:<span className="muted">No real OHLCV in the covered interval</span>}</div>
    {rows.length?<svg viewBox={`0 0 ${W} ${H}`} className="candlestick-chart" role="application" aria-label="Real OHLCV candlesticks. Left and right move crosshair, plus and minus zoom, Page Up and Page Down pan." tabIndex={0} onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect();const target=(e.clientX-r.left)/r.width*W;setCross(rows.reduce((best,_,i)=>Math.abs(x(i)-target)<Math.abs(x(best)-target)?i:best,0));}} onPointerLeave={()=>setCross(null)} onKeyDown={e=>{if(["ArrowLeft","ArrowRight","+","=","-","PageUp","PageDown"].includes(e.key))e.preventDefault();if(e.key==="ArrowLeft")setCross(v=>Math.max(0,(v??rows.length-1)-1));if(e.key==="ArrowRight")setCross(v=>Math.min(rows.length-1,(v??0)+1));if(["+","="].includes(e.key))zoom(-10);if(e.key==="-")zoom(10);if(e.key==="PageUp")pan(20);if(e.key==="PageDown")pan(-20);}}>
      {[0,.25,.5,.75,1].map(t=><g key={t}><line x1={left} x2={W-right} y1={top+t*plotH} y2={top+t*plotH} stroke="var(--line)"/><text x={W-right+8} y={top+t*plotH+4} fill="var(--muted)" fontSize="12">{currency==="usd"?"$":""}{(high-t*(high-low)).toPrecision(5)}</text></g>)}
      {rows.map((c,i)=>{const a=c[currency]!, color=a.close>=a.open?"var(--accent)":"var(--sell)",spacing=rows.length>1?Math.min(...rows.slice(1).map((_,j)=>x(j+1)-x(j))):14,width=Math.max(1,Math.min(14,spacing*.6));return <g key={c.time}><line x1={x(i)} x2={x(i)} y1={y(a.high)} y2={y(a.low)} stroke={color}/><rect x={x(i)-width/2} y={Math.min(y(a.open),y(a.close))} width={width} height={Math.max(1,Math.abs(y(a.open)-y(a.close)))} fill={color}/><rect x={x(i)-width/2} y={H-26-a.volume/maxVolume*35} width={width} height={a.volume/maxVolume*35} fill={color} opacity=".5"/></g>;})}
      {cross!==null&&rows[cross]&&<g><line x1={x(cross)} x2={x(cross)} y1={top} y2={H-22} stroke="var(--focus)" strokeDasharray="4 4"/><line x1={left} x2={W-right} y1={y(rows[cross][currency]!.close)} y2={y(rows[cross][currency]!.close)} stroke="var(--focus)" strokeDasharray="4 4"/></g>}
      <text x={left} y={H-4} fill="var(--muted)" fontSize="12">{axisTime(rows[0].time)}</text><text x={W-right} y={H-4} textAnchor="end" fill="var(--muted)" fontSize="12">{axisTime(rows.at(-1)!.time)}</text>
    </svg>:<div className="chart-empty"><span className="muted">Candles appear after evidenced swaps are indexed.</span><span className="small muted">Spot prices are never expanded into invented history.</span></div>}
    <div className="chart-controls"><button className="button" disabled={!rows.length} onClick={()=>zoom(-10)} aria-label="Zoom in chart">+</button><button className="button" disabled={!rows.length} onClick={()=>zoom(10)} aria-label="Zoom out chart">−</button><button className="button" disabled={!rows.length||visibleOffset>=all.length-10} onClick={()=>pan(20)}>Earlier</button><button className="button" disabled={!visibleOffset} onClick={()=>pan(-20)}>Later</button><button className="button" disabled={!all.length} onClick={()=>{setCount(80);setOffset(0);setCross(null);}}>Reset chart</button></div>
    <figcaption className="small muted">{rows.length} real candles · intervals without swaps remain gaps · volume bars use {currency==="usd"?"USD":quoteSymbol}. Crosshair follows observed candles.</figcaption>
    <details><summary>Read OHLCV values</summary><div className="market-table-scroll" tabIndex={0}><table><thead><tr><th>Time UTC</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead><tbody>{rows.map(c=><tr key={c.time}><th>{dateLabel(c.time)}</th>{["open","high","low","close","volume"].map(k=><td key={k}>{price(c[currency]![k as keyof OHLC])}</td>)}</tr>)}</tbody></table></div></details>
  </figure>;
}
