// Runs against the committed production export. HTTP service and holder sessions
// are simulated; public snapshots are the actual included observations.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.IMD_PLAYWRIGHT || "playwright");
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exportDirectory = path.join(repository, "dist");
const evidenceDirectory = path.join(repository, "test/scratch/labs-browser");
await fs.mkdir(evidenceDirectory, { recursive: true });
const markets = JSON.parse(await fs.readFile(path.join(exportDirectory, "labs/markets.json"), "utf8"));
const radar = JSON.parse(await fs.readFile(path.join(exportDirectory, "labs/radar.json"), "utf8"));
const report = { scope: "Production export under /preview/. Public snapshots are actual observations; service/auth responses are simulated. No wallet signing, token approvals, payments or paid jobs.", checks: [], consoleErrors: [], resourceFailures: [], screenshots: [], axe: [], limitations: [] };
let configured = false, rejectProtected = 0, stale = false, missing = false, failPublic = false, warming = false;
let savedAddresses = [];
const protectedRequests = [];
const publicAccount = "0xFe44fC8F6C32f681a0ce443902a0b08bB5B3C736";
const mockToken = "simulated-holder-session";
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const send = (status, value, contentType = "application/json") => { response.writeHead(status, { "Content-Type": contentType }); response.end(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
    if (url.pathname === "/preview/labs-config.json") return send(200, { apiBase: configured ? `http://127.0.0.1:${server.address().port}/test-api` : "" });
    if (url.pathname === "/test-api/auth/session") return send(200, { authenticated: true, address: publicAccount, eligible: true, expiresAt: Date.now() + 3_600_000, unlkBalance: "1" });
    if (url.pathname.startsWith("/test-api/holder/")) {
      protectedRequests.push({ path: url.pathname, method: request.method, authorized: request.headers.authorization === `Bearer ${mockToken}` });
      if (rejectProtected) return send(rejectProtected, { error: "Simulated session refusal" });
      if (request.headers.authorization !== `Bearer ${mockToken}`) return send(401, { error: "Unauthorized" });
      if (url.pathname.endsWith("/export")) return send(200, "symbol,priceUsd\nIMD,5.41\n", "text/csv");
      if (url.pathname.endsWith("/watchlist")) {
        if (request.method === "PUT") { let body = ""; for await (const part of request) body += part; savedAddresses = JSON.parse(body).addresses; }
        return send(200, { addresses: savedAddresses });
      }
      if (url.pathname.endsWith("/markets")) {
        const all = [markets.featured, ...markets.markets].filter(Boolean);
        let rows = url.searchParams.has("addresses") ? all.filter((market) => url.searchParams.get("addresses").split(",").includes(market.address)) : [...markets.markets];
        const key = { volume: "volume24h", liquidity: "liquidityUsd", change: "priceChange24h" }[url.searchParams.get("sort")];
        if (key) rows.sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity));
        return send(200, { markets: rows });
      }
    }
    if (url.pathname === "/test-api/markets") {
      if (failPublic) return send(503, { error: "Simulated provider outage" });
      if (warming) return send(200, { mode: "warming", chainId: 1, updatedAt: null, featured: null, markets: [], coverage: { notes: ["The indexer has not completed its first scan."] }, errors: [] });
      const rows = markets.markets.map((market, index) => missing && index === 0 ? { ...market, priceUsd: null, volume24h: null, liquidityUsd: null, fdv: null, chart: [] } : market);
      return send(200, { ...markets, markets: rows, mode: "cached", updatedAt: stale ? "2020-01-01T00:00:00Z" : new Date().toISOString() });
    }
    if (url.pathname === "/test-api/radar") {
      if (failPublic) return send(503, { error: "Simulated provider outage" });
      const period = url.searchParams.get("period") || "24h";
      if (warming) return send(200, { mode: "warming", period, updatedAt: null, coverage: { fromBlock: null, toBlock: null, fromTime: null, toTime: null, missingHistory: true, notes: ["The indexer has not completed its first scan."] }, pools: [], events: [], wallets: [], nextCursor: null, errors: [] });
      const duration = { "1h": 3600, "24h": 86400, "7d": 604800 }[period];
      const offset = Number(url.searchParams.get("cursor") || 0);
      const events = radar.events.filter((event) => event.time >= radar.coverage.toTime - duration);
      return send(200, { ...radar, mode: "cached", period, updatedAt: new Date().toISOString(), events: events.slice(offset, offset + 100), nextCursor: offset + 100 < events.length ? String(offset + 100) : null });
    }
    if (!url.pathname.startsWith("/preview/")) return send(404, "Not found", "text/plain");
    const relative = decodeURIComponent(url.pathname.slice("/preview/".length)) || "index.html";
    const filename = path.resolve(exportDirectory, relative);
    if (!filename.startsWith(exportDirectory + path.sep)) return send(403, "Forbidden", "text/plain");
    return send(200, await fs.readFile(filename), mime[path.extname(filename)] || "application/octet-stream");
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const contexts = [];
const observe = (page) => {
  page.on("pageerror", (error) => report.consoleErrors.push(error.message));
  page.on("requestfailed", (request) => { if (request.url().startsWith(origin) && !request.failure()?.errorText.includes("ABORTED")) report.resourceFailures.push(request.url()); });
};
const shot = async (page, name) => { const file = path.join(evidenceDirectory, name); await page.screenshot({ path: file }); report.screenshots.push(path.relative(repository, file)); };
const waitMarkets = (page) => page.locator(".lab-market-list > li").first().waitFor();
const noOverflow = async (page, name) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow at ${width}px`);
  }
  report.checks.push(`${name}: no page overflow at 320, 390, 768 and 1440 CSS pixels`);
};
try {
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(publicContext);
  const page = await publicContext.newPage(); observe(page);
  await page.goto(`${origin}/preview/#labs-markets`);
  await waitMarkets(page);
  await shot(page, "markets-390.png");
  const heading = await page.getByRole("heading", { name: "UNLOCK LABS", exact: true }).boundingBox();
  const action = await page.getByRole("button", { name: "Refresh markets", exact: true }).boundingBox();
  const featured = await page.locator(".lab-featured h3").boundingBox();
  assert(heading && heading.y < 844 && action && action.y + action.height <= 844, "Markets product and primary action must be above fold");
  assert(featured && featured.y < 844, "Featured real market must start on first 390px screen");
  report.checks.push("390×844 Markets shows product, Refresh action and actual featured IMD on the first screen");
  assert.equal(await page.getByRole("button", { name: "Export market CSV" }).isDisabled(), true);
  await page.getByRole("searchbox", { name: "Find a launch" }).fill("UNLK");
  assert.equal(await page.locator(".lab-market-list > li").count(), 1);
  await page.getByRole("searchbox", { name: "Find a launch" }).fill("nonexistent-launch");
  await page.getByText("No launches match these filters.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear filters and refresh" }).click();
  await waitMarkets(page);
  await page.getByRole("combobox", { name: "Minimum liquidity", exact: true }).selectOption("10000");
  const expectedLiquid = markets.markets.filter((market) => market.liquidityUsd != null && market.liquidityUsd >= 10000 && market.address !== markets.featured?.address).length;
  assert.equal(await page.locator(".lab-market-list > li").count(), expectedLiquid);
  await page.getByRole("combobox", { name: "Minimum liquidity", exact: true }).selectOption("0");
  await page.getByRole("combobox", { name: "Minimum age", exact: true }).selectOption("168");
  const expectedOlder = markets.markets.filter((market) => market.createdAt && Date.now() - Date.parse(market.createdAt) >= 168 * 3_600_000 && market.address !== markets.featured?.address).length;
  assert.equal(await page.locator(".lab-market-list > li").count(), expectedOlder);
  await page.getByRole("combobox", { name: "Minimum age", exact: true }).selectOption("0");
  await page.locator(".lab-featured summary").first().click();
  await page.getByText("Historical chart unavailable for this pool. A current quote alone is not a price history.", { exact: true }).first().waitFor();
  assert.equal(await page.locator(".lab-featured .lab-source-list a").first().getAttribute("href"), `https://etherscan.io/token/${markets.featured.address}`);
  report.checks.push("Actual snapshot search, empty-state recovery, liquidity/age filters, token details and missing chart disclosure work; holder export stays locked offline");
  await noOverflow(page, "Markets");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Radar", exact: true }).click();
  await page.locator(".lab-event").first().waitFor();
  await shot(page, "radar-390.png");
  const firstEvent = await page.locator(".lab-event").first().boundingBox();
  assert(firstEvent && firstEvent.y < 844, "Actual Radar activity must start on first 390px screen");
  await page.getByRole("combobox", { name: "Event type", exact: true }).selectOption("all");
  assert.equal(await page.locator(".lab-event").count(), Math.min(100, radar.events.length));
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.getByText("Page 2", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  const plain = radar.events.filter((event) => event.type === "transfer" && !["swap", "liquidity"].includes(event.relatedActivity));
  const settlements = radar.events.filter((event) => event.type === "transfer" && ["swap", "liquidity"].includes(event.relatedActivity));
  await page.getByRole("combobox", { name: "Event type", exact: true }).selectOption("transfers");
  assert.equal(await page.locator(".lab-event").count(), Math.min(100, plain.length));
  assert((await page.locator(".lab-event-kind").allTextContents()).every((text) => text === "Transfer"));
  await page.getByRole("combobox", { name: "Event type", exact: true }).selectOption("settlements");
  assert.equal(await page.locator(".lab-event").count(), Math.min(100, settlements.length));
  assert((await page.locator(".lab-event-kind").allTextContents()).every((text) => text.includes("settlement")));
  await page.getByRole("combobox", { name: "Observation period", exact: true }).selectOption("1h");
  await page.getByRole("combobox", { name: "Event type", exact: true }).selectOption("swaps");
  await page.locator(".lab-event").first().waitFor();
  await page.getByText("Unavailable for this snapshot period", { exact: true }).first().waitFor();
  await page.getByText("Incomplete history: index limits can omit activity within this period.", { exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Observation period", exact: true }).selectOption("7d");
  await page.getByText("Partial 7d: earlier history is missing.", { exact: true }).waitFor();
  report.checks.push(`Radar real snapshot: ${plain.length} plain transfers and ${settlements.length} swap/liquidity settlements remain distinct; local pagination, periods and partial-history/unsupported-period flow messages work`);
  await noOverflow(page, "Radar");
  try {
    const { default: AxeBuilder } = await import(process.env.IMD_AXE || "@axe-core/playwright");
    const result = await new AxeBuilder({ page }).include(".labs-root").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    report.axe = result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, description: violation.description, nodes: violation.nodes.map((node) => node.target) }));
    assert.equal(result.violations.length, 0, "Resolve automated accessibility findings in Radar");
    report.checks.push("Radar automated axe WCAG A/AA scan reports no violations in the Labs surface");
  } catch (error) {
    if (report.axe.length) throw error;
    report.limitations.push(`Axe scan unavailable: ${error.message}`);
  }
  configured = true;
  const holderContext = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }); contexts.push(holderContext);
  await holderContext.addInitScript(({ address, token }) => {
    localStorage.setItem("unlk-mainnet-wallet", "io.unlock.labs.test");
    sessionStorage.setItem("unlock-labs-session-v1", JSON.stringify({ token, eligible: true, address, expiresAt: Date.now() + 3_600_000 }));
    const provider = { request: async ({ method }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
      if (method === "eth_chainId") return "0x1";
      throw Error(`This read-only test provider refuses ${method}`);
    }, on() {}, removeListener() {} };
    window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: "labs-test-provider", name: "Read-only Labs test wallet", rdns: "io.unlock.labs.test", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" }, provider } })));
  }, { address: publicAccount, token: mockToken });
  const holder = await holderContext.newPage(); observe(holder);
  await holder.goto(`${origin}/preview/#labs-markets`);
  await holder.getByText("UNLK holder", { exact: true }).waitFor();
  await holder.getByRole("button", { name: "Apply ranking" }).click();
  await holder.getByText("Holder ranking loaded after a server balance check.", { exact: true }).waitFor();
  const cards = holder.locator(".lab-market-card");
  await cards.nth(0).locator("summary").first().click();
  await cards.nth(1).locator("summary").first().click();
  await cards.nth(0).getByRole("checkbox").check();
  await cards.nth(1).getByRole("checkbox").check();
  await holder.getByRole("button", { name: "Compare selected (2/4)" }).click();
  await holder.locator(".lab-comparison tbody tr").nth(1).waitFor();
  assert.equal(await holder.locator(".lab-comparison tbody tr").count(), 2);
  await cards.nth(0).getByRole("button", { name: "Add to watchlist" }).click();
  await holder.getByText("Watchlist saved to your wallet session on the server.", { exact: true }).waitFor();
  assert.equal(savedAddresses.length, 1);
  const marketDownload = holder.waitForEvent("download");
  await holder.getByRole("button", { name: "Export market CSV" }).click();
  assert.match((await marketDownload).suggestedFilename(), /^unlock-labs-markets-.*\.csv$/);
  rejectProtected = 401;
  await holder.getByRole("button", { name: "Apply ranking" }).click();
  await holder.getByText("Your login expired. Sign in again to continue.", { exact: true }).waitFor();
  rejectProtected = 403;
  await holder.getByRole("button", { name: "Apply ranking" }).click();
  await holder.getByText("Holder access needs a positive UNLK balance on Ethereum. Refresh your login after checking your balance.", { exact: true }).waitFor();
  rejectProtected = 0; stale = true; missing = true;
  await holder.getByRole("button", { name: "Refresh markets", exact: true }).click();
  await holder.getByText("Stale observation · more than 15 minutes old.", { exact: true }).waitFor();
  assert.equal(await holder.locator(".lab-market-list .lab-market-price strong").first().innerText(), "Unavailable");
  failPublic = true;
  await holder.getByRole("button", { name: "Refresh markets", exact: true }).click();
  await holder.getByText(/Backend unavailable.*Showing the bundled snapshot/).waitFor();
  failPublic = false;
  await holder.getByRole("link", { name: "Radar", exact: true }).click();
  await holder.locator(".lab-event").first().waitFor();
  // The protected filter becomes checked only after the server balance check.
  await holder.getByRole("checkbox", { name: "Show saved wallets only", exact: true }).click();
  await holder.getByText("Saved wallet filter applied after a server balance check.", { exact: true }).waitFor();
  assert.equal(await holder.getByRole("checkbox", { name: "Show saved wallets only", exact: true }).isChecked(), true);
  const radarDownload = holder.waitForEvent("download");
  await holder.getByRole("button", { name: "Export radar CSV" }).click();
  assert.match((await radarDownload).suggestedFilename(), /^unlock-labs-radar-.*\.csv$/);
  warming = true;
  await holder.goto(`${origin}/preview/#labs-markets`);
  await holder.getByText("Indexer warming; no live readings are available yet.", { exact: true }).waitFor();
  assert.equal(await holder.getByText(/Backend unavailable/).count(), 0);
  assert.equal(await holder.locator(".lab-market-card").count(), 0);
  await holder.getByRole("link", { name: "Radar", exact: true }).click();
  await holder.getByText("Indexer warming; no live readings are available yet.", { exact: true }).waitFor();
  assert.equal(await holder.getByText(/Backend unavailable/).count(), 0);
  assert.equal(await holder.locator(".lab-event").count(), 0);
  await holder.getByText("Incomplete history: index limits can omit activity within this period.", { exact: true }).waitFor();
  assert(protectedRequests.length > 0 && protectedRequests.every((request) => request.authorized));
  report.checks.push("Simulated protected service: Bearer-authenticated advanced ranking, two-token comparison, saved addresses, wallet filter, market/Radar CSV downloads, expired401, balance403, stale/missing metrics and public service-outage snapshot fallback");
  report.checks.push("Healthy warming responses with null timestamps stay distinct from backend outages; neither Markets nor Radar fabricates initial readings, and missing-history warnings remain visible inside the nominal1h interval");
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.resourceFailures, []);
  report.limitations.push("Service responses and wallet/session restoration in this test are simulated. No hosted backend, real wallet signature or onchain balance verification is established by this browser check.", "Axe is an automated scan, not a screen-reader session. Physical phones and browser-native 200% zoom were not tested here.");
  report.protectedRequests = protectedRequests;
  await fs.writeFile(path.join(evidenceDirectory, "markets-radar-results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error.message;
  await fs.writeFile(path.join(evidenceDirectory, "markets-radar-results.json"), JSON.stringify(report, null, 2));
  throw error;
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
