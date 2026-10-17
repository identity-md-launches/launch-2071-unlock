import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";

// Own the disposable services for the duration of one bounded check.
const root = new URL("../../", import.meta.url);
const config = JSON.parse(fs.readFileSync(new URL("../evidence/fork-config.json", import.meta.url)));
const mode = process.argv[2] ?? "quote";
if (!["quote", "full"].includes(mode)) throw Error("Choose quote or full");
const rpc = "http://127.0.0.1:8546", site = "http://127.0.0.1:4174";
const fork = spawn("anvil", ["--host", "127.0.0.1", "--port", "8546", "--accounts", "0",
  "--fork-url", config.rpcUrl, "--fork-block-number", config.block, "--silent"], { cwd: root, stdio: ["ignore", "inherit", "inherit"] });
const server = spawn("python3", ["-m", "http.server", "4174", "--bind", "127.0.0.1", "--directory", "dist"],
  { cwd: root, stdio: "ignore" });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const [page, block] = await Promise.all([
        fetch(site),
        fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }) }).then((r) => r.json()),
      ]);
      if (page.ok && block.result?.hash === config.blockHash) { ready = true; break; }
    } catch { /* Wait for the local child processes, never poll a public write. */ }
    if (fork.exitCode !== null || server.exitCode !== null) throw Error("Disposable service exited before readiness");
    await setTimeout(200);
  }
  if (!ready) throw Error("Local preview/fork did not become ready");
  const name = mode === "quote" ? "check-quote-expiry.mjs" : "check-mainnet-browser.mjs";
  const check = spawn(process.execPath, [new URL(name, import.meta.url).pathname, site, rpc, ...process.argv.slice(3)],
    { cwd: root, stdio: "inherit" });
  const [code, signal] = await once(check, "exit");
  if (signal) throw Error(`Browser check stopped by ${signal}`);
  process.exitCode = code ?? 1;
} finally {
  fork.kill();
  server.kill();
}
