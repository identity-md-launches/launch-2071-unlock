import { useEffect, useRef, useState } from "react";
import { formatEther, type Address } from "viem";
import { api, githubRepository, safeExternal, scopePaths, type LabsSession } from "./api";
import { signAuditPayment } from "./payment";
import { describeConversion, quoteEthToImd, type ConversionQuote } from "./conversion";
import { useWallet, errorMessage } from "../wallet";
import { client } from "../config";
import { IMD, PERMIT2, UNIVERSAL_ROUTER } from "../mainnet";
import { erc20Abi, executeAbi } from "../mainnetAbis";
import { parseSlippage } from "../trading";

interface Props { apiBase: string; session: LabsSession | null; login: () => Promise<void> }
interface Source { repoUrl: string; baseCommit: string; sizeKb?: number }
const amountText = (atomic?: string) => atomic && /^\d+$/.test(atomic) ? formatEther(BigInt(atomic)) : "Unavailable";
const time = (value: any) => !value ? "Unavailable" : new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";

export function Audit({ apiBase, session, login }: Props) {
  const wallet = useWallet();
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [scope, setScope] = useState("");
  const [tree, setTree] = useState<Array<{path:string;type:string}>>([]);
  const [fileFilter,setFileFilter] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [check, setCheck] = useState<any>(null);
  const [capabilities, setCapabilities] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [order, setOrder] = useState<any>(null);
  const [disclosure, setDisclosure] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"repo" | "scope" | null>(null);
  const [funding, setFunding] = useState("IMD");
  const [slippage, setSlippage] = useState("0.5");
  const [conversion, setConversion] = useState<ConversionQuote | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [paymentWallet, setPaymentWallet] = useState<boolean | null>(null);
  const [reportId, setReportId] = useState("");
  const [report, setReport] = useState<any>(null);
  const [reportOrderId, setReportOrderId] = useState("");
  const [clock, setClock] = useState(Date.now());
  const sourceInput = useRef<HTMLInputElement>(null);
  const scopeInput = useRef<HTMLDivElement>(null);
  const quoteKey = useRef<{ input: string; key: string } | null>(null);
  const submitted = useRef(false);
  const identity = useRef("");
  const currentIdentity = `${wallet.address || ""}:${wallet.network || ""}:${session?.token || ""}`;
  identity.current = currentIdentity;

  const run = async (name: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(name); setError(""); setStatus("");
    try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(""); }
  };
  useEffect(() => {
    let active = true;
    setOrder(null); setOrders([]); setBalance(null); setAllowance(null); setPaymentWallet(null); setConversion(null); submitted.current = false;
    if (session && apiBase) void api(apiBase, "/audits/orders", { token: session.token }).then(x => { if (active) setOrders(x.orders || []); }).catch(() => {});
    return () => { active = false; };
  }, [session?.token, wallet.address, wallet.network, apiBase]);
  useEffect(() => {
    let alive = true;
    if (!apiBase) { setCapabilities(null); return; }
    const path = `${apiBase}/capabilities`;
    fetch(path, { signal: AbortSignal.timeout(15000) }).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(x => { if (alive) setCapabilities(x); }).catch(() => { if (alive) setCapabilities(null); });
    return () => { alive = false; };
  }, [apiBase]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);

  const q = order?.order?.quote || order?.quote;
  const orderId = order?.order?.id || order?.id;
  const upstreamStatus = order?.status || order?.order?.status;
  const orderStatus = order?.order?.submissionSaved && upstreamStatus === "quoted" ? "submission_saved" : upstreamStatus;
  const capability = capabilities?.actions?.find((x: any) => x.action === "job.open");
  const payment = q?.payment || capability?.payment;
  const required = payment?.amount && /^\d+$/.test(payment.amount) ? BigInt(payment.amount) : null;
  const expired = q?.expiresAt ? q.expiresAt * 1000 <= clock + 45000 : true;
  const jobId = order?.jobId || order?.admission?.result?.jobId || order?.order?.admission?.result?.jobId;
  const orderedInput = order?.order?.input || order?.input;
  const orderedScope = order?.order?.scope || order?.scope || [];
  const canPay = orderId && orderStatus === "quoted" && !expired && paymentWallet && balance !== null && required !== null && balance >= required && allowance !== null && allowance >= required;

  async function refreshFunds() {
    if (!wallet.address || wallet.network !== 1) throw Error("Connect your wallet on Ethereum to read payment balances.");
    const stamp = identity.current;
    const [b, a, code] = await Promise.all([
      client.readContract({ address: IMD, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }),
      client.readContract({ address: IMD, abi: erc20Abi, functionName: "allowance", args: [wallet.address, PERMIT2] }),
      client.getCode({ address: wallet.address }),
    ]);
    if (identity.current !== stamp) throw Error("The wallet changed. Refresh balances for the current account.");
    setBalance(b); setAllowance(a); setPaymentWallet(!code || code === "0x" || code.toLowerCase().startsWith("0xef0100"));
  }
  function selectedInput() {
    if (!source) throw Error("Import and pin the public repository first.");
    try { return { source, scope: scopePaths(scope) }; }
    catch (e) { setInvalid("scope"); scopeInput.current?.focus(); throw e; }
  }
  async function importRepo() {
    let normalized: string;
    try { normalized = githubRepository(url); setInvalid(null); }
    catch (e) { setInvalid("repo"); sourceInput.current?.focus(); throw e; }
    if (ref.length > 160 || /[\s\\?#]/.test(ref)) throw Error("Use a branch, tag or commit with no whitespace or URL delimiters.");
    setSource(null); setTree([]); setScope(""); setCheck(null); setOrder(null); setDisclosure(false); quoteKey.current = null;
    let data;
    if (apiBase) data = await api(apiBase, "/audits/import", { body: { url: normalized, ...(ref ? { ref } : {}) } });
    else {
      const repo = normalized.replace("https://github.com/", "");
      const metadataResponse = await fetch(`https://api.github.com/repos/${repo}`, { signal: AbortSignal.timeout(15000) });
      const metadata = await metadataResponse.json();
      if (!metadataResponse.ok || metadata.private || !metadata.default_branch) throw Error("GitHub could not read this public repository. Check the URL or retry after its free API quota resets (60 unauthenticated requests/hour).");
      if (metadata.size > 204800) throw Error("The repository exceeds IMD's 200 MB code-import limit.");
      const response = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref || metadata.default_branch)}`, { signal: AbortSignal.timeout(15000) });
      const commit = await response.json();
      if (!response.ok) throw Error("GitHub could not resolve this branch, tag or commit. Check the ref and try again.");
      data = { ok: true, source: { repoUrl: normalized, baseCommit: commit.sha, sizeKb: metadata.size } };
    }
    if (!data.ok || !/^[a-f0-9]{40}$/i.test(data.source?.baseCommit)) throw Error(data.problems?.map((x: any) => x.message || x.code || x).join("; ") || "The repository could not be pinned. Check that it is public.");
    const repo = githubRepository(data.source.repoUrl).replace("https://github.com/", "");
    let files;
    if(apiBase) files = (await api(apiBase,"/audits/tree",{body:{source:data.source}})).tree;
    else { const res=await fetch(`https://api.github.com/repos/${repo}/git/trees/${data.source.baseCommit}?recursive=1`,{signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error("GitHub could not load the pinned file tree. Check its public API quota and retry.");const result=await res.json();if(result.truncated||!Array.isArray(result.tree)||result.tree.length>20000)throw Error("The file tree exceeds the supported limit. Choose a smaller public repository.");files=result.tree; }
    setTree(files.filter((f:any)=>f.type==="blob"&&typeof f.path==="string"&&f.path.length<=180&&/^[A-Za-z0-9_./@+ -]+$/.test(f.path)).sort((a:any,b:any)=>a.path.localeCompare(b.path)));
    setSource(data.source); setStatus(apiBase ? "Repository pinned by IMD. Select the paths to review before requesting a quote." : "Commit pinned through GitHub. IMD import and admission checks require the Labs backend; select the scope to check its paths locally.");
  }
  async function checkScope() {
    const input = selectedInput();
    let data;
    if (apiBase) data = await api(apiBase, "/audits/check", { body: input });
    else {
      // Validate scope against GitHub's pinned tree before the documented IMD check.
      const repo = githubRepository(input.source.repoUrl).replace("https://github.com/", "");
      const response = await fetch(`https://api.github.com/repos/${repo}/git/trees/${input.source.baseCommit}?recursive=1`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error("GitHub could not verify the pinned scope. Retry later or configure the Labs service.");
      const tree = await response.json();
      if (tree.truncated || !Array.isArray(tree.tree)) throw Error("The pinned repository tree exceeds public scope validation limits. Choose a smaller repository.");
      if (input.scope.some(p => !tree.tree.some((x: any) => x.path === p.replace(/\/$/, "")))) throw Error("A selected path is absent at the pinned commit. Correct the scope and validate again.");
      data = { localOnly: true, blockers: [], scope: input.scope };
    }
    setCheck(data); setStatus(data.blockers?.length ? "Resolve the validation blockers before requesting a quote." : data.localOnly ? "Paths exist at the pinned GitHub commit. IMD validation and quoting need the deployed service. No payment or paid job was submitted." : "Scope validated by IMD. No payment or paid job was submitted.");
  }
  async function quote() {
    if (!session || !check || check.blockers?.length || !disclosure) throw Error("Validate the scope and accept the public-code disclosure before quoting.");
    const input = selectedInput(), fingerprint = JSON.stringify(input);
    const stamp = identity.current;
    // Only an explicit user quote action rotates the key for a terminal expired
    // order. The server independently confirms expiry/unpaid status first.
    if (orderStatus === "expired" && order?.payment?.paid !== true) quoteKey.current = null;
    if (!quoteKey.current || quoteKey.current.input !== fingerprint) quoteKey.current = { input: fingerprint, key: crypto.randomUUID() };
    const data = await api(apiBase, "/audits/quote", { token: session.token, body: { ...input, requestKey: quoteKey.current.key } });
    if (stamp !== identity.current) return;
    setOrder(data); submitted.current = false; setConversion(null);
    await refreshFunds();
    setStatus("Quote saved to your account. Review the live payment terms before signing.");
  }
  async function refreshOrder(id = orderId) {
    if (!session || !id) return;
    const stamp = identity.current;
    const data = await api(apiBase, `/audits/orders/${encodeURIComponent(id)}`, { token: session.token });
    if (stamp !== identity.current) return;
    setOrder(data);
    setStatus("Order status refreshed. Reading status never charges.");
  }
  async function pay() {
    if (!session || !wallet.address || !wallet.provider || !canPay || submitted.current) throw Error("Refresh this order and balances before paying. An in-flight payment must be resolved before any new attempt.");
    const stamp = identity.current;
    const ch = await api(apiBase, `/audits/orders/${orderId}/challenge`, { token: session.token, body: {} });
    if (!ch.accepts) { setOrder(ch); return; }
    const upstreamId = order?.order?.upstreamId || q?.id;
    const signed = await signAuditPayment(wallet.provider, wallet.address, ch, upstreamId, setStatus);
    if (identity.current !== stamp) throw Error("The wallet changed while signing. No payment was submitted.");
    submitted.current = true;
    // The server durably stores exact signatures before forwarding. If a response
    // is lost, retry the stored bytes through the recovery control, never re-sign.
    try {
      const data = await api(apiBase, `/audits/orders/${orderId}/submit`, { token: session.token, body: signed });
      if (stamp !== identity.current) return;
      setOrder(data); setStatus("Payment submitted. Refresh status to follow admission; completion and findings are not guaranteed.");
    } catch (e) { setStatus("The response was lost or refused. Refresh status, then use Retry saved submission if the service has persisted this attempt. Do not create another order."); throw e; }
  }
  async function approve() {
    if (!required || !wallet.address) throw Error("Get a current quote before approving an exact amount.");
    const stamp = identity.current;
    await wallet.review({ title: "Approve IMD for audit payment", description: "This onchain approval allows the canonical Permit2 contract to spend only the quoted IMD amount. It costs ETH gas and does not open an audit. Payment signatures are a separate step.", address: IMD, abi: erc20Abi, functionName: "approve", args: [PERMIT2, required], details: [["Token", IMD], ["Spender", PERMIT2], ["Allowance", `${formatEther(required)} IMD`]], validate: async () => { if (identity.current !== stamp || expired) throw Error("Wallet or quote changed. Refresh before approval."); }, onSuccess: () => { void refreshFunds().catch(() => {}); } });
  }
  async function convert() {
    if (!conversion || !wallet.address || conversion.account.toLowerCase() !== wallet.address.toLowerCase()) throw Error("Request an ETH conversion quote for your current wallet.");
    const value = conversion;
    await wallet.review({ title: "Get exact IMD with ETH", description: "This swap sends IMD to your own wallet and refunds unused ETH. You pay pool fees, bounded slippage and network gas. It does not submit or pay for an audit.", address: UNIVERSAL_ROUTER, abi: executeAbi, functionName: "execute", args: value.args, value: value.maximum, labsFunding: value, details: describeConversion(value), validate: async () => { if (Date.now() > value.quotedAt + 60000 || BigInt(Math.floor(Date.now() / 1000) + 15) >= value.deadline) throw Error("Conversion quote expired. Get a fresh route quote."); if (q?.expiresAt * 1000 <= Date.now() + 60000) throw Error("The audit quote expires too soon. Resolve it before converting."); }, onSuccess: () => { setConversion(null); void refreshFunds().catch(() => {}); } });
  }
  async function loadReport(id = jobId || reportId) {
    if (!/^[a-f0-9-]{36}$/i.test(id || "")) throw Error("Enter a valid public IMD audit job ID.");
    const owned = id === jobId && orderId && session;
    const data = owned ? await api(apiBase, `/audits/orders/${orderId}/report`, { token: session.token }) : await api(apiBase, `/audits/reports/${id}`);
    setReport(data); setReportOrderId(owned ? orderId : ""); setReportId(id); setStatus("Accepted public report loaded. Review the coverage and evidence alongside every finding.");
  }
  function downloadHtml() {
    const escape=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
    const text=report?.markdown||report?.reportMarkdown||JSON.stringify(report,null,2);
    const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>UNLOCK audit ${escape(report?.jobId)}</title><style>body{font:16px/1.6 monospace;max-width:90ch;margin:32px auto;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>UNLOCK audit report</h1><p>Public AI review; not a security guarantee.</p><pre>${escape(text)}</pre></html>`;
    const href=URL.createObjectURL(new Blob([html],{type:"text/html"})),a=document.createElement("a");a.href=href;a.download=`unlock-audit-${report?.jobId||"report"}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  async function downloadPdf() {
    const id = report?.jobId || reportId;
    const route = reportOrderId ? `/audits/orders/${reportOrderId}/report.pdf` : `/audits/reports/${id}/pdf`;
    const response = await fetch(`${apiBase}${route}`, { headers: reportOrderId && session ? { Authorization: `Bearer ${session.token}` } : {}, signal: AbortSignal.timeout(25000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) throw Error("The matching PDF is not ready. Reload the accepted report and retry.");
    const blob = await response.blob(), href = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = href; a.download = `unlock-audit-${id}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return <div className="audit-layout">
    <section className="labs-section audit-work" aria-labelledby="audit-heading">
      <div className="labs-heading"><div><h2 id="audit-heading">Audit public code</h2><p className="muted">Pin a commit. Set the scope. Review before paying.</p></div><span className="tag">Ethereum · IMD</span></div>
      <ol className="audit-steps" aria-label="Audit steps"><li>Repository</li><li>Commit & files</li><li>Scope & cost</li><li>Payment</li><li>Progress</li><li>Report</li></ol>
      <form className="labs-form" onSubmit={e => { e.preventDefault(); void run("Import repository", importRepo); }}>
        <label htmlFor="audit-repo">Public GitHub repository</label>
        <div className="labs-input-action"><input ref={sourceInput} id="audit-repo" aria-invalid={invalid === "repo"} aria-describedby="audit-error" type="url" autoComplete="url" placeholder="https://github.com/owner/repository" required value={url} onChange={e => { setUrl(e.target.value); setInvalid(null); setSource(null); setCheck(null); }} /><button className="button primary" disabled={!!busy}>{busy === "Import repository" ? "Importing…" : "Import repository"}</button></div>
        <details><summary>Choose a branch, tag or commit</summary><label htmlFor="audit-ref">Git ref (optional; default branch otherwise)</label><input id="audit-ref" value={ref} maxLength={160} onChange={e => { setRef(e.target.value); setSource(null); setCheck(null); }} /></details>
      </form>
<button className="button" onClick={()=>{setUrl("https://github.com/identity-md-launches/launch-2071-unlock");setRef("");setSource(null);setTree([]);setCheck(null);}}>Use UNLK repository example</button>
      <p className="small muted labs-note">Public code and accepted reports are public. Four AI specialists and a judge review the pinned scope. A review can be incomplete and is never a security guarantee.</p>
      {source && <div className="audit-stage">
        <h3>1. Confirm the pinned scope</h3><dl className="labs-ledger"><dt>Repository</dt><dd>{source.repoUrl}</dd><dt>Commit</dt><dd><a href={`${githubRepository(source.repoUrl)}/tree/${source.baseCommit}`} target="_blank" rel="noreferrer">{source.baseCommit} ↗</a></dd></dl>
        <label htmlFor="audit-file-filter">Find files at this commit</label><input id="audit-file-filter" type="search" placeholder="For example: src/ or .sol" value={fileFilter} onChange={e=>setFileFilter(e.target.value)}/>
        <div ref={scopeInput} className="file-tree" tabIndex={-1} aria-label="Pinned repository file selection" aria-describedby="scope-hint audit-error">{tree.filter(f=>f.path.toLowerCase().includes(fileFilter.toLowerCase())).slice(0,300).map(f=><label key={f.path}><input type="checkbox" checked={scope.split("\n").includes(f.path)} onChange={e=>{const selected=scope.split("\n").filter(Boolean);if(e.target.checked&&selected.length>=16){setError("Select at most 16 files. Remove one before adding another.");return;}setScope((e.target.checked?[...selected,f.path]:selected.filter(p=>p!==f.path)).join("\n"));setInvalid(null);setCheck(null);setDisclosure(false);setOrder(null);}}/><span>{f.path}</span></label>)}{!tree.filter(f=>f.path.toLowerCase().includes(fileFilter.toLowerCase())).length&&<p className="muted small">No files match. Clear the filter or import another repository.</p>}</div>
        <p id="scope-hint" className="small muted">Select 1–16 existing files. {scope.split("\n").filter(Boolean).length} selected. Filter narrows the first 300 shown; selection is retained. These exact paths enter the public signed scope.</p>
        {!!scope&&<details><summary>Review selected public files</summary><pre>{scope}</pre></details>}
        <button className="button" disabled={!!busy} onClick={() => void run("Validate scope", checkScope)}>{busy === "Validate scope" ? "Validating…" : "Validate scope"}</button>
        {check && <div className="labs-note"><strong>{check.blockers?.length ? "Validation blockers" : check.localOnly ? "GitHub paths verified · IMD check pending" : "Scope passed the IMD check"}</strong>{check.blockers?.length ? <pre>{JSON.stringify(check.blockers, null, 2)}</pre> : <p className="small muted">{check.localOnly ? "The backend will repeat the documented IMD import and scope check before quoting. No paid work is available on static hosting alone." : "Audit specialists → judge → accepted public report. Validation does not hold a price or promise admission."}</p>}</div>}
      </div>}
      {check && !check.localOnly && !check.blockers?.length && <div className="audit-stage"><h3>2. Review terms and quote</h3>
        <dl className="labs-ledger"><dt>Network review</dt><dd>{amountText(capability?.payment?.amount)} IMD <span className="muted">from current capabilities</span></dd><dt>Labs markup</dt><dd>None</dd><dt>Other costs</dt><dd>Conversion pool fee/slippage and ETH gas if needed; IMD approval gas if needed. x402 settlement gas is paid by IMD.</dd></dl>
        <label className="labs-checkbox"><input type="checkbox" checked={disclosure} onChange={e => setDisclosure(e.target.checked)} />I understand that the code and report are public, this pays for admission, and findings, completion and refunds are not guaranteed.</label>
        {!session ? <button className="button" disabled={!apiBase || !!busy} onClick={() => void run("Sign in", login)}>Sign in to quote</button> : <button className="button primary" disabled={!apiBase || !!busy || !disclosure} onClick={() => void run("Request quote", quote)}>{busy === "Request quote" ? "Quoting…" : "Get current audit quote"}</button>}
      </div>}
      {order && <div className="audit-stage"><h3>3. Fund and pay this order</h3><dl className="labs-ledger"><dt>Order</dt><dd>{orderId}</dd><dt>Status</dt><dd>{orderStatus || "Unknown; refresh status"}</dd><dt>Repository</dt><dd>{orderedInput?.repoUrl || "See stored order input"}</dd><dt>Pinned commit</dt><dd>{orderedInput?.baseCommit || "Unavailable"}</dd><dt>Selected scope</dt><dd>{orderedScope.length ? orderedScope.join(", ") : "See stored objective"}</dd><dt>Exact payment</dt><dd>{amountText(q?.payment?.amount)} IMD</dd><dt>Recipient</dt><dd>{q?.payment?.payTo || "Unavailable"}</dd><dt>Quote expires</dt><dd>{time(q?.expiresAt)}{expired && " · expired or too close to sign"}</dd><dt>Wallet balance</dt><dd>{balance === null ? "Read required" : `${formatEther(balance)} IMD`}</dd></dl>
        <div className="labs-actions"><button className="button" disabled={!!busy} onClick={() => void run("Refresh order", () => refreshOrder())}>Refresh status</button><button className="button" disabled={!!busy || wallet.network !== 1} onClick={() => void run("Refresh balances", refreshFunds)}>Refresh balances</button></div>
        {order?.admission?.result?.kind === "refused" && <div className="labs-note warning"><strong>Admission refused</strong><p>This payment did not open a review. Read the provider outcome; no refund or automatic resubmission is promised.</p><pre>{JSON.stringify(order.admission.result.problems || [], null, 2)}</pre></div>}
        {order?.job && <p className="labs-note">Job: {order.job.state || "Status unavailable"}{order.job.blockedReason ? ` · ${order.job.blockedReason}` : ""}. An unfinished job is not a completed review.</p>}
        {orderStatus === "expired" && <p className="small warning labs-note">The quote expired. Revalidate the pinned scope and request a new quote explicitly. The service will first confirm the old order is unpaid and has no pending settlement.</p>}
        {paymentWallet === false && <p className="warning labs-note">IMD payments support ordinary Ethereum accounts and EIP-7702 accounts. Contract wallets can browse and sign in but cannot pay this API yet. Use a supported payment wallet.</p>}
        {orderStatus === "quoted" && !expired && paymentWallet && <><label htmlFor="audit-funding">Fund with</label><select id="audit-funding" value={funding} onChange={e => { setFunding(e.target.value); setConversion(null); }}><option>IMD</option><option>ETH</option><option disabled>USDC · no verified exact-output route</option></select><p className="small muted labs-note">USDC is unavailable: a USDC → IMD exact-output path has not been verified against the supported pool registry. No approval or conversion is offered for that route.</p>
          {funding === "ETH" && <div className="labs-note"><p>Step A: swap ETH for the exact missing IMD in your wallet. Step B: approve IMD if needed, then sign the separate audit payment. A failed swap cannot submit a job.</p><label htmlFor="audit-slip">Maximum conversion slippage (%)</label><input id="audit-slip" inputMode="decimal" value={slippage} onChange={e => { setSlippage(e.target.value); setConversion(null); }} />
            <button className="button" disabled={!!busy || required === null || balance === null || balance >= required} onClick={() => void run("Quote conversion", async () => { if (!wallet.address || !required || balance === null) return; setConversion(await quoteEthToImd(wallet.address, required - balance, parseSlippage(slippage))); })}>Quote exact IMD with ETH</button>
            {conversion && <><dl className="labs-ledger">{describeConversion(conversion).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><button className="button" disabled={!!busy || clock > conversion.quotedAt + 60000} onClick={() => void run("Review conversion", convert)}>Review ETH conversion</button></>}
          </div>}
          {required !== null && balance !== null && balance >= required && allowance !== null && allowance < required && <button className="button" disabled={!!busy} onClick={() => void run("Review approval", approve)}>Review exact IMD approval</button>}
          <p className="small muted labs-note">Payment asks for two EIP-712 signatures: a bounded Permit2 payment, then approval of this exact quote. Login never approves spending. Holding UNLK does not make this paid job free.</p>
          <button className="button primary" disabled={!!busy || !canPay || submitted.current} onClick={() => void run("Sign audit payment", pay)}>Sign & pay {amountText(q?.payment?.amount)} IMD</button>
        </>}
        {!["admitted", "expired", "refused"].includes(orderStatus) && <button className="button" disabled={!!busy} onClick={() => void run("Retry saved payment", async () => { if (!session) return; const result = await api(apiBase, `/audits/orders/${orderId}/submit`, { token: session.token, body: { retry: true } }); setOrder(result); })}>Retry saved submission</button>}
        <p className="small muted labs-note">Retry reuses this order and its saved payment bytes. If a payment is pending, failed, refused or expired, inspect its status before starting another order. No automatic refund is promised.</p>
        {jobId && <div className="labs-actions"><a className="button" href={`https://explorer.imd.fun/jobs/${jobId}`} target="_blank" rel="noreferrer">Follow public job ↗</a><button className="button" disabled={!!busy} onClick={() => void run("Load report", () => loadReport(jobId))}>Load accepted report</button></div>}
      </div>}
      <div role="status" className="labs-status">{busy && `${busy}… `}{status}</div><div id="audit-error" role="alert" className="error labs-status">{error}</div>
    </section>
    <aside className="labs-section audit-side" aria-label="Audit history and reports">
      <h2>Orders & reports</h2><p className="small muted">Orders follow your signed wallet login across reloads. Only the owning wallet can quote, submit or recover a payment.</p>
      {!apiBase && <p className="labs-service-notice">Audit payment is unavailable until the Labs backend is deployed. GitHub commit pinning and path checks are available now; IMD rejects direct browser calls to its paid-request API.</p>}
      {!session && apiBase && <button className="button" disabled={!!busy} onClick={() => void run("Sign in", login)}>Sign in to recover orders</button>}
      {orders.length > 0 && <ul className="audit-orders">{orders.map((o: any) => <li key={o.id}><button className="button" disabled={!!busy} onClick={() => void run("Load order", () => refreshOrder(o.id))}>{o.status} · {o.id}</button></li>)}</ul>}
      <form className="labs-form" onSubmit={e => { e.preventDefault(); void run("Load report", () => loadReport()); }}><label htmlFor="report-job">Public audit job ID</label><input id="report-job" value={reportId} onChange={e => setReportId(e.target.value)} placeholder="IMD audit job UUID" /><button className="button" disabled={!!busy || !apiBase}>Read accepted report</button></form>
      <a href="https://imd.fun/docs/#audits" target="_blank" rel="noreferrer">How IMD audits work ↗</a>
    </aside>
      {report && <section className="audit-report labs-section" aria-labelledby="report-heading"><h2 id="report-heading">{report.complete ? "Completed review" : "Incomplete review"}</h2><dl className="labs-ledger"><dt>Job</dt><dd>{report.jobId}</dd><dt>Commit</dt><dd>{report.commit || "See report scope"}</dd><dt>Date</dt><dd>{time(report.date || report.updatedAt)}</dd><dt>Coverage</dt><dd>{Array.isArray(report.scope) ? report.scope.join(", ") || "See the original report" : report.scope || "See the original report"}</dd></dl>
        <p className="small warning">Accepted findings are AI review results, not a security guarantee. Reproduce the evidence and read scope limitations.</p>
        <button className="button" onClick={() => void run("Download PDF", downloadPdf)}>Download matching PDF</button><button className="button" onClick={downloadHtml}>Download HTML report</button>
        {(report.findings || []).map((f: any, i: number) => <article className="audit-finding" key={i}><span className="tag">{f.severity || "Unclassified"}</span><h3>{f.title}</h3><p className="address">{f.path || f.location}{f.line ? `:${f.line}` : ""}</p><p>{f.description}</p>{f.evidence && <><strong>Evidence / tests</strong><pre>{typeof f.evidence === "string" ? f.evidence : JSON.stringify(f.evidence, null, 2)}</pre></>}{f.reproduction && <pre>{typeof f.reproduction === "string" ? f.reproduction : JSON.stringify(f.reproduction, null, 2)}</pre>}{f.proof && <details><summary>Read reproduction proof / tests</summary><pre>{f.proof}</pre></details>}{f.snippet && <details><summary>Read affected code</summary><pre>{f.snippet}</pre></details>}<strong>Recommendation</strong><p>{f.recommendation || "Read the finding description and complete accepted report for the proposed correction and its limits."}</p>{safeExternal(f.sourceUrl || f.citation) && <a href={safeExternal(f.sourceUrl || f.citation)} target="_blank" rel="noreferrer">Affected source ↗</a>}</article>)}
        <details><summary>Read the complete accepted Markdown</summary><pre className="audit-markdown">{report.markdown}</pre></details>
      </section>}
  </div>;
}
