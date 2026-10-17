// Restore pinned compiler bytes locally; no installs, network or host configuration.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(web, "vendor");
const toolchains = JSON.parse(fs.readFileSync(path.join(vendor, "toolchain.json"), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function prepareToolchain(name) {
  const entry = toolchains[name];
  if (!entry || entry.compression !== "brotli") throw new Error(`Unknown toolchain: ${name}`);
  const source = path.join(vendor, entry.directory);
  const packed = fs.readFileSync(path.join(source, `${entry.file}.br`));
  if (sha256(packed) !== entry.compressedSha256) throw new Error(`Compressed compiler changed: ${name}`);
  const bytes = brotliDecompressSync(packed, { maxOutputLength: entry.bytes });
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
    throw new Error(`Restored compiler changed: ${name}`);
  }
  const destination = path.join(web, "..", "test", "scratch", "toolchain", name);
  // Copy every retained helper/library on each invocation, so stale scratch is never trusted.
  fs.cpSync(source, destination, { recursive: true, filter: file => !file.endsWith(".br") });
  fs.writeFileSync(path.join(destination, entry.file), bytes);
  return destination;
}
