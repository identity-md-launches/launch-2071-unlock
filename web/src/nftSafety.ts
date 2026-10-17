export const MAX_METADATA = 512 * 1024;
export const MAX_IMAGE = 2 * 1024 * 1024;

export function publicHttps(value: string): string {
  if (value.length > 4096) throw new Error("URI too long");
  if (value.startsWith("ipfs://")) {
    const path = value.slice(7).replace(/^ipfs\//, "");
    if (!/^[a-zA-Z0-9]{20,}(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]*)?$/.test(path) || path.includes("..")) throw new Error("Invalid IPFS URI");
    value = `https://ipfs.io/ipfs/${path}`;
  }
  const u = new URL(value);
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") ||
      !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") ||
      /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)) throw new Error("Only public HTTPS or IPFS resources are supported");
  return u.href;
}

export function decodeData(value: string, mime: "application/json" | "image/svg+xml", limit: number): string {
  if (value.length > limit * 2) throw new Error("Data URI too large");
  const match = new RegExp(`^data:${mime.replace("+", "\\+")}(?:;charset=utf-8)?(;base64)?,(.*)$`, "is").exec(value);
  if (!match) throw new Error("Unsupported data URI");
  const decoded = match[1] ? new TextDecoder().decode(Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))) : decodeURIComponent(match[2]);
  if (new TextEncoder().encode(decoded).length > limit) throw new Error("Decoded resource too large");
  return decoded;
}

// Render only through an <img> blob URL, never innerHTML, <object>, iframe or an SVG DOM insertion.
// Reject active content and external resource references even though the image context disables scripts.
export function safeSvg(svg: string): string {
  if (svg.length > MAX_IMAGE || !/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg) ||
      /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed|image|use|style|a|animate|set)(?:\s|\/?>)/i.test(svg) ||
      /\bon[a-z]+\s*=|\b(?:href|src)\s*=|(?:javascript|https?|data):|@import|url\(\s*['"]?(?!#)/i.test(svg.replace(/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/gi, ""))) {
    throw new Error("SVG contains unsupported active or external content");
  }
  return svg;
}

export async function fetchBounded(url: string, limit: number, signal: AbortSignal): Promise<{text: string; bytes: Uint8Array; type: string}> {
  const response = await fetch(publicHttps(url), {signal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer"});
  if (!response.ok) throw new Error(`Resource returned HTTP ${response.status}`);
  if (Number(response.headers.get("content-length") ?? 0) > limit) throw new Error("Resource too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Resource body unavailable");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw new Error("Resource too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return {text: new TextDecoder().decode(bytes), bytes, type: (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase()};
}

export async function metadataImage(uri: string, signal: AbortSignal): Promise<Blob> {
  const text = uri.startsWith("data:") ? decodeData(uri, "application/json", MAX_METADATA) : (await fetchBounded(uri, MAX_METADATA, signal)).text;
  const metadata: unknown = JSON.parse(text);
  if (!metadata || typeof metadata !== "object" || !("image" in metadata) || typeof metadata.image !== "string") throw new Error("Metadata has no supported image");
  const image = metadata.image;
  if (image.startsWith("data:")) {
    return new Blob([safeSvg(decodeData(image, "image/svg+xml", MAX_IMAGE))], {type: "image/svg+xml"});
  }
  const result = await fetchBounded(image, MAX_IMAGE, signal);
  if (result.type === "image/svg+xml") return new Blob([safeSvg(result.text)], {type: result.type});
  if (!["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(result.type)) throw new Error("Unsupported image type");
  return new Blob([result.bytes as BlobPart], {type: result.type});
}

export function cursorParams(cursor: unknown): Record<string, string> | null {
  if (cursor === null || cursor === undefined) return null;
  if (typeof cursor !== "object" || Array.isArray(cursor) || Object.keys(cursor).length > 12) throw new Error("Invalid inventory cursor");
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(cursor)) {
    if (!/^[a-z_]{1,40}$/.test(key) || !["string", "number", "boolean"].includes(typeof value) || String(value).length > 200) throw new Error("Invalid inventory cursor");
    if (key === "type") continue;
    out[key] = String(value);
  }
  return out;
}
