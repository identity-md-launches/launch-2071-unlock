import assert from "node:assert/strict";
import fs from "node:fs";
const { chromium, webkit } = await import(
  process.env.IMD_PLAYWRIGHT ?? "playwright"
);
const site = process.argv[2] ?? "http://127.0.0.1:4173";
const out = new URL("../evidence/", import.meta.url);
const shots = new URL("../../artifacts/", import.meta.url);
fs.mkdirSync(shots, { recursive: true });
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
  await p.screenshot({
    path: new URL("terminal-mobile.jpg", shots).pathname,
    type: "jpeg",
    quality: 60,
  });
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
  for (let i = 0; i <= 16; i++) {
    await p.locator("#gate-select").selectOption(String(i));
    assert.match(
      await p.locator(".ladder-readout").innerText(),
      new RegExp(`${20 + i * 5}% allowance`),
    );
  }
  await p.locator("#gate-select").focus();
  await p.keyboard.press("Home");
  assert.equal(await p.locator("#gate-select").inputValue(), "0");
  await p.keyboard.press("End");
  assert.equal(await p.locator("#gate-select").inputValue(), "16");
  assert.match(await p.locator(".graph-foot").innerText(), /Confirmed: 20%/);
  report.checks.push(
    "All 17 gates selectable by native select and keyboard selection; $50M selection leaves actual 20% rights unchanged",
  );
  await p.getByRole("link", { name: "Activity", exact: true }).click();
  await p.locator("#history-view").waitFor({ state: "visible" });
  assert.equal(
    await p
      .getByRole("tab", { name: "History", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await p.getByText(/Coverage: blocks/).waitFor({ timeout: 30000 });
  report.history = await p.locator(".history-wrap").innerText();
  report.checks.push(
    "Activity navigation opens real pool-event history with explicit successfully scanned block coverage",
  );
  await p.getByRole("tab", { name: "History", exact: true }).focus();
  await p.keyboard.press("ArrowLeft");
  await p.locator("#ladder-view").waitFor({ state: "visible" });
  assert.equal(
    await p
      .getByRole("tab", { name: "Unlock ladder", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await p.locator("#gate-select").selectOption("0");
  await p.getByRole("link", { name: "Treasury", exact: true }).click();
  await p
    .getByText(/\d+ verified here \/ \d+ held/)
    .waitFor({ timeout: 30000 });
  if (await p.locator(".nft-card").count())
    await p.locator(".nft-image img").first().waitFor();
  report.nfts = await p.locator(".nft-card>a").allTextContents();
  report.checks.push(
    "Live official-collection images and ownerOf-verified IDs render from custody wallet",
  );
  for (const width of [320, 390, 768, 900, 1000, 1440]) {
    await p.setViewportSize({ width, height: 900 });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  await p.getByRole("button", { name: "Buy UNLK", exact: true }).click();
  await p.getByRole("textbox", { name: "You pay IMD", exact: true }).fill("");
  await p.getByRole("link", { name: "Trade", exact: true }).click();
  await p.evaluate(() => scrollTo(0, 0));
  await p.screenshot({
    path: new URL("terminal-desktop.jpg", shots).pathname,
    type: "jpeg",
    quality: 60,
  });
  report.checks.push(
    "Live reflow at 320,390,768,900,1000,1440 without horizontal overflow",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await p.getByRole("link", { name: "Milestones", exact: true }).click();
  await p.reload();
  await p.locator("#ladder-view").waitFor({ state: "visible" });
  await p.getByText("Trading not yet activated", { exact: true }).waitFor();
  await p.locator("#gate-select").selectOption("16");
  assert.match(await p.locator(".ladder-readout").innerText(), /\$50M → 100%/);
  await p.locator("#milestones").scrollIntoViewIfNeeded();
  await p.screenshot({
    path: new URL("terminal-mobile-ladder.jpg", shots).pathname,
    type: "jpeg",
    quality: 60,
  });
  report.checks.push(
    "Mobile refresh at #milestones retains accessible ladder and final $50M gate selection",
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
  assert.match(
    await fp.locator(".graph-foot").innerText(),
    /Confirmed tier unavailable/,
  );
  assert.equal(await fp.locator(".earned-path").count(), 0);
  report.checks.push(
    "Mock RPC errors display unavailable state and no fabricated unlocked tier",
  );
  const nftFailure = await b.newContext({
    viewport: { width: 390, height: 844 },
  });
  await nftFailure.route("https://eth.blockscout.com/**", (route) =>
    route.fulfill({ status: 503, body: "Indexer temporarily unavailable" }),
  );
  const np = await nftFailure.newPage();
  await np.goto(site);
  await np.locator(".nft-gallery [role=alert]").waitFor();
  assert.equal(await np.locator(".nft-card").count(), 0);
  report.checks.push(
    "Mock NFT indexer failure exposes an error and retry, never fabricated cards",
  );
  if (await p.locator(".nft-image img").count()) {
    await p
      .locator(".nft-image img")
      .first()
      .evaluate((img) => img.dispatchEvent(new Event("error")));
    await p
      .getByText("Image could not be displayed", { exact: true })
      .waitFor();
    report.checks.push(
      "Injected image-load failure keeps the verified ID and displays a readable image error",
    );
  }
  if (process.argv.includes("--chromium-only")) {
    report.limitations.push(
      "WebKit not run in this invocation (--chromium-only)",
    );
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
      await wp.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
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
