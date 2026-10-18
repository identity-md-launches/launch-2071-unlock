import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Read-only production regression. Dependencies and browsers may live outside the repo.
const { chromium } = await import(process.env.IMD_PLAYWRIGHT ?? "playwright");
const run = promisify(execFile);
const root = path.resolve(new URL("../../", import.meta.url).pathname);
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const rpcEndpoint = argument("--rpc", "https://ethereum-rpc.publicnode.com");
const reproduce = process.argv.includes("--reproduce");
const output = path.resolve(argument("--out", "test/scratch/chart-error"));
fs.mkdirSync(output, { recursive: true });
const report = {
  mode: reproduce ? "before-fix reproduction" : "regression",
  source: "https://ethereum-rpc.publicnode.com",
  rpcWrites: 0,
  viewports: [],
  pageErrors: [],
  missingLocalAssets: [],
};
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const file = path.resolve(root, "dist", url.pathname.slice("/preview/".length) || "index.html");
  if (!url.pathname.startsWith("/preview/") || !file.startsWith(path.join(root, "dist") + path.sep)) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] ?? "application/octet-stream" });
    response.end(fs.readFileSync(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const site = `http://127.0.0.1:${server.address().port}/preview/`;
const allowed = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_getBalance", "eth_getLogs"]);
async function rpc(row) {
  if (!allowed.has(row.method)) {
    report.rpcWrites++;
    throw Error("Regression forbids signing and write methods");
  }
  const body = JSON.stringify(row);
  if (process.argv.includes("--proxy")) {
    const { stdout } = await run("curl", ["-x", process.env.HTTP_PROXY ?? "", "--noproxy", "", "-sS", "--max-time", "30", "-H", "content-type: application/json", "--data", body, rpcEndpoint], { maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(stdout);
  }
  return fetch(rpcEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(30000) }).then((r) => r.json());
}
async function measure(page) {
  return page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    alert: document.querySelector(".price-chart .notice.error").innerText,
    overflowWrap: getComputedStyle(document.querySelector(".price-chart .notice.error")).overflowWrap,
  }));
}
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
    let failLogs = true;
    let failedLogs = 0;
    const endpoints = new Set();
    await context.route(/https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)\/?/, async (route) => {
      const body = route.request().postDataJSON();
      const rows = Array.isArray(body) ? body : [body];
      const values = await Promise.all(rows.map(async (row) => {
        if (row.method === "eth_getLogs" && failLogs) {
          failedLogs++;
          endpoints.add(new URL(route.request().url()).hostname);
          return { jsonrpc: "2.0", id: row.id, error: { code: -32000, message: "Controlled history RPC failure" } };
        }
        return rpc(row);
      }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? values : values[0]) });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.url().startsWith(site) && !response.ok()) report.missingLocalAssets.push(response.url().slice(site.length));
    });
    await page.goto(site);
    await page.getByRole("tab", { name: "Price chart", exact: true }).click();
    const alert = page.locator(".price-chart .notice.error");
    await alert.waitFor({ timeout: 60000 });
    const cold = await measure(page);
    const result = { width, cold, failedRpcHosts: [...endpoints] };
    report.viewports.push(result);
    assert(endpoints.has("ethereum-rpc.publicnode.com") && endpoints.has("eth.drpc.org"));
    if (reproduce) {
      assert(cold.scrollWidth > cold.clientWidth, "Reported overflow must reproduce before editing source");
      assert.match(cold.alert, /Request body:/);
    } else {
      assert.equal(cold.scrollWidth, cold.clientWidth);
      assert.match(cold.alert, /^History unavailable\. Retrying in 30s\./);
      assert.doesNotMatch(cold.alert, /Request body:|Controlled history|viem|eth_getLogs/);
      assert.equal(cold.overflowWrap, "anywhere");
      // Stress the same alert with an intact address and official PoolId, without clipping.
      result.longDiagnostics = await alert.evaluate((element) => {
        const original = [...element.childNodes];
        const text = "0xFe44fC8F6C32f681a0ce443902a0b08bB5B3C736 0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32";
        element.textContent = text;
        const measurement = { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, textIntact: element.textContent === text, overflowX: getComputedStyle(element).overflowX, textOverflow: getComputedStyle(element).textOverflow };
        element.replaceChildren(...original);
        return measurement;
      });
      assert.equal(result.longDiagnostics.scrollWidth, result.longDiagnostics.clientWidth);
      assert(result.longDiagnostics.textIntact);
      assert.equal(result.longDiagnostics.overflowX, "visible");
      assert.notEqual(result.longDiagnostics.textOverflow, "ellipsis");
      const beforeRetry = failedLogs;
      await page.getByRole("button", { name: "Retry chart", exact: true }).focus();
      await page.keyboard.press("Enter");
      await alert.waitFor({ state: "hidden" });
      await alert.waitFor({ timeout: 60000 });
      assert(failedLogs > beforeRetry);
      assert.equal((await measure(page)).scrollWidth, width);
      result.keyboardRetry = true;
      failLogs = false;
      await page.getByRole("button", { name: "Retry chart", exact: true }).click();
      await page.locator(".price-plot").waitFor({ timeout: 60000 });
      assert.equal(await alert.count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      result.recovered = true;
      failLogs = true;
      await page.getByRole("tab", { name: "Unlock ladder", exact: true }).click();
      await page.getByRole("tab", { name: "Price chart", exact: true }).click();
      await alert.waitFor({ timeout: 60000 });
      result.stale = await measure(page);
      assert.equal(result.stale.scrollWidth, width);
      assert.match(result.stale.alert, /Previous data retained with its original block and timestamp/);
      assert.match(await page.locator(".chart-freshness").innerText(), /Stale/);
      assert(await page.locator(".price-plot").isVisible());
    }
    await page.locator(".price-chart").screenshot({ path: path.join(output, `chart-error-${width}.png`) });
    console.log(`${width}px: client ${cold.clientWidth}, scroll ${cold.scrollWidth}; ${reproduce ? "overflow reproduced" : "cold/retry/recovered/stale passed"}`);
    await context.close();
  }
  assert.equal(report.rpcWrites, 0);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.missingLocalAssets, []);
  report.passed = true;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
}
