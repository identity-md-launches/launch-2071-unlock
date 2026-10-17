import { fileURLToPath } from "node:url";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.IMD_PLAYWRIGHT || "playwright");
const { AxeBuilder } = await import(
  process.env.UNLK_AXE_MODULE || "@axe-core/playwright"
);
process.chdir(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const root = path.resolve("dist");
fs.mkdirSync("artifacts/screenshots", { recursive: true });
fs.mkdirSync("test/scratch/browser", { recursive: true });
const results = {
  checkedAt: new Date().toISOString(),
  pages: [],
  interactions: [],
  errors: [],
  limitations: [],
};
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (!p.startsWith("/preview/")) {
    res.writeHead(404).end();
    return;
  }
  const f = path.resolve(root, p.slice("/preview/".length) || "index.html");
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
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
          ".json": "application/json",
          ".png": "image/png",
          ".md": "text/plain",
        }[path.extname(f)] || "application/octet-stream",
    });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.UNLK_CHROMIUM_PATH
    ? { executablePath: process.env.UNLK_CHROMIUM_PATH }
    : {}),
});
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 600 ? 844 : 900 },
      deviceScaleFactor: 1,
      hasTouch: width < 600,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => results.errors.push(e.message));
    page.on("response", (r) => {
      if (r.url().startsWith(base) && r.status() >= 400)
        results.errors.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(base);
    await page
      .locator(".data-stamp")
      .filter({ hasText: "On-chain read" })
      .waitFor({ timeout: 45000 });
    for (const route of [
      "trade",
      "unlock",
      "milestones",
      "activity",
      "how",
      "contracts",
    ]) {
      await page.goto(`${base}#/${route}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const info = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: innerWidth,
        h1: document.querySelector("h1")?.textContent,
        font: document.fonts.check('14px "JetBrains Mono"'),
        action: document
          .querySelector(".connect-trade")
          ?.getBoundingClientRect()
          .toJSON(),
        chart: document
          .querySelector(".ladder-chart")
          ?.getBoundingClientRect()
          .toJSON(),
        form: document
          .querySelector(".swap-panel")
          ?.getBoundingClientRect()
          .toJSON(),
      }));
      const axe =
        width === 390
          ? await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
              .analyze()
          : null;
      const violations =
        axe?.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })) ?? [];
      results.pages.push({ width, route, ...info, violations });
      assert.ok(
        info.scroll <= width,
        `Overflow ${width} ${route}: ${info.scroll}`,
      );
      assert.equal(info.font, true);
      if (route === "trade" && width === 390) {
        assert.ok(
          info.action.bottom <= 844,
          `Mobile action ends at ${info.action.bottom}`,
        );
        assert.ok(info.chart.height >= 240 && info.chart.height <= 280);
      }
      if (route === "trade" && width === 1440)
        assert.ok(info.form.bottom <= 900, "Desktop form must fit");
      await page.screenshot({
        path: `test/scratch/browser/${width}-${route}.png`,
        fullPage: route !== "trade",
      });
      if (route === "trade" && [1440, 390].includes(width))
        await page.screenshot({
          path: `artifacts/screenshots/unlk-${width}.png`,
        });
      if (violations.length)
        results.errors.push(
          `axe: ${route} at ${width}: ${violations.map((x) => x.id).join(", ")}`,
        );
    }
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  await page.goto(base);
  await page
    .getByRole("button", {
      name: "$500K: 55% of eligible acquisitions",
      exact: true,
    })
    .tap();
  assert.match(
    await page.locator(".ladder-readout").innerText(),
    /Hypothetical.*\$500K.*55%/s,
  );
  await page
    .getByRole("button", {
      name: "$500K: 55% of eligible acquisitions",
      exact: true,
    })
    .focus();
  await page.keyboard.press("ArrowRight");
  assert.match(await page.locator(".ladder-readout").innerText(), /\$1M.*70%/s);
  await page.keyboard.press("End");
  assert.match(
    await page.locator(".ladder-readout").innerText(),
    /Full quota bypass/,
  );
  await page.screenshot({
    path: "artifacts/screenshots/unlk-mobile-selection.png",
  });
  results.interactions.push(
    "Touch milestone selection; ArrowRight and End keyboard selection; final checkpoint explicitly describes full quota bypass",
  );
  await page
    .getByRole("button", { name: "Market history", exact: true })
    .click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page
    .getByLabel("Select historical swap event")
    .waitFor({ timeout: 45000 });
  const range = page.getByLabel("Select historical swap event");
  await range.fill("0");
  assert.match(
    await page.locator(".history-readout").innerText(),
    /ETH \/ UNLK/,
  );
  await page.locator(".history-plot").tap({ position: { x: 150, y: 70 } });
  await page.getByRole("button", { name: "1H", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "1H", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.screenshot({
    path: "artifacts/screenshots/unlk-market-history.png",
    fullPage: false,
  });
  results.interactions.push(
    "Real event history, All/1H range selection, accessible event slider and touch crosshair/tooltip",
  );
  await page.getByRole("button", { name: "Sell UNLK", exact: true }).click();
  await page.locator("#trade-amount").fill("1.25");
  await page.locator("#slippage").selectOption("100");
  assert.match(await page.locator(".receive").innerText(), /router credit/);
  await page
    .getByRole("button", { name: "Connect to trade", exact: false })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  for (const name of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"])
    assert.equal(
      await dialog
        .getByRole("link", { name: `Open in ${name}`, exact: true })
        .count(),
      1,
    );
  assert.equal(
    await dialog
      .getByRole("button", { name: "Coinbase Smart Wallet", exact: false })
      .count(),
    1,
  );
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.textContent?.includes("Connect to trade"),
    ),
    true,
  );
  results.interactions.push(
    "Manual amount, slippage, sell-credit copy; mobile wallet-browser links, Coinbase Smart Wallet, dialog Escape and focus restoration",
  );
  await page.goto(`${base}#/milestones`);
  await page.locator("#scenario-tier").selectOption("1");
  assert.match(await page.locator(".scenario-result").innerText(), /275/);
  assert.match(await page.locator(".scenario-result").innerText(), /150/);
  await page.locator("#scenario-tier").selectOption("6");
  assert.match(await page.locator(".scenario-result").innerText(), /1,250/);
  await page.locator("#scenario-E").fill("0");
  await page.locator("#scenario-tier").selectOption("1");
  assert.match(await page.locator(".scenario-result").innerText(), /0 UNLK/);
  await page.locator("#scenario-E").fill("-1");
  assert.match(
    await page.locator(".scenario-section .error").innerText(),
    /nonnegative/,
  );
  results.interactions.push(
    "Exact worked-example and transfer-only scenarios, full-unlock W behavior and invalid scenario input",
  );
  await page.goto(`${base}#/how`);
  const faq = page.locator(".faq-list details").nth(1);
  await faq.locator("summary").click();
  assert.equal(await faq.getAttribute("open"), "");
  await page.keyboard.press("Enter");
  assert.equal(await faq.getAttribute("open"), null);
  await page.goto(`${base}#/activity`);
  await page.locator("#activity-search").fill("no matching address");
  await page.getByText("No matching records.", { exact: false }).waitFor();
  await page.locator("#activity-search").fill("");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.locator("#event-kind").selectOption("Transfer");
  results.interactions.push(
    "Keyboard FAQ disclosures; activity and holder filtering, event type selection",
  );
  await page.goto(`${base}#/trade`);
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "main");
  results.interactions.push(
    "Skip link focuses the current main without changing route",
  );
  await context.close();
  const offline = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await offline.route("https://**/*", (r) => r.abort());
  const op = await offline.newPage();
  await op.goto(base);
  await op
    .getByRole("button", {
      name: "$1M: 70% of eligible acquisitions",
      exact: true,
    })
    .click();
  assert.match(await op.locator(".ladder-readout").innerText(), /Hypothetical/);
  assert.match(
    await op.locator(".terminal-metrics").innerText(),
    /Unavailable/,
  );
  await op.locator(".header-actions button").click();
  assert.equal(await op.getByRole("dialog").isVisible(), true);
  await op.keyboard.press("Escape");
  await op.getByRole("button", { name: "Market history", exact: true }).click();
  assert.equal(await op.locator(".history-plot svg path").count(), 0);
  await op.screenshot({ path: "artifacts/screenshots/unlk-offline.png" });
  await offline.close();
  results.interactions.push(
    "Offline rules and selection work; no fabricated balances, chart series, confirmed tier or FDV; wallet picker remains responsive",
  );
} catch (e) {
  results.errors.push(e.stack || String(e));
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  if (results.errors.length) process.exitCode = 1;
  fs.writeFileSync(
    "artifacts/browser-validation.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        pages: results.pages.length,
        interactions: results.interactions,
        errors: results.errors,
      },
      null,
      2,
    ),
  );
}
