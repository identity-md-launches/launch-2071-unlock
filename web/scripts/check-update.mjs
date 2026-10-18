import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const { chromium, webkit } = await import(
  process.env.IMD_PLAYWRIGHT ?? "playwright"
);
const { default: AxeBuilder } = await import(
  process.env.IMD_AXE_MODULE ?? "@axe-core/playwright"
);
const run = promisify(execFile);
const root = path.resolve(new URL("../../", import.meta.url).pathname);
const rpcEndpoint = process.argv[2] ?? "https://ethereum-rpc.publicnode.com";
const report = {
  evidence:
    "Production export at /preview/ with fresh read-only mainnet RPC reads; controlled failures and a read-only injected test wallet. No signed or broadcast transactions.",
  checks: [],
  errors: [],
  resourceFailures: [],
  limitations: [],
  rpcWrites: 0,
  viewports: [],
};
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (!url.pathname.startsWith("/preview/")) {
    response.writeHead(404).end();
    return;
  }
  let file = path.resolve(
    root,
    "dist",
    decodeURIComponent(url.pathname.slice(9)) || "index.html",
  );
  if (!file.startsWith(path.join(root, "dist") + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    const bytes = fs.readFileSync(file);
    response.writeHead(200, {
      "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const site = `http://127.0.0.1:${server.address().port}/preview/`;
const allowed = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_call",
  "eth_getBalance",
  "eth_getLogs",
  "eth_gasPrice",
  "eth_estimateGas",
  "eth_getTransactionCount",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
]);
let id = 0;
async function rpc(method, params = []) {
  if (!allowed.has(method)) {
    report.rpcWrites++;
    throw Error("Test forbids all signing and write methods: " + method);
  }
  const body = JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params });
  let value;
  if (process.argv.includes("--proxy")) {
    const { stdout } = await run(
      "curl",
      [
        "-x",
        process.env.HTTP_PROXY ?? "",
        "--noproxy",
        "",
        "-sS",
        "--max-time",
        "30",
        "-H",
        "content-type: application/json",
        "--data",
        body,
        rpcEndpoint,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    value = JSON.parse(stdout);
  } else
    value = await fetch(rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(30000),
    }).then((r) => r.json());
  if (value.error)
    throw Object.assign(Error(value.error.message), {
      code: value.error.code,
      data: value.error.data,
    });
  return value.result;
}
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  let failLogs = false,
    emptyLogs = false,
    failInventory = false,
    failReads = false;
  const methods = [];
  const logRanges = [];
  let inventoryRequests = [];
  await context.route(
    /https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)\/?/,
    async (route) => {
      const body = route.request().postDataJSON();
      const rows = Array.isArray(body) ? body : [body];
      const values = await Promise.all(
        rows.map(async (row) => {
          methods.push(row.method);
          try {
            if (failReads) throw Error("Controlled mainnet read failure");
            if (row.method === "eth_getLogs") {
              if (failLogs) throw Error("Controlled history failure");
              logRanges.push(row.params[0]);
              if (emptyLogs) return { jsonrpc: "2.0", id: row.id, result: [] };
            }
            return {
              jsonrpc: "2.0",
              id: row.id,
              result: await rpc(row.method, row.params),
            };
          } catch (e) {
            return {
              jsonrpc: "2.0",
              id: row.id,
              error: {
                code: e.code ?? -32000,
                message: e.message,
                data: e.data,
              },
            };
          }
        }),
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(Array.isArray(body) ? values : values[0]),
      });
    },
  );
  await context.route("https://eth.blockscout.com/**", async (route) => {
    inventoryRequests.push(route.request().url());
    if (failInventory)
      return route.fulfill({ status: 503, body: "Controlled indexer failure" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"items":[],"next_page_params":null}',
    });
  });
  // A test-only EIP-6963 provider: account discovery/chain switching only, never a signer.
  await context.addInitScript(() => {
    let chain = "0x1";
    const handlers = {};
    const account = "0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9";
    const provider = {
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts")
          return [account];
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") {
          chain = params[0].chainId;
          (handlers.chainChanged ?? []).forEach((f) => f(chain));
          return null;
        }
        throw Object.assign(Error("Read-only test wallet refuses signing"), {
          code: 4001,
        });
      },
      on: (event, fn) => {
        (handlers[event] ??= []).push(fn);
      },
      removeListener: (event, fn) => {
        handlers[event] = (handlers[event] ?? []).filter((f) => f !== fn);
      },
    };
    window.testWallet = {
      chain: (value) => {
        chain = value;
        (handlers.chainChanged ?? []).forEach((f) => f(value));
      },
      account: (value) => {
        (handlers.accountsChanged ?? []).forEach((f) => f([value]));
      },
    };
    addEventListener("eip6963:requestProvider", () =>
      dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: "read-only-update-test",
              name: "Read-only test wallet",
              icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
              rdns: "test.readonly",
            },
            provider,
          },
        }),
      ),
    );
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("requestfailed", (r) => {
    if (r.url().startsWith(site) && !r.failure()?.errorText.includes("ABORTED"))
      report.resourceFailures.push(r.url().replace(site, "/preview/"));
  });
  await page.goto(site);
  await page
    .getByText("Trading active", { exact: true })
    .waitFor({ timeout: 60000 });
  const cta = page.getByRole("button", {
    name: "Connect to trade",
    exact: true,
  });
  const box = await cta.boundingBox();
  assert(box && box.y + box.height < 844);
  await page.screenshot({
    path: path.join(root, "artifacts/terminal-mobile.jpg"),
    type: "jpeg",
    quality: 45,
  });
  report.checks.push(
    "390×844 first screen contains UNLK/IMD, amount field and complete Connect to trade action",
  );
  await cta.click();
  await page.getByRole("dialog", { name: "Connect a wallet" }).waitFor();
  await page.keyboard.press("Tab");
  assert(
    await page.evaluate(() =>
      document.querySelector("dialog[open]").contains(document.activeElement),
    ),
  );
  await page.keyboard.press("Escape");
  assert(await cta.evaluate((el) => el === document.activeElement));
  report.checks.push(
    "Connect dialog traps focus; Escape closes and restores trigger focus",
  );
  await page.getByRole("button", { name: "Sell UNLK", exact: true }).click();
  assert(
    await page
      .getByRole("textbox", { name: "You pay UNLK", exact: true })
      .isVisible(),
  );
  await page
    .getByRole("textbox", { name: "You pay UNLK", exact: true })
    .fill("0.000000000000000001");
  await page.getByRole("button", { name: "Buy UNLK", exact: true }).click();
  assert(
    await page
      .getByRole("textbox", { name: "You pay IMD", exact: true })
      .isVisible(),
  );
  report.checks.push(
    "Existing buy/sell direction, labels and 18-decimal input work before wallet signing",
  );
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Read-only test wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Get live quote", exact: true })
    .waitFor({ timeout: 60000 });
  await page
    .getByRole("textbox", { name: "You pay IMD", exact: true })
    .fill("0.01");
  await page
    .getByRole("button", { name: "Get live quote", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Quote ready", exact: true })
    .waitFor({ timeout: 60000 });
  assert.match(await page.locator(".quote-details").innerText(), /IMD/);
  report.checks.push(
    "Read-only EIP-6963 account connection and real mainnet quoter return a fee-aware live buy quote",
  );
  await page.evaluate(() => window.testWallet.chain("0xaa36a7"));
  await page
    .locator("#trade")
    .getByRole("button", { name: "Switch to Ethereum", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Switch to Ethereum", exact: true })
      .count(),
    2,
  );
  await page
    .locator("#trade")
    .getByRole("button", { name: "Switch to Ethereum", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Get live quote", exact: true })
    .waitFor({ timeout: 60000 });
  report.checks.push(
    "Wrong network invalidates quote and offers chain-1 switching without sending a transaction",
  );
  await page.getByRole("link", { name: "My Unlock", exact: true }).click();
  for (const label of [
    "Claim native UNLK",
    "Attest claim",
    "Sync reward credit",
    "Sync payer credit",
  ])
    assert(
      await page.getByRole("button", { name: label, exact: true }).isVisible(),
    );
  await page.locator("#rights details").last().locator("summary").click();
  const file = page.locator('input[type="file"]');
  await file.setInputFiles({
    name: "bad-proof.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"wallet":"invalid"}'),
  });
  await page
    .getByText(
      "Proof must match your connected account and the onchain round-0 root.",
      { exact: true },
    )
    .waitFor();
  report.checks.push(
    "Claim/attest/reward sync/payer sync controls retained; malformed proof import reports an error",
  );
  // Disconnect, then check all public surfaces without a wallet.
  await page.getByRole("button", { name: /Disconnect/ }).click();
  await page.getByRole("link", { name: "Milestones", exact: true }).click();
  for (let i = 0; i <= 16; i++) {
    await page.locator("#gate-select").selectOption(String(i));
    assert.match(
      await page.locator(".ladder-readout").innerText(),
      new RegExp(`${20 + i * 5}% allowance`),
    );
  }
  await page.screenshot({
    path: path.join(root, "artifacts/terminal-mobile-ladder.jpg"),
    type: "jpeg",
    quality: 45,
  });
  report.checks.push(
    "All initial + sixteen ladder scenarios remain selectable; scenario selection does not alter confirmed onchain tier",
  );
  await page.getByRole("tab", { name: "Unlock ladder", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert(
    await page
      .getByRole("tab", { name: "Price chart", exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await page.locator(".price-plot").waitFor({ timeout: 90000 });
  assert(logRanges.length > 0);
  for (const range of logRanges) {
    assert.equal(
      range.address.toLowerCase(),
      "0x000000000004444c5dc75cb358380d2e3de08a90",
    );
    assert.equal(
      range.topics[1],
      "0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32",
    );
  }
  const initialVolumeBars = await page.locator(".price-plot rect").count();
  assert(initialVolumeBars > 0);
  await page.getByRole("button", { name: "Candles", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Candles", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByLabel("Candle interval", { exact: true }).selectOption("60");
  await page.getByLabel("Inspect candle", { exact: true }).fill("0");
  assert.match(
    await page.locator(".chart-tooltip").innerText(),
    /UTC.*bucket/s,
  );
  assert.match(
    await page.locator(".chart-tooltip").innerText(),
    /IMD executed/,
  );
  const svg = page.locator(".price-plot");
  await svg.scrollIntoViewIfNeeded();
  const r = await svg.boundingBox();
  await page.touchscreen.tap(r.x + r.width / 2, r.y + 100);
  assert(await page.locator(".crosshair").count());
  const observedClock = (
    await page.locator(".chart-freshness").innerText()
  ).match(/(\d{2}:\d{2}):\d{2} UTC$/);
  assert(observedClock);
  assert.equal(
    await svg.locator("text").last().textContent(),
    observedClock[1],
  );
  const before = await svg.locator("text").allTextContents();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.notDeepEqual(await svg.locator("text").allTextContents(), before);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await svg.scrollIntoViewIfNeeded();
  const touchBox = await svg.boundingBox();
  const touchY = touchBox.y + 100;
  const touchX = touchBox.x + touchBox.width / 2;
  const cdp = await context.newCDPSession(page);
  const touchBefore = await svg.locator("text").allTextContents();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: touchX - 30, y: touchY, id: 1 },
      { x: touchX + 30, y: touchY, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: touchX - 60, y: touchY, id: 1 },
      { x: touchX + 60, y: touchY, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.notDeepEqual(await svg.locator("text").allTextContents(), touchBefore);
  const panBefore = await svg.locator("text").allTextContents();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchX - 30, y: touchY, id: 3 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: touchX + 30, y: touchY, id: 3 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.notDeepEqual(await svg.locator("text").allTextContents(), panBefore);
  await cdp.detach();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  for (const chartWidth of [320, 390, 1440]) {
    await page.setViewportSize({ width: chartWidth, height: 1000 });
    await page
      .getByLabel("Candle interval", { exact: true })
      .selectOption("3600");
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    );
    await page.locator(".price-chart").screenshot({
      path: path.join(root, `test/scratch/chart-${chartWidth}.png`),
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const chartAxe = await new AxeBuilder({ page }).analyze();
  report.axePriceChart = chartAxe.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
  }));
  assert.equal(chartAxe.violations.length, 0);
  report.checks.push(
    "Mobile two-finger pinch and single-finger pan change the time window; chart fits 320/390/1440 and has zero axe violations",
  );
  report.checks.push(
    "Price chart uses only official pool logs, observed OHLC, actual volume, UTC tooltips, interval/style controls, touch crosshair and time zoom",
  );
  await page.locator(".chart-data summary").click();
  const times = await page
    .locator(".history-table tbody tr td:first-child")
    .allTextContents();
  assert(times.length > 0 && times.every((t) => /2026-/.test(t)));
  const beforeRanges = logRanges.length;
  await page.waitForTimeout(16500);
  const incremental = logRanges
    .slice(beforeRanges)
    .filter((r) => BigInt(r.toBlock) - BigInt(r.fromBlock) < 100n);
  assert(incremental.length > 0);
  report.checks.push(
    "Automatic ~15s refresh requests incremental recent-block overlap; accessible trade rows show real calendar timestamps",
  );
  failLogs = true;
  await page.waitForTimeout(16500);
  await page.locator(".price-chart .notice.error").waitFor({ timeout: 45000 });
  assert(await svg.isVisible());
  assert.match(await page.locator(".chart-freshness").innerText(), /Stale/);
  failLogs = false;
  await page.getByRole("button", { name: "Retry chart", exact: true }).click();
  await page
    .locator(".price-chart .notice.error")
    .waitFor({ state: "hidden", timeout: 60000 });
  report.checks.push(
    "Chart RPC failure retains original snapshot, marks it stale, reports backoff and recovers on Retry",
  );
  emptyLogs = true;
  await page.getByRole("tab", { name: "Unlock ladder", exact: true }).click();
  await page.getByRole("tab", { name: "Price chart", exact: true }).click();
  await page
    .getByLabel("History coverage", { exact: true })
    .selectOption("10000");
  await page
    .getByText("No trades in this window", { exact: true })
    .waitFor({ timeout: 60000 });
  assert.match(await page.locator(".price-readout").innerText(), /No trades/);
  emptyLogs = false;
  await page
    .getByLabel("History coverage", { exact: true })
    .selectOption("2000");
  await page.locator(".price-plot").waitFor({ timeout: 60000 });
  report.checks.push(
    "Verified empty history has no candles and is labeled separately from price or RPC failure",
  );
  await page.getByRole("link", { name: "Treasury", exact: true }).click();
  assert.match(
    await page.locator("#treasury").innerText(),
    /redeem\(\).*withdraw\(\).*manual transfer/s,
  );
  assert(
    inventoryRequests.every((url) =>
      url.toLowerCase().includes("0xfe44fc8f6c32f681a0ce443902a0b08bb5b3c736"),
    ),
  );
  assert(
    await page.getByText("the treasury wallet ↗", { exact: true }).isVisible(),
  );
  failInventory = true;
  await page
    .getByRole("button", { name: "Refresh ownership", exact: true })
    .click();
  await page.locator(".nft-gallery .notice.error").waitFor();
  failInventory = false;
  await page
    .getByRole("button", { name: "Refresh ownership", exact: true })
    .click();
  await page
    .locator(".nft-gallery .notice.error")
    .waitFor({ state: "hidden", timeout: 60000 });
  report.checks.push(
    "NFT discovery uses new treasury exclusively; empty inventory, indexer error and refresh recovery are explicit",
  );
  for (const width of [320, 390, 768, 1000, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(site);
    await page
      .getByText("Trading active", { exact: true })
      .waitFor({ timeout: 60000 });
    assert(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    );
    report.viewports.push(width);
  }
  await page.screenshot({
    path: path.join(root, "artifacts/terminal-desktop.jpg"),
    type: "jpeg",
    quality: 45,
  });
  let audit = await new AxeBuilder({ page }).analyze();
  report.axeTerminal = audit.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
  }));
  assert.equal(audit.violations.length, 0);
  report.checks.push(
    "No horizontal page overflow at 320/390/768/1000/1440; terminal axe scan has zero violations",
  );
  await page.getByRole("link", { name: "Whitepaper", exact: true }).click();
  await page
    .getByRole("heading", { name: "UNLOCK whitepaper", exact: true })
    .waitFor();
  assert(page.url().endsWith("/preview/whitepaper/"));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    );
  }
  await page.evaluate(() => {
    window.__printed = false;
    window.print = () => {
      window.__printed = true;
    };
  });
  await page
    .getByRole("button", { name: "Print / Save as PDF", exact: true })
    .click();
  assert(await page.evaluate(() => window.__printed));
  await page.emulateMedia({ media: "print" });
  assert(await page.locator("#custody").isVisible());
  assert(await page.locator("#sources").isVisible());
  assert(
    !(await page
      .getByRole("button", { name: "Print / Save as PDF", exact: true })
      .isVisible()),
  );
  await page.pdf({
    path: path.join(root, "test/scratch/whitepaper.pdf"),
    format: "A4",
    printBackground: true,
  });
  await page.emulateMedia({ media: "screen" });
  audit = await new AxeBuilder({ page }).analyze();
  report.axeWhitepaper = audit.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
  }));
  assert.equal(audit.violations.length, 0);
  assert(
    await page.evaluate(
      () =>
        document.fonts.check('400 14px "JetBrains Mono"') &&
        document.fonts.check('600 20px "JetBrains Mono"'),
    ),
  );
  report.checks.push(
    "Standalone /whitepaper/ resolves at a static subpath, fits 320/390/1440, loads local fonts, opens print, exports matching PDF and has zero axe violations",
  );
  assert.equal(report.rpcWrites, 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.resourceFailures, []);
  try {
    const safari = await webkit.launch({ headless: true });
    const p = await safari.newPage({ viewport: { width: 390, height: 844 } });
    await p.goto(site + "whitepaper/");
    assert(
      await p.getByRole("heading", { name: "UNLOCK whitepaper" }).isVisible(),
    );
    await safari.close();
    report.checks.push("WebKit whitepaper mobile render");
  } catch (e) {
    report.limitations.push(
      "WebKit could not launch: missing host runtime libraries; physical iPhone/Safari behavior unverified.",
    );
  }
  report.limitations.push(
    "No real wallet signing, broadcasts, physical devices, screen reader session or browser-native 200% zoom. NFT indexer response is mocked empty for deterministic UI checks; separate fresh Blockscout/onchain evidence records actual empty treasury inventory. No historical USD conversion or all-time chart is claimed.",
  );
} catch (error) {
  report.failure = String(error.stack).replaceAll(root, "<repository>");
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  report.recordedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(root, "web/evidence/update-browser.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
