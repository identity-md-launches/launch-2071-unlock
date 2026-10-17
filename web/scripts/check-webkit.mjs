import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { webkit } = await import(process.env.IMD_PLAYWRIGHT || "playwright");
process.chdir(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const root = path.resolve("dist");
fs.mkdirSync("artifacts/screenshots", { recursive: true });
const report = {
  checkedAt: new Date().toISOString(),
  pages: [],
  checks: [],
  errors: [],
  transport:
    "WebKit test HTTPS requests are forwarded by Node to the real public read endpoints because this runtime’s direct TLS requests fail access-control checks. No response values are fabricated.",
};
const server = http.createServer((req, res) => {
  const file = path.resolve(
    root,
    decodeURIComponent(req.url.split("?")[0]).replace(/^\/preview\//, "") ||
      "index.html",
  );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (e, data) => {
    if (e) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type":
        {
          ".html": "text/html",
          ".css": "text/css",
          ".js": "text/javascript",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
          ".json": "application/json",
          ".png": "image/png",
        }[path.extname(file)] || "text/plain",
    });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
let browser;
try {
  browser = await webkit.launch({ headless: true, timeout: 15000 });
  for (const width of [390, 320, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 600 ? 844 : 900 },
      hasTouch: width < 600,
      reducedMotion: "reduce",
    });
    await context.route(
      /https:\/\/(ethereum-sepolia-rpc\.publicnode\.com|rpc\.sepolia\.ethpandaops\.io|sepolia\.rpc\.sentio\.xyz|api\.imd\.fun)\//,
      async (route) => {
        const request = route.request();
        try {
          const response = await fetch(request.url(), {
            method: request.method(),
            headers: { "content-type": "application/json" },
            ...(request.postData() ? { body: request.postData() } : {}),
          });
          await route.fulfill({
            status: response.status,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: await response.text(),
          });
        } catch {
          await route.abort();
        }
      },
    );
    const page = await Promise.race([
      context.newPage(),
      new Promise((_, j) =>
        setTimeout(() => j(Error("WebKit page initialization timeout")), 15000),
      ),
    ]);
    page.on("pageerror", (e) => report.errors.push(e.message));
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      font: document.fonts.check('14px "JetBrains Mono"'),
      actionBottom: document
        .querySelector(".connect-trade")
        .getBoundingClientRect().bottom,
    }));
    report.pages.push(info);
    assert.ok(info.scroll <= width);
    assert.equal(info.font, true);
    if (width === 390) assert.ok(info.actionBottom <= 844);
    await page
      .getByRole("button", {
        name: "$500K: 55% of eligible acquisitions",
        exact: true,
      })
      .click();
    assert.match(await page.locator(".ladder-readout").innerText(), /\$500K/);
    await page.locator(".header-actions button").click();
    assert.equal(await page.getByRole("dialog").isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").isVisible(), false);
    await page.getByRole("button", { name: "Sell UNLK", exact: true }).click();
    await page.locator("#trade-amount").fill("1.25");
    await page.locator("#slippage").selectOption("100");
    assert.match(await page.locator(".settlement-note").innerText(), /credit/);
    await page.getByRole("button", { name: "Buy UNLK", exact: true }).click();
    await page.evaluate(() => scrollTo(0, 0));
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `artifacts/screenshots/unlk-webkit-${width}.png`,
      });
    report.checks.push(
      `${width}px: reflow, local font, chart selection, wallet dialog/Escape, Sell input/slippage/credit explanation`,
    );
    await context.close();
  }
} catch (e) {
  report.errors.push(e.stack || String(e));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  fs.writeFileSync(
    "artifacts/webkit-validation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
