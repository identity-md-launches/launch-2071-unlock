export interface LabsSession {
  token: string;
  address: string;
  eligible: boolean;
  expiresAt: number | string;
  unlkBalance?: string;
}

export class LabsError extends Error {
  constructor(message: string, public status: number, public detail?: unknown) { super(message); }
}

export async function api<T = any>(base: string, path: string, options: { token?: string; body?: unknown; method?: string; signal?: AbortSignal } = {}): Promise<T> {
  if (!base) throw new LabsError("The Labs service is not deployed. Repository checks remain available; signing opens after a service is configured.", 503);
  const res = await fetch(`${base}${path}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers: { ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal ?? AbortSignal.timeout(25000),
    credentials: "omit",
    redirect: "error",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new LabsError(String(data.message || data.detail || data.error || `Request failed (${res.status}). Try again.`).slice(0, 600), res.status, data);
  return data as T;
}

/** No URL supplied by repository content becomes a fetch target. */
export function githubRepository(input: string): string {
  let u: URL;
  try { u = new URL(input); } catch { throw Error("Enter a public https://github.com/owner/repository URL."); }
  const parts = u.pathname.replace(/\.git\/?$/, "").split("/").filter(Boolean);
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.username || u.password || u.port || u.search || u.hash || parts.length !== 2 || parts.some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || p === "." || p === "..")) throw Error("Use the repository root on github.com, with no credentials, query or fragment. Choose the ref separately.");
  return `https://github.com/${parts.join("/")}`;
}

export function scopePaths(input: string): string[] {
  const paths = [...new Set(input.split(/[\n,]/).map(s => s.trim()).filter(Boolean))];
  if (!paths.length || paths.length > 16 || paths.some(p => p.length > 180 || !/^[A-Za-z0-9_./@+ -]+$/.test(p) || p.startsWith("/") || p.split("/").some(x => x === ".." || x === ".") || p.includes("//"))) throw Error("Enter 1–16 repository-relative paths, one per line. Use directory names or files, without .. or a leading slash.");
  return paths;
}

export function safeExternal(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const u = new URL(value);
    if (u.protocol === "https:" && !u.username && !u.password && !u.port && ["github.com", "api.imd.fun", "explorer.imd.fun", "etherscan.io", "dexscreener.com"].includes(u.hostname)) return u.href;
  } catch { /* render as text */ }
}

export async function directValidation(path: "import" | "check", body: unknown) {
  // These documented public endpoints create no paid order. The production API
  // can reject cross-origin requests; expose that limitation instead of bypassing it.
  const res = await fetch(`https://api.imd.fun/requests/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = await res.json();
  if (!res.ok) throw new LabsError(data.detail || data.error || "IMD refused validation. Use the configured backend or retry later.", res.status, data);
  return data;
}
