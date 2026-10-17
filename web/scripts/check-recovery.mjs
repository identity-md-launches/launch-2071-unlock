import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.IMD_PLAYWRIGHT || "playwright");
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
process.chdir(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const root = path.resolve("dist");
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const f = path.resolve(root, p.replace(/^\/preview\//, "") || "index.html");
  if (!f.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(f, (e, data) => {
    if (e) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
          ".png": "image/png",
        }[path.extname(f)] ?? "text/plain",
    });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const BUY =
  "0x595a858a472215ec90b12ef0f30fa193daae4f17fa9ddb83269b6a1214e101ab";
const results = {
  checkedAt: new Date().toISOString(),
  checks: [],
  errors: [],
  note: "No wallet provider or key. Receipt recovery reads the existing public buy. Pending/reverted responses are explicitly injected UI fixtures, not public transactions. First two RPC outages and the proof API outage are injected; successful fallback responses are live.",
};
const browser = await chromium.launch({ headless: true });
try {
  const fallback = await browser.newContext();
  let thirdReads = 0,
    proofFallback = 0;
  await fallback.route("https://ethereum-sepolia-rpc.publicnode.com/**", (r) =>
    r.fulfill({ status: 503, body: "Injected unavailable RPC" }),
  );
  await fallback.route("https://rpc.sepolia.ethpandaops.io/**", (r) =>
    r.fulfill({ status: 503, body: "Injected unavailable RPC" }),
  );
  await fallback.route("https://api.imd.fun/**", (r) => {
    proofFallback++;
    return r.fulfill({
      status: 503,
      body: "Injected unavailable proof service",
    });
  });
  fallback.on("request", (r) => {
    if (r.url().startsWith("https://sepolia.rpc.sentio.xyz")) thirdReads++;
  });
  const fp = await fallback.newPage();
  fp.on("pageerror", (e) => results.errors.push(e.message));
  await fp.goto(url + "#/unlock");
  await fp
    .locator(".data-stamp")
    .filter({ hasText: "On-chain read" })
    .waitFor({ timeout: 60000 });
  assert.ok(thirdReads > 0);
  results.checks.push(
    "Two unavailable RPCs fall back to the third real Sepolia RPC; verified live read completes",
  );
  await fp
    .getByText(
      "Bundled IMD round-0 proofs, verified against the current native root",
      { exact: false },
    )
    .waitFor({ timeout: 60000 });
  assert.ok(proofFallback > 0);
  results.checks.push(
    "Unavailable IMD proof service uses bundled authentic round-0 tree after comparison with live native root",
  );
  await fallback.close();

  for (const initialMode of ["pending", "reverted"]) {
    const context = await browser.newContext();
    let mode = initialMode;
    const methods = new Set();
    await context.addInitScript(
      ({ hash }) => {
        if (!sessionStorage.getItem("receipt-fixture-started")) {
          localStorage.setItem(
            "unlk-pending",
            JSON.stringify({ hash, label: "Receipt recovery check" }),
          );
          sessionStorage.setItem("receipt-fixture-started", "true");
        }
      },
      { hash: BUY },
    );
    await context.route(
      /https:\/\/(ethereum-sepolia-rpc\.publicnode\.com|rpc\.sepolia\.ethpandaops\.io|sepolia\.rpc\.sentio\.xyz)\/?/,
      async (route) => {
        const request = route.request();
        if (request.method() !== "POST") return route.continue();
        const payload = request.postDataJSON();
        const calls = Array.isArray(payload) ? payload : [payload];
        for (const call of calls) {
          methods.add(call.method);
          assert.ok(
            !/send|sign/i.test(call.method),
            "The recovery page must remain read-only",
          );
        }
        const receipts = new Set(
          calls
            .filter((c) => c.method === "eth_getTransactionReceipt")
            .map((c) => c.id),
        );
        if (!receipts.size) return route.continue();
        const response = await route.fetch();
        const json = await response.json();
        const items = Array.isArray(json) ? json : [json];
        for (const item of items)
          if (receipts.has(item.id)) {
            if (mode === "pending") item.result = null;
            else if (mode === "reverted" && item.result)
              item.result.status = "0x0";
          }
        await route.fulfill({
          response,
          json: Array.isArray(json) ? items : items[0],
        });
      },
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => results.errors.push(e.message));
    await page.goto(url);
    const status = page.locator(".transaction-status");
    if (initialMode === "pending") {
      await status.filter({ hasText: "pending" }).waitFor({ timeout: 10000 });
      await page
        .getByRole("button", { name: "Check receipt", exact: true })
        .click();
      assert.ok(
        await page.evaluate(() => localStorage.getItem("unlk-pending")),
      );
      await page.reload();
      await status.filter({ hasText: "pending" }).waitFor({ timeout: 10000 });
      results.checks.push(
        "Stored pending receipt survives reload and exposes a manual check without any send/sign request",
      );
      mode = "live";
      await status.filter({ hasText: "confirmed" }).waitFor({ timeout: 45000 });
      assert.match(await status.innerText(), /Confirmed in two blocks/);
      results.checks.push(
        "Recovered existing successful receipt reaches confirmed and clears pending storage",
      );
    } else {
      await status.filter({ hasText: "reverted" }).waitFor({ timeout: 30000 });
      assert.match(
        await status.innerText(),
        /Gas was spent; the action did not complete/,
      );
      results.checks.push(
        "Explicit reverted receipt fixture produces a reverted status and gas-spent explanation",
      );
    }
    assert.equal(
      await page.evaluate(() => localStorage.getItem("unlk-pending")),
      null,
    );
    assert.ok(methods.has("eth_getTransactionReceipt"));
    assert.ok([...methods].every((m) => !/send|sign/i.test(m)));
    await context.close();
  }
} catch (e) {
  results.errors.push(e.stack || String(e));
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(
    "artifacts/recovery-validation.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results, null, 2));
}
