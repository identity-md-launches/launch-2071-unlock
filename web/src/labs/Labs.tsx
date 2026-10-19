import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom } from "viem";
import { chain } from "../config";
import { useWallet, errorMessage } from "../wallet";
import { api, type LabsSession } from "./api";
import { Audit } from "./Audit";
import { Markets } from "./Markets";
import { Radar } from "./Radar";
import "./labs.css";

const key = "unlock-labs-session-v1";
export function Labs({ section }: { section: string }) {
  const wallet = useWallet();
  const [apiBase, setApiBase] = useState("");
  const [configured, setConfigured] = useState(false);
  const [session, setSession] = useState<LabsSession | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const walletIdentity = useRef("");
  walletIdentity.current = `${wallet.address || ""}:${wallet.network || ""}`;
  const tab = section === "labs-audit" ? "audit" : section === "labs-radar" ? "radar" : "markets";

  useEffect(() => {
    let active = true;
    fetch("./labs-config.json", { signal: AbortSignal.timeout(8000), cache: "no-store" }).then(r => r.json()).then(c => {
      if (!active) return;
      if (c.apiBase) {
        const u = new URL(c.apiBase, location.href);
        if ((u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) || u.username || u.password || u.hash || u.search) throw Error("Invalid Labs service URL.");
        const base=u.href.replace(/\/$/, "");
        fetch(`${base}/health`,{signal:AbortSignal.timeout(8000),credentials:"omit",redirect:"error"}).then(r=>{if(!r.ok)throw Error("Service health check failed.");return r.json();}).then(health=>{if(active&&health.ok===true&&health.chainId===1)setApiBase(base);}).catch(()=>{if(active)setMessage("Configured Labs service is unreachable. Backend features remain disabled; you can retry by reloading.");});
      }
      setConfigured(true);
    }).catch(() => { if (active) setConfigured(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    setSession(null);
    if (!wallet.address || wallet.network !== 1 || !apiBase) return;
    const stamp = walletIdentity.current;
    let active = true;
    try {
      const saved: LabsSession | null = JSON.parse(sessionStorage.getItem(key) || "null");
      if (saved?.address?.toLowerCase() === wallet.address.toLowerCase() && saved.token) {
        api(apiBase, "/auth/session", { token: saved.token }).then(s => {
          if (active && stamp === walletIdentity.current && s.authenticated) setSession({ ...s, token: saved.token });
        }).catch(() => { sessionStorage.removeItem(key); });
      } else sessionStorage.removeItem(key);
    } catch { /* storage can be unavailable */ }
    return () => { active = false; };
  }, [wallet.address, wallet.network, apiBase]);
  useEffect(() => {
    if (!session) return;
    const expires = typeof session.expiresAt === "string" ? Date.parse(session.expiresAt) : session.expiresAt < 1e12 ? session.expiresAt * 1000 : session.expiresAt;
    const expire = () => { setSession(null); try { sessionStorage.removeItem(key); } catch { /* no persistence */ } setMessage("Your Labs login expired. Sign in again; no spending approval is needed."); };
    const timer = setTimeout(expire, Math.max(0, expires - Date.now()));
    // Eligibility is rechecked by every protected server call, and periodically
    // here so the displayed state follows a transfer or a failed RPC read.
    const refresh = setInterval(() => {
      api(apiBase, "/auth/session", { token: session.token }).then(s => { if (s.authenticated) setSession(old => old?.token === session.token ? { ...s, token: session.token } : old); else expire(); }).catch(expire);
    }, 60000);
    return () => { clearTimeout(timer); clearInterval(refresh); };
  }, [session?.token, apiBase]);

  async function login() {
    if (!wallet.address || !wallet.provider) { wallet.open(); return; }
    if (wallet.network !== 1) { await wallet.switchNetwork(); return; }
    if (!apiBase) throw Error("The Labs backend must be deployed before wallet login is available.");
    const stamp = walletIdentity.current, address = wallet.address;
    const challenge = await api(apiBase, "/auth/nonce", { body: { address } });
    if (stamp !== walletIdentity.current) throw Error("The wallet changed. Request a new login nonce.");
    if (typeof challenge.message !== "string" || !challenge.message.toLowerCase().includes(address.toLowerCase()) || !challenge.message.includes("Chain ID: 1") || !challenge.message.includes(location.host)) throw Error("The login message does not match this website, account and Ethereum.");
    const signer = createWalletClient({ chain, account: address, transport: custom(wallet.provider) });
    const signature = await signer.signMessage({ message: challenge.message });
    if (stamp !== walletIdentity.current) throw Error("The wallet changed while signing. Sign in with the current account.");
    const result = await api(apiBase, "/auth/verify", { body: { address, nonce: challenge.nonce, signature } });
    if (stamp !== walletIdentity.current) return;
    const s = { ...result, address, token: result.token } as LabsSession;
    setSession(s);
    try { sessionStorage.setItem(key, JSON.stringify(s)); } catch { /* login still works in memory */ }
    setMessage(s.eligible ? "Positive UNLK balance verified. Holder tools are available." : "Signed in. No positive UNLK balance was found; audit ordering remains available.");
  }
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await fn(); } catch (e) { setMessage(errorMessage(e)); } finally { setBusy(false); }
  }
  async function logout() {
    if (session) await api(apiBase, "/auth/logout", { token: session.token, body: {} }).catch(() => {});
    setSession(null); try { sessionStorage.removeItem(key); } catch { /* no persistence */ }
    setMessage("Signed out of Labs.");
  }

  return <div className="labs-root">
    <div className="labs-intro"><div><h1>UNLOCK LABS</h1><p className="muted">Ethereum research terminal.</p></div>{apiBase && <div className="labs-auth"><span className="tag">{session?.eligible ? "UNLK holder" : "Public access"}</span>{session ? <button className="button" onClick={() => void act(logout)} disabled={busy}>Sign out</button> : <button className="button" onClick={() => void act(login)} disabled={busy || !apiBase}>{busy ? "Signing in…" : "Sign in to Labs"}</button>}</div>}</div>
    <nav className="labs-tabs" aria-label="Labs tools">{[["markets", "Markets"], ["radar", "Radar"], ["audit", "Audit"]].map(([id, label]) => <a key={id} href={`#labs-${id}`} aria-current={tab === id ? "page" : undefined}>{label}</a>)}<span className="small muted">Ethereum · {apiBase ? "Service configured" : configured ? "Backend disconnected · snapshot mode" : "Checking service…"}</span></nav>
    <div className="labs-login-message" role="status">{message}</div>
    {tab === "audit" ? <Audit apiBase={apiBase} session={session} login={login} /> : tab === "radar" ? <Radar key={session?.token || "public"} apiBase={apiBase} session={session} /> : <Markets key={session?.token || "public"} apiBase={apiBase} session={session} />}
    <details className="labs-service-details"><summary>Access, coverage & service status</summary><p>Markets, filters and device watchlists are public. A positive UNLK balance unlocks server watchlists and exports. Project editing separately requires verified deployment ownership. No staking or transfer is required. Login signs a nonce bound to this domain and expiry; it grants no token spending approval.</p><p>The service verifies your session and current balance on protected requests. Audit jobs are separately paid by each customer in IMD, including holders. No Labs markup or founder advance.</p><p>{apiBase ? "The configured service supplies persistent orders and bounded indexing. A provider outage can leave readings stale; each panel reports its coverage." : "The Labs backend has not been hosted. Public observations below are dated snapshots, not a live feed. Audit payments, login and holder tools stay unavailable until an operator deploys the included service and configures labs-config.json. Static IPFS hosting cannot run persistent jobs."}</p><p><a href="https://github.com/identity-md-launches/launch-2071-unlock/blob/main/docs/backend.md" target="_blank" rel="noreferrer">Service setup and connection guide ↗</a> · <a href="https://github.com/identity-md-launches/launch-2071-unlock/blob/main/docs/labs-data.md" target="_blank" rel="noreferrer">Provider limits and coverage ↗</a></p></details>
  </div>;
}
