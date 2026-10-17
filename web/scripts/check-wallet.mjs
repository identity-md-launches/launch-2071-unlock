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
fs.mkdirSync("artifacts", { recursive: true });
fs.mkdirSync("test/scratch/browser", { recursive: true });
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
const results = {
  checks: [],
  errors: [],
  note: "EIP-6963 test provider exposes the existing public payer address for read-only simulation. Every send/sign request rejects locally; no private key and no broadcast.",
};
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    window.__walletCalls = [];
    window.__account = "0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9";
    window.__chain = "0x1";
    const handlers = {};
    const provider = {
      request: async ({ method, params }) => {
        window.__walletCalls.push({ method, params });
        if (method === "eth_requestAccounts" || method === "eth_accounts")
          return [window.__account];
        if (method === "eth_chainId") return window.__chain;
        if (method === "wallet_switchEthereumChain") {
          window.__chain = params[0].chainId;
          handlers.chainChanged?.forEach((f) => f(window.__chain));
          return null;
        }
        if (
          method === "eth_sendTransaction" ||
          method.startsWith("eth_sign") ||
          method === "personal_sign"
        )
          throw Object.assign(new Error("User rejected the request."), {
            code: 4001,
          });
        throw Error("Test provider forbids unexpected wallet method " + method);
      },
      on: (name, fn) => {
        (handlers[name] ??= []).push(fn);
      },
      removeListener: (name, fn) => {
        handlers[name] = (handlers[name] ?? []).filter((f) => f !== fn);
      },
    };
    window.__changeAccount = (a) => {
      window.__account = a;
      handlers.accountsChanged?.forEach((f) => f([a]));
    };
    window.__changeChain = (c) => {
      window.__chain = c;
      handlers.chainChanged?.forEach((f) => f(c));
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: "eip6963-test-provider",
              name: "MetaMask",
              rdns: "io.metamask",
              icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E",
            },
            provider,
          },
        }),
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => results.errors.push(e.message));
  await page.goto(url + "#/trade");
  await page
    .getByRole("button", { name: "Connect wallet", exact: false })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "MetaMask", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Switch to Sepolia" })
    .first()
    .waitFor();
  assert.deepEqual(
    (await page.evaluate(() => window.__walletCalls)).map((x) => x.method),
    ["eth_requestAccounts", "eth_chainId"],
  );
  results.checks.push(
    "EIP-6963 discovery; connection sends only account and chain reads, no approval/sign/trade",
  );
  await page.getByRole("button", { name: "Switch to Sepolia" }).first().click();
  await page
    .getByRole("button", { name: "Get a quote", exact: true })
    .waitFor();
  await page.locator("#trade-amount").fill("0.001");
  await page
    .getByRole("button", { name: "Get a quote", exact: true })
    .click({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Review buy" })
    .waitFor({ timeout: 45000 });
  assert.match(
    await page.locator(".quote-details").innerText(),
    /Minimum receipt/,
  );
  assert.match(
    await page.locator(".quote-details").innerText(),
    /Estimated gas/,
  );
  await page.screenshot({
    path: "test/scratch/browser/wallet-buy-quote.png",
    fullPage: true,
  });
  results.checks.push(
    "Wrong-network switch; live actual-trader buy simulation, minimum receipt, exact fee and gas estimate",
  );
  await page.evaluate(() => {
    const original = Date.now;
    Date.now = () => original() + 50000;
    window.__restoreDate = () => {
      Date.now = original;
    };
  });
  await page
    .getByRole("button", { name: "Review buy" })
    .waitFor({ state: "hidden", timeout: 5000 });
  assert.equal(
    await page.getByRole("button", { name: "Review buy" }).count(),
    0,
  );
  await page.evaluate(() => window.__restoreDate());
  await page.locator("#slippage").selectOption("100");
  await page
    .getByRole("button", { name: "Review buy" })
    .waitFor({ state: "hidden", timeout: 5000 });
  assert.equal(
    await page.getByRole("button", { name: "Review buy" }).count(),
    0,
  );
  await page.getByRole("button", { name: "Get a quote", exact: true }).click();
  await page
    .getByRole("button", { name: "Review buy" })
    .waitFor({ timeout: 30000 });
  results.checks.push(
    "45-second expiry and slippage changes invalidate quotes before review",
  );
  await page.getByRole("button", { name: "Review buy" }).click();
  await page
    .getByRole("dialog", { name: "Buy UNLK" })
    .waitFor({ timeout: 30000 });
  assert.match(
    await page.getByRole("dialog").innerText(),
    /0x28f04118fe5d940fe9a81740e74d611313b3004b/,
  );
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Request rejected" })
    .waitFor({ timeout: 30000 });
  const sends = (await page.evaluate(() => window.__walletCalls)).filter(
    (x) => x.method === "eth_sendTransaction",
  );
  assert.equal(sends.length, 1);
  assert.equal(
    sends[0].params[0].to.toLowerCase(),
    "0x28f04118fe5d940fe9a81740e74d611313b3004b",
  );
  results.checks.push(
    "Review uses official router; re-simulated send rejection shown once; no automatic resend",
  );
  await page
    .getByRole("button", { name: "Dismiss transaction status" })
    .click();
  await page.getByRole("button", { name: "Sell UNLK", exact: true }).click();
  await page.locator("#trade-amount").fill("1");
  await page.waitForTimeout(300);
  if (
    await page
      .getByRole("button", { name: "Review exact approval", exact: true })
      .count()
  ) {
    await page
      .getByRole("button", { name: "Review exact approval", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Approve UNLK for this sale" })
      .waitFor({ timeout: 30000 });
    assert.match(await page.getByRole("dialog").innerText(), /1 UNLK/);
    results.checks.push(
      "Exact sell approval review reaches the connected wallet; no approval broadcast",
    );
  } else {
    await page
      .getByRole("button", { name: "Get a quote", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review sell" })
      .click({ timeout: 30000 });
    await page
      .getByRole("dialog", { name: "Sell UNLK", exact: true })
      .waitFor({ timeout: 30000 });
    assert.match(
      await page.getByRole("dialog").innerText(),
      /withdrawable router credit/,
    );
    results.checks.push(
      "Existing live allowance permits exact sell simulation and router-credit review; bounded approval independently verified on the local fork",
    );
  }
  assert.match(
    await page.getByRole("dialog").innerText(),
    /0x28f04118fe5d940fe9a81740e74d611313b3004b/,
  );
  await page.evaluate(() =>
    window.__changeAccount("0xf55d5bacbf3ce5464921a94708c08a99bea99cdd"),
  );
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole("dialog").isVisible(), false);
  await page.goto(url + "#/unlock");
  await page.waitForFunction(
    () => {
      const ledger = document.querySelector(".wallet-ledger");
      return (
        ledger &&
        ledger.textContent.includes("Eligible acquisitions") &&
        ledger.querySelectorAll("dd")[1]?.textContent.includes("0 UNLK")
      );
    },
    { timeout: 30000 },
  );
  assert.match(
    await page.locator(".wallet-overview").innerText(),
    /Transfers never create acquisition credit/,
  );
  results.checks.push(
    "Account change closes transaction review, invalidates quote and reads transfer-only E=0 allowance",
  );
  await page.evaluate(() =>
    window.__changeAccount("0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9"),
  );
  await page
    .getByRole("button", { name: "Already claimed" })
    .waitFor({ timeout: 30000 });
  assert.equal(
    await page.getByRole("button", { name: "Already claimed" }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Review attestation" }).waitFor();
  results.checks.push(
    "Known native claim deduplicated; attestation is a distinct recoverable step",
  );
  await page.screenshot({
    path: "test/scratch/browser/wallet-allowance-rewards.png",
    fullPage: true,
  });
  await page.evaluate(() => window.__changeChain("0x1"));
  assert.equal(
    await page.getByRole("button", { name: "Review attestation" }).isDisabled(),
    true,
  );
  results.checks.push("Network change disables reward writes");
  const final = (await page.evaluate(() => window.__walletCalls)).filter(
    (x) => x.method === "eth_sendTransaction",
  );
  assert.equal(final.length, 1);
  await context.close();
} catch (e) {
  results.errors.push(e.stack || String(e));
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  fs.writeFileSync(
    "artifacts/wallet-validation.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results, null, 2));
}
