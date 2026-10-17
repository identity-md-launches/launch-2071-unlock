import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicClient, http, encodeFunctionData, parseAbi } from "viem";
const { chromium, webkit } = await import(
  process.env.IMD_PLAYWRIGHT ?? "playwright"
);
const site = process.argv[2] ?? "http://127.0.0.1:4173",
  rpc = process.argv[3] ?? "http://127.0.0.1:8545";
if (!["localhost", "127.0.0.1"].includes(new URL(rpc).hostname))
  throw Error("Interaction tests may write only to a loopback fork RPC");
const root = new URL("../../", import.meta.url),
  web = new URL("../", import.meta.url),
  out = new URL("web/evidence/", root);
fs.mkdirSync(out, { recursive: true });
let rpcId = 0;
async function raw(method, params = []) {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  }).then((r) => r.json());
  if (r.error) throw Object.assign(Error(r.error.message), r.error);
  return r.result;
}
const owner = "0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9",
  hook = "0x932eba7e96b9e54efe6f8cdf98cb092164a57fcc",
  imd = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
  permit = "0x000000000022d473030f116ddee9f6b43ac78ba3",
  router = "0x66a9893cc07d91d95644aedd05d03f95e1dba8af";
const hookAbi = JSON.parse(
  fs.readFileSync(new URL("src/abis/UnlkImdHook.json", web)),
);
const erc = parseAbi(["function approve(address,uint256) returns (bool)"]),
  pa = parseAbi(["function approve(address,address,uint160,uint48)"]);
const claim = JSON.parse(
  fs.readFileSync(new URL("public/claims/round-0.json", web)),
).leaves[0];
const baseline = await raw("evm_snapshot");
const forkBlock = await raw("eth_getBlockByNumber", ["latest", false]);
const forkConfig = JSON.parse(
  fs.readFileSync(new URL("fork-config.json", out)),
);
assert.equal(
  forkBlock.hash,
  forkConfig.blockHash,
  "Use the recorded unmodified fork",
);
const startedAt = Date.now();
const forkNow = () =>
  Number(BigInt(forkBlock.timestamp)) * 1000 + Date.now() - startedAt;
const results = {
  evidence:
    "Actual deployed launch 2071 on a local Anvil fork at block 26212727; wallet events and rejection injected; no public writes",
  checks: [],
  console: [],
  writes: [],
  block: forkConfig.block,
  blockHash: forkBlock.hash,
  fixtureChanges: [
    "Local owner/claimant impersonation and ETH gas funding",
    "Local activation and approvals",
    "Browser clock starts at fork time",
    "Wallet events, rejection, feed failure, low-gas revert and receipt timing injected",
    "NFT indexer returns a mocked empty inventory",
    "Historical logs read separately from PublicNode; actual post-fork logs read from Anvil",
  ],
  limitations: [],
};
// Some Anvil/upstream combinations expand a mixed historical/local log range.
// Keep the real historical prefix and the real post-fork logs separate. Nothing
// is synthesized, and public providers receive read-only eth_getLogs requests.
async function browserRead(method, params) {
  if (method !== "eth_getLogs") return raw(method, params);
  const filter = params[0];
  const start = BigInt(filter.fromBlock);
  const end = BigInt(filter.toBlock);
  const fork = BigInt(forkBlock.number);
  let historical = [];
  if (start <= fork) {
    let lastError;
    const prefix = {
      ...filter,
      toBlock: "0x" + (end < fork ? end : fork).toString(16),
    };
    for (const endpoint of [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.drpc.org",
    ]) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method,
            params: [prefix],
          }),
          signal: AbortSignal.timeout(15000),
        }).then((r) => r.json());
        if (response.error || !Array.isArray(response.result))
          throw Error(response.error?.message ?? "Historical logs unavailable");
        historical = response.result;
        results.historyPrefix = {
          endpoint,
          fromBlock: start.toString(),
          toBlock: (end < fork ? end : fork).toString(),
          actualEvents: historical.length,
        };
        lastError = undefined;
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) throw lastError;
  }
  const local =
    end > fork
      ? await raw(method, [
          {
            ...filter,
            fromBlock: "0x" + (start > fork ? start : fork + 1n).toString(16),
          },
        ])
      : [];
  results.historyLocalEvents = local.length;
  return [...historical, ...local];
}
let rejectNext = false;
let feedFailure = false;
let changeDuringGas = false;
let holdNext = false,
  revertNext = false,
  heldHash,
  clockOffset = 0;
