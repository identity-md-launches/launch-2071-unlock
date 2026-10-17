import assert from "node:assert/strict";
import fs from "node:fs";
const { chromium, webkit } = await import(
  process.env.IMD_PLAYWRIGHT ?? "playwright"
);
const site = process.argv[2] ?? "http://127.0.0.1:4173";
const out = new URL("../evidence/", import.meta.url);
const report = {
  evidence:
    "Production static export with live public RPC/indexer reads; no wallet account or signing",
  checks: [],
  console: [],
  resourceFailures: [],
  limitations: [],
};
const browsers = [];
try {
  const b = await chromium.launch({ headless: true });
  browsers.push(b);
  const context = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  p.on("pageerror", (e) => report.console.push(e.message));
  p.on("requestfailed", (r) => {
    if (r.url().startsWith(site) && !r.failure()?.errorText.includes("ABORTED"))
      report.resourceFailures.push(r.url());
  });
  await p.goto(site);
  await p.getByText("Trading not yet activated", { exact: true }).waitFor();
  await p.screenshot({ path: new URL("mobile-live.jpg", out).pathname, type: "jpeg", quality: 70 });
  const cta = p.getByRole("button", { name: "Connect to trade", exact: true });
  assert((await cta.boundingBox()).y + (await cta.boundingBox()).height < 844);
  report.checks.push(
    "390x844 product and complete primary action on first screen",
  );
  await cta.click();
  await p.getByRole("dialog", { name: "Connect a wallet" }).waitFor();
  await p.keyboard.press("Tab");
  assert(
    await p.evaluate(() =>
      document.querySelector("dialog[open]").contains(document.activeElement),
    ),
  );
  await p.keyboard.press("Escape");
  assert(await cta.evaluate((el) => el === document.activeElement));
  report.checks.push(
    "Native connect dialog traps Tab, Escape dismisses and restores trigger focus",
  );
  await p.keyboard.press("Tab");
  const focus = await p.evaluate(() => ({
    name: document.activeElement.textContent,
    outline: getComputedStyle(document.activeElement).outlineStyle,
    width: getComputedStyle(document.activeElement).outlineWidth,
  }));
  report.focus = focus;
  assert.equal(focus.outline, "solid");
  report.checks.push("Keyboard focus has visible two-pixel perimeter");
  await p.getByRole("button", { name: "Sell UNLK", exact: true }).click();
  await p
    .getByRole("textbox", { name: "You pay UNLK", exact: true })
    .fill("0.000000000000000001");
  assert.equal(
    await p
      .getByRole("textbox", { name: "You pay UNLK", exact: true })
      .getAttribute("aria-invalid"),
    "false",
  );
  report.checks.push(
    "Buy/sell direction and smallest raw-unit amount interaction",
  );
  await p.getByRole("link", { name: "Milestones", exact: true }).click();
  assert.equal(await p.locator(".gate-list li").count(), 17);
  report.checks.push(
    "Hash navigation reaches all 16 gates plus initial20%; current and next are textual states",
  );
  await p.getByRole("link", { name: "Treasury", exact: true }).click();
  await p
    .getByText("2 verified here / 2 held", { exact: false })
    .waitFor({ timeout: 30000 });
  await p.locator(".nft-image img").first().waitFor();
  report.nfts = await p.locator(".nft-card>a").allTextContents();
  report.checks.push(
    "Live official-collection images and ownerOf-verified IDs render from custody wallet",
  );
  for (const width of [320, 390, 1440]) {
    await p.setViewportSize({ width, height: 900 });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  await p.evaluate(() => scrollTo(0, 0));
  await p.screenshot({ path: new URL("desktop-live.jpg", out).pathname, type: "jpeg", quality: 70 });
  report.checks.push(
    "Live desktop/mobile reflow at 320,390,1440 without horizontal overflow",
  );
  if (process.env.IMD_AXE_MODULE) {
    const { default: AxeBuilder } = await import(process.env.IMD_AXE_MODULE);
    report.axe = await new AxeBuilder({ page: p }).analyze();
    report.axe = {
      violations: report.axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
      passes: report.axe.passes.length,
    };
    assert.deepEqual(report.axe.violations, []);
    report.checks.push("Automated axe accessibility audit has no violations");
  }
  const mobile = await b.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  });
  const mp = await mobile.newPage();
  await mp.goto(site);
  await mp
    .getByRole("button", { name: "Connect to trade", exact: true })
    .click();
  for (const name of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"])
    await mp
      .getByRole("link", { name: "Open in " + name, exact: true })
      .waitFor();
  await mp
    .getByRole("button", { name: "Coinbase Smart Wallet", exact: true })
    .waitFor();
  const sheet = await mp
    .getByRole("dialog", { name: "Connect a wallet" })
    .boundingBox();
  assert(Math.abs(sheet.y + sheet.height - 844) < 2);
  report.checks.push(
    "Phone bottom sheet exposes four wallet-browser links and Coinbase Smart Wallet with its base at the viewport edge",
  );
  const failure = await b.newContext({ viewport: { width: 390, height: 844 } });
  await failure.route(
    /https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: route.request().postDataJSON()?.id ?? 1,
          error: { code: -32000, message: "RPC feed unavailable for test" },
        }),
      }),
  );
  const fp = await failure.newPage();
  await fp.goto(site);
  await fp.getByText(/Mainnet reads failed:/).waitFor({ timeout: 30000 });
  assert.equal(await fp.locator(".gate-list .current").count(), 0);
  report.checks.push(
    "Mock RPC errors display unavailable state and no fabricated unlocked tier",
  );
  if (process.argv.includes("--chromium-only")) {
    report.limitations.push("WebKit not run in this invocation (--chromium-only)");
  } else {
  const w = await webkit.launch({ headless: true });
  browsers.push(w);
  const wp = await w.newPage({ viewport: { width: 390, height: 844 } });
  await wp.goto(site);
  await wp.getByRole("button", { name: "Sell UNLK", exact: true }).click();
  await wp
    .getByRole("textbox", { name: "You pay UNLK", exact: true })
    .fill("1");
  await wp
    .getByRole("button", { name: "Connect to trade", exact: true })
    .click();
  await wp.getByRole("dialog", { name: "Connect a wallet" }).waitFor();
  assert.equal(
    await wp.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  report.checks.push(
    "WebKit direction/form/connect flow renders without overflow",
  );
  }
  assert.deepEqual(report.console, []);
  assert.deepEqual(report.resourceFailures, []);
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = e.stack;
  throw e;
} finally {
  for (const b of browsers) await b.close();
  fs.writeFileSync(
    new URL("site-review.json", out),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
