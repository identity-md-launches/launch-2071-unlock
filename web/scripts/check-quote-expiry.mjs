import assert from "node:assert/strict";
import fs from "node:fs";
import { encodeFunctionData } from "viem";

const { chromium } = await import(process.env.IMD_PLAYWRIGHT ?? "playwright");
const site = process.argv[2] ?? "http://127.0.0.1:4173";
const rpc = process.argv[3] ?? "http://127.0.0.1:8545";
const vulnerable = process.argv.includes("--expect-vulnerable");
assert(["localhost", "127.0.0.1"].includes(new URL(rpc).hostname),
  "Tests may mutate only a loopback fork");
const evidence = new URL("../evidence/", import.meta.url);
const config = JSON.parse(fs.readFileSync(new URL("fork-config.json", evidence)));
const pins = JSON.parse(fs.readFileSync(new URL("../src/mainnet-pins.json", import.meta.url)));
const abi = JSON.parse(fs.readFileSync(new URL("../src/abis/UnlkImdHook.json", import.meta.url)));
const owner = "0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9";
let id = 0;
async function raw(method, params = []) {
  const response = await fetch(rpc, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  }).then((r) => r.json());
  if (response.error) throw Object.assign(Error(response.error.message), response.error);
  return response.result;
}
const block = await raw("eth_getBlockByNumber", ["latest", false]);
assert.equal(block.hash, config.blockHash, "Start Anvil at the recorded, unmodified block");
const baseline = await raw("evm_snapshot");
const report = {
  evidence: "Production export; real contracts on local mainnet fork. Test wallet rejects ALL send requests. Public RPC reads are redirected to loopback.",
  block: config.block, blockHash: block.hash, expectVulnerable: vulnerable,
  fixtureChanges: ["Local-only owner impersonation and ETH gas funding", "Local-only configureAndActivate", "Virtual browser clock and delayed RPC responses"],
  checks: [],
};
let browser;
try {
  await raw("anvil_impersonateAccount", [owner]);
  await raw("anvil_setBalance", [owner, "0x56bc75e2d63100000"]);
  await raw("evm_setNextBlockTimestamp", [Number(block.timestamp) + 1]);
  report.localActivationHash = await raw("eth_sendTransaction", [{
    from: owner, to: pins.addresses.hook, gas: "0x7a1200", value: "0x0",
    data: encodeFunctionData({ abi, functionName: "configureAndActivate",
      args: [pins.addresses.evidence, pins.addresses.oracle, 2071n] }),
  }]);
  await raw("evm_mine");
  const receipt = await raw("eth_getTransactionReceipt", [report.localActivationHash]);
  assert.equal(receipt.status, "0x1");
  browser = await chromium.launch({ headless: true });
  for (const scenario of vulnerable ? ["slow-gas"] : ["slow-gas", "slow-final-read", "block-advance", "deadline", "fresh"]) {
    const local = await raw("evm_snapshot");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    let armed = false, finalRead = false, sendRequests = 0, injected = false;
    await page.clock.install({ time: new Date((Number(block.timestamp) + 1) * 1000) });
    await context.route(/https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)\/?/, async (route) => {
      const body = route.request().postDataJSON();
      const rows = Array.isArray(body) ? body : [body];
      const values = await Promise.all(rows.map(async (request) => {
        try {
          const result = await raw(request.method, request.params);
          if (armed && request.method === "eth_estimateGas") {
            armed = false;
            if (scenario === "slow-gas") await page.clock.fastForward(31000);
            if (scenario === "block-advance") await raw("anvil_mine", ["0x4"]);
            if (scenario === "deadline") {
              const head = await raw("eth_getBlockByNumber", ["latest", false]);
              await raw("evm_setNextBlockTimestamp", [Number(head.timestamp) + 301]);
              await raw("evm_mine");
            }
            finalRead = scenario === "slow-final-read";
            injected = scenario !== "slow-final-read";
          } else if (finalRead && request.method === "eth_call") {
            finalRead = false;
            injected = true;
            await page.clock.fastForward(31000);
          }
          return { jsonrpc: "2.0", id: request.id, result };
        } catch (e) {
          return { jsonrpc: "2.0", id: request.id, error: { code: e.code ?? -32000, message: e.message, data: e.data } };
        }
      }));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? values : values[0]) });
    });
    await context.route("https://eth.blockscout.com/**", (route) => route.fulfill({
      contentType: "application/json", body: '{"items":[],"next_page_params":null}',
    }));
    await context.exposeFunction("__rejectedSend", () => { sendRequests++; });
    await context.addInitScript(({ owner }) => {
      const provider = {
        async request({ method }) {
          if (method === "eth_accounts" || method === "eth_requestAccounts") return [owner];
          if (method === "eth_chainId") return "0x1";
          if (method === "eth_sendTransaction") {
            await window.__rejectedSend();
            throw Object.assign(Error("User rejected the request"), { code: 4001 });
          }
          throw Error("Unexpected wallet method " + method);
        },
        on() {}, removeListener() {},
      };
      addEventListener("eip6963:requestProvider", () => dispatchEvent(new CustomEvent("eip6963:announceProvider", {
        detail: { info: { uuid: "quote-regression", name: "Reject-only test wallet", rdns: "test.local", icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }, provider },
      })));
    }, { owner });
    try {
      await page.goto(site);
      await page.getByText("Trading active", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
      await page.getByRole("button", { name: "Reject-only test wallet", exact: true }).click();
      await page.getByRole("textbox", { name: "You pay IMD", exact: true }).fill("0.01");
      await page.getByRole("button", { name: "Get live quote", exact: true }).click();
      await page.getByRole("button", { name: "Review buy", exact: true }).click();
      await page.getByRole("dialog", { name: "Buy UNLK", exact: true }).waitFor();
      armed = true;
      await page.getByRole("button", { name: "Continue to wallet", exact: true }).click();
      await page.locator(".transaction-status").getByText(/· (error|rejected)/).waitFor();
      const message = await page.locator(".transaction-status").innerText();
      const quoteState = await page.getByRole("heading", { name: /^Quote (ready|expired)$/ }).textContent();
      report.checks.push({ scenario, injected, sendRequests, message, quoteState });
      assert(injected, "The intended async boundary was exercised");
      assert.equal(sendRequests, vulnerable || scenario === "fresh" ? 1 : 0);
      assert.equal(await page.getByRole("dialog", { name: "Buy UNLK", exact: true }).isVisible(), false);
      if (!vulnerable && scenario !== "fresh") assert.match(message, /Quote expired|Quote or activation state changed/);
      if (scenario.startsWith("slow"))
        await page.getByRole("heading", { name: "Quote expired", exact: true }).waitFor();
      // One representative error screenshot; all scenarios retain full JSON results.
      if (!vulnerable && scenario === "slow-gas")
        await page.screenshot({ path: new URL("quote-slow-gas.jpg", evidence).pathname, type: "jpeg", quality: 70 });
    } finally {
      await context.close();
      await raw("evm_revert", [local]);
    }
  }
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = e.stack;
  throw e;
} finally {
  await browser?.close();
  await raw("evm_revert", [baseline]);
  fs.writeFileSync(new URL(vulnerable ? "quote-expiry-before.json" : "quote-expiry-after.json", evidence), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