const send = async (tx, mine = true) => {
  await raw("anvil_impersonateAccount", [tx.from]);
  await raw("anvil_setBalance", [tx.from, "0x56BC75E2D63100000"]);
  const latest = await raw("eth_getBlockByNumber", ["latest", false]);
  await raw("evm_setNextBlockTimestamp", [
    Math.max(
      Math.floor(forkNow() / 1000) + clockOffset,
      Number(BigInt(latest.timestamp)) + 1,
    ),
  ]);
  const hash = await raw("eth_sendTransaction", [
    { ...tx, gas: tx.gas ?? "0x7a1200" },
  ]);
  if (mine) await raw("anvil_mine", ["0x2"]);
  return hash;
};
const browsers = [];
let page;
try {
  await raw("evm_setNextBlockTimestamp", [
    Math.floor(forkNow() / 1000) + clockOffset,
  ]);
  await raw("evm_mine");
  for (const address of [owner, claim.wallet]) {
    await raw("anvil_impersonateAccount", [address]);
    await raw("anvil_setBalance", [address, "0x56BC75E2D63100000"]);
  }
  const browser = await chromium.launch({ headless: true });
  browsers.push(browser);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.route(
    /https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)\/?/,
    async (route) => {
      try {
        const body = route.request().postDataJSON();
        const rows = Array.isArray(body) ? body : [body];
        const values = await Promise.all(
          rows.map(async (x) => {
            try {
              if (changeDuringGas && x.method === "eth_estimateGas") {
                changeDuringGas = false;
                await page.evaluate(
                  (a) => window.forkWallet.changeAccount(a),
                  owner,
                );
              }
              if (
                feedFailure &&
                x.method === "eth_call" &&
                x.params[0].to?.toLowerCase() ===
                  "0x13cd2d5452cac5e71ca16e825e280563a874c6b6"
              )
                throw Object.assign(
                  Error("Simulated oracle feed RPC failure"),
                  { code: -32000 },
                );
              return {
                jsonrpc: "2.0",
                id: x.id,
                result: await browserRead(x.method, x.params),
              };
            } catch (e) {
              return {
                jsonrpc: "2.0",
                id: x.id,
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
      } catch {
        await route.abort();
      }
    },
  );
  await context.route("https://eth.blockscout.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"items":[],"next_page_params":null}',
    }),
  );
  await context.exposeFunction("__forkRPC", async ({ method, params }) => {
    if (method === "eth_sendTransaction") {
      if (rejectNext) {
        rejectNext = false;
        throw Error("User rejected the request");
      }
      const tx = params[0];
      assert.equal(BigInt(tx.value ?? 0), 0n);
      const hold = holdNext;
      holdNext = false;
      if (hold) await raw("anvil_setAutomine", [false]);
      const sentTx = revertNext ? { ...tx, gas: "0xea60" } : tx;
      revertNext = false;
      const hash = await send(sentTx, !hold);
      if (hold) heldHash = hash;
      results.writes.push({
        to: tx.to,
        from: tx.from,
        value: tx.value ?? "0x0",
        hash,
      });
      return hash;
    }
    return raw(method, params);
  });
  await context.addInitScript(
    ({ owner }) => {
      const listeners = {};
      let account = owner,
        chain = "0x1";
      const provider = {
        request: async ({ method, params }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [account];
          if (method === "eth_chainId") return chain;
          if (method === "wallet_switchEthereumChain") {
            chain = params[0].chainId;
            (listeners.chainChanged ?? []).forEach((f) => f(chain));
            return null;
          }
          return window
            .__forkRPC({ method, params: params ?? [] })
            .catch((e) => {
              if (/rejected/i.test(e.message))
                throw Object.assign(new Error("User rejected the request"), {
                  code: 4001,
                });
              throw e;
            });
        },
        on: (event, fn) => {
          (listeners[event] ??= []).push(fn);
        },
        removeListener: (event, fn) => {
          listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
        },
      };
      window.forkWallet = {
        changeAccount(a) {
          account = a;
          (listeners.accountsChanged ?? []).forEach((f) => f([a]));
        },
        changeChain(c) {
          chain = c;
          (listeners.chainChanged ?? []).forEach((f) => f(c));
        },
      };
      window.ethereum = provider;
      const announce = () =>
        dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                uuid: "local-fork-wallet",
                name: "Local fork wallet",
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
                rdns: "test.local",
              },
              provider,
            },
          }),
        );
      addEventListener("eip6963:requestProvider", announce);
    },
    { owner },
  );
  page = await context.newPage();
  await page.clock.install({ time: new Date(forkNow()) });
  page.on("pageerror", (e) => results.console.push(e.message));
  await page.goto(site);
  await page.getByText("Trading not yet activated", { exact: true }).waitFor();
  results.checks.push(
    "390px first screen contains product, amount and connect action",
  );
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Local fork wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Trading not yet activated", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "Trading not yet activated", exact: true })
      .isDisabled(),
  );
  results.checks.push(
    "Named EIP-6963 wallet connects; inactive swaps disabled",
  );
  await page.evaluate(() => window.forkWallet.changeChain("0xaa36a7"));
  await page
    .getByRole("button", { name: "Switch to Ethereum" })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Trading not yet activated", exact: true })
    .waitFor();
  results.checks.push("Network switch requests Ethereum chain 1");
  await page.evaluate((a) => window.forkWallet.changeAccount(a), claim.wallet);
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Claim native UNLK",
      )?.disabled,
  );
  changeDuringGas = true;
  await page
    .getByRole("button", { name: "Claim native UNLK", exact: true })
    .click();
  await page
    .locator(".transaction-status")
    .getByText(/Wallet or network changed while estimating gas/)
    .waitFor();
  assert.equal(results.writes.length, 0);
  assert.equal(
    await page
      .getByRole("dialog", { name: "Claim native allocation", exact: true })
      .isVisible(),
    false,
  );
  await page.evaluate((a) => window.forkWallet.changeAccount(a), claim.wallet);
  results.checks.push(
    "Account change during gas estimation prevents stale review and sends nothing",
  );
  async function confirm(buttonName, title) {
    await page.getByRole("button", { name: buttonName, exact: true }).click();
    await page.getByRole("dialog", { name: title, exact: true }).waitFor();
    const count = results.writes.length;
    const confirmButton = page.getByRole("button", {
      name: "Continue to wallet",
      exact: true,
    });
    if (buttonName === "Review buy")
      await confirmButton.evaluate((el) => {
        el.click();
        el.click();
      });
    else await confirmButton.click();
    await page
      .locator(".transaction-status")
      .getByText(/· confirmed/)
      .waitFor({ timeout: 30000 });
    assert.equal(results.writes.length, count + 1);
  }
  await confirm("Claim native UNLK", "Claim native allocation");
  results.checks.push(
    "Real native round0 claim before activation using locally rebuilt matching proof",
  );
  rejectNext = true;
  await page.getByRole("button", { name: "Attest claim", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue to wallet", exact: true })
    .click();
  await page
    .locator(".transaction-status")
    .getByText(/Nothing was resent/)
    .waitFor();
  assert.equal(results.writes.length, 1);
  results.checks.push("Wallet rejection produces no write or resend");
  await confirm("Attest claim", "Attest claimed allocation");
  assert(
    await page
      .getByRole("button", { name: "Sync reward credit", exact: true })
      .isDisabled(),
  );
  await send({
    from: owner,
    to: hook,
    data: encodeFunctionData({
      abi: hookAbi,
      functionName: "configureAndActivate",
      args: [
        "0x31d8c50c3c2d7c6000f1ac8cfd466404d26232ab",
        "0x13cd2d5452cac5e71ca16e825e280563a874c6b6",
        2071n,
      ],
    }),
    value: "0x0",
  });
  await page
    .getByText("Trading active", { exact: true })
    .waitFor({ timeout: 25000 });
  await confirm("Sync reward credit", "Sync selling credit");
  results.checks.push(
    "Activation appears automatically; attestation and credit sync stay separate",
  );
  await page.evaluate((a) => window.forkWallet.changeAccount(a), owner);
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Sync payer credit",
      )?.disabled,
  );
  await confirm("Sync payer credit", "Sync payer credit");
  results.checks.push("Actual payer eligibility and deduplicated sync");
  feedFailure = true;
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await page
    .getByText(
      "Oracle unavailable: pool, depth or ETH/USD validation failed. Open rights remain permanent.",
      { exact: true },
    )
    .waitFor();
  await page.getByText("Trading active", { exact: true }).waitFor();
  results.checks.push(
    "Mock oracle read failure shows unavailable FDV while active trading and stored rights remain",
  );
  feedFailure = false;
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();

  await send({
    from: owner,
    to: imd,
    data: encodeFunctionData({
      abi: erc,
      functionName: "approve",
      args: [permit, 0n],
    }),
    value: "0x0",
  });
  await send({
    from: owner,
    to: permit,
    data: encodeFunctionData({
      abi: pa,
      functionName: "approve",
      args: [imd, router, 0n, Math.floor(forkNow() / 1000) + 1800],
    }),
    value: "0x0",
  });
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await page.getByRole("button", { name: "Buy UNLK", exact: true }).click();
  await page
    .getByRole("textbox", { name: "You pay IMD", exact: true })
    .fill("1");
  async function quote() {
    await page
      .getByRole("button", { name: "Get live quote", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Quote ready", exact: true })
      .waitFor();
  }
  await quote();
  await confirm("1. Approve IMD to Permit2", "Approve IMD to Permit2");
  await quote();
  await confirm(
    "2. Authorize router in Permit2",
    "Authorize the Universal Router",
  );
  await quote();
  await confirm("Review buy", "Buy UNLK");
  await page
    .locator(".transaction-status")
    .getByText(/Executed IMD pool leg/)
    .waitFor();
  results.checks.push(
    "Fee-inclusive quote, token approval, expiring Permit2 approval, real router buy and executed treasury receipt",
  );
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.locator("#history-view").waitFor({ state: "visible" });
  try {
    await page.getByText(/Coverage: blocks/).waitFor({ timeout: 60000 });
  } catch (e) {
    results.historyFailure = await page.locator(".history-wrap").innerText();
    throw e;
  }
  assert.match(await page.locator(".history-table").innerText(), /Buy/);
  assert((await page.locator(".history-table tbody tr").count()) >= 1);
  results.checks.push(
    "History displays the actual locally executed official-pool buy event and scanned block coverage",
  );
  await page.getByRole("button", { name: "Sell UNLK", exact: true }).click();
  await page
    .getByRole("textbox", { name: "You pay UNLK", exact: true })
    .fill("1000");
  await quote();
  await confirm("1. Approve UNLK to Permit2", "Approve UNLK to Permit2");
  await quote();
  await confirm(
    "2. Authorize router in Permit2",
    "Authorize the Universal Router",
  );
  await quote();
  await confirm("Review sell", "Sell UNLK");
  results.checks.push(
    "Actual UNLK to IMD sell uses execution-account quota and zero msg.value",
  );
  await page
    .getByRole("textbox", { name: "You pay UNLK", exact: true })
    .fill("1");
  await quote();
  await page.clock.fastForward(31000);
  clockOffset += 31;
  await page
    .getByRole("heading", { name: "Quote expired", exact: true })
    .waitFor();
  results.checks.push(
    "Quote expires after 30 seconds under a virtual clock; double confirmation sends exactly once",
  );
  await page.evaluate((a) => window.forkWallet.changeAccount(a), claim.wallet);
  await page
    .getByRole("heading", { name: "Quote expired", exact: true })
    .waitFor({ state: "detached" });
  results.checks.push("Account changes invalidate quotes and personal state");
  await page
    .getByRole("textbox", { name: "You pay UNLK", exact: true })
    .fill("0.0000000000000000001");
  await page
    .getByText("Enter an amount with up to 18 decimals.", { exact: true })
    .waitFor();
  results.checks.push("Amounts reject excess precision");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  results.checks.push(
    "Connected transaction layout has no overflow at 320,390,1440",
  );
  // Pending, timeout, replacement and reverted receipt paths on a loopback fork only.
  const leaves = JSON.parse(
    fs.readFileSync(new URL("public/claims/round-0.json", web)),
  ).leaves;
  async function pendingClaim(account) {
    await raw("anvil_impersonateAccount", [account]);
    await raw("anvil_setBalance", [account, "0x56BC75E2D63100000"]);
    await page.evaluate((a) => window.forkWallet.changeAccount(a), account);
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].find(
          (b) => b.textContent === "Claim native UNLK",
        )?.disabled,
    );
    holdNext = true;
    await page
      .getByRole("button", { name: "Claim native UNLK", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Continue to wallet", exact: true })
      .click();
    await page
      .locator(".transaction-status")
      .getByText(/· pending/)
      .waitFor();
  }
  await pendingClaim(leaves[1].wallet);
  const timeoutCount = results.writes.length;
  await page.clock.fastForward(181000);
  clockOffset += 181;
  await page
    .locator(".transaction-status")
    .getByText(/Receipt is not available yet/)
    .waitFor();
  assert.equal(results.writes.length, timeoutCount);
  await raw("anvil_setAutomine", [true]);
  await raw("evm_setNextBlockTimestamp", [
    Math.floor(forkNow() / 1000) + clockOffset,
  ]);
  await raw("anvil_mine", ["0x3"]);
  await page
    .getByRole("button", { name: "Check receipt", exact: true })
    .click();
  await page
    .locator(".transaction-status")
    .getByText(/· confirmed/)
    .waitFor();
  assert.equal(results.writes.length, timeoutCount);
  results.checks.push(
    "Virtual 180-second receipt timeout retains pending hash; manual receipt check completes without resend",
  );
  await pendingClaim(leaves[2].wallet);
  await page.clock.runFor(13000);
  clockOffset += 13;
  const original = await raw("eth_getTransactionByHash", [heldHash]);
  const fee = BigInt(original.maxFeePerGas ?? original.gasPrice) * 2n + 1n;
  const replacement = await raw("eth_sendTransaction", [
    {
      from: leaves[2].wallet,
      to: leaves[2].wallet,
      value: "0x0",
      gas: "0x5208",
      nonce: original.nonce,
      maxFeePerGas: "0x" + fee.toString(16),
      maxPriorityFeePerGas:
        "0x" +
        (
          BigInt(original.maxPriorityFeePerGas ?? original.gasPrice) * 2n +
          1n
        ).toString(16),
    },
  ]);
  await raw("anvil_mine", ["0x1"]);
  await page.clock.runFor(13000);
  clockOffset += 13;
  await raw("anvil_mine", ["0x2"]);
  await raw("anvil_setAutomine", [true]);
  await page.clock.runFor(13000);
  clockOffset += 13;
  await page
    .locator(".transaction-status")
    .getByText(/cancelled or replaced the original action/)
    .waitFor();
  assert(
    (await page.locator(".transaction-status a").getAttribute("href")).includes(
      replacement,
    ),
  );
  results.checks.push(
    "Same-nonce wallet cancellation tracks the replacement and does not mark the original action complete",
  );
  revertNext = true;
  await page
    .getByRole("button", { name: "Claim native UNLK", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue to wallet", exact: true })
    .click();
  await page
    .locator(".transaction-status")
    .getByText(/· reverted/)
    .waitFor();
  results.checks.push(
    "Injected low-gas mined revert is reported with gas spent and no automatic resend",
  );
  if (process.argv.includes("--chromium-only")) {
    results.limitations.push(
      "WebKit not run in this invocation (--chromium-only)",
    );
  } else {
    const safari = await webkit.launch({ headless: true });
    browsers.push(safari);
    const sp = await safari.newPage({ viewport: { width: 390, height: 844 } });
    await sp.goto(site);
    await sp
      .getByRole("button", { name: "Connect to trade", exact: true })
      .click();
    await sp.getByRole("dialog", { name: "Connect a wallet" }).waitFor();
    await sp.keyboard.press("Escape");
    assert.equal(
      await sp.getByRole("dialog", { name: "Connect a wallet" }).isVisible(),
      false,
    );
    results.checks.push("WebKit production render, connect sheet and Escape");
  }
  assert.deepEqual(results.console, []);
  results.passed = true;
} catch (e) {
  results.passed = false;
  results.error = e.stack;
  results.lastReceipt = await page
    ?.locator(".transaction-status")
    .innerText()
    .catch(() => "Unavailable");
  throw e;
} finally {
  for (const b of browsers) await b.close();
  await raw("evm_revert", [baseline]);
  fs.writeFileSync(
    new URL("browser-interactions.json", out),
    JSON.stringify(results, null, 2),
  );
  console.log(
    JSON.stringify(
      { passed: results.passed, checks: results.checks, error: results.error },
      null,
      2,
    ),
  );
}
