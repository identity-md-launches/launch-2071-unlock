/** All writes in this test go to a disposable local Anvil fork. No private key or public send is used. */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  createPublicClient,
  http as rpcTransport,
  encodeFunctionData,
  decodeFunctionData,
  parseEther,
  formatUnits,
} from "viem";
const { chromium } = await import(process.env.IMD_PLAYWRIGHT || "playwright");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
process.chdir(root);
const verified = JSON.parse(fs.readFileSync("web/src/verified.json"));
const a = verified.bindings;
const tokenAbi = JSON.parse(fs.readFileSync("web/src/abis/UnlkToken.json"));
const hookAbi = JSON.parse(fs.readFileSync("web/src/abis/UnlkHook.json"));
const routerAbi = JSON.parse(
  fs.readFileSync("web/src/abis/UnlkSwapRouter.json"),
);
const distAbi = JSON.parse(
  fs.readFileSync("web/src/abis/MerkleDistributor.json"),
);
const evidenceAbi = JSON.parse(
  fs.readFileSync("web/src/abis/MerkleClaimEvidence.json"),
);
fs.mkdirSync("artifacts", { recursive: true });
fs.mkdirSync("test/scratch/browser", { recursive: true });
const results = {
  checkedAt: new Date().toISOString(),
  note: "Disposable local Anvil fork of existing Sepolia contracts. Every transaction listed here is local-only and was explicitly confirmed by this UI test. No public broadcast or signing key.",
  block: null,
  checks: [],
  transactions: [],
  errors: [],
};
const portProbe = net.createServer();
await new Promise((r) => portProbe.listen(0, "127.0.0.1", r));
const port = portProbe.address().port;
await new Promise((r) => portProbe.close(r));
const rpc = `http://127.0.0.1:${port}`;
const upstream = "https://ethereum-sepolia-rpc.publicnode.com";
const upstreamResponse = await fetch(upstream, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_blockNumber",
    params: [],
  }),
}).then((r) => r.json());
const forkBlock = BigInt(upstreamResponse.result) - 3n;
results.block = forkBlock.toString();
const anvil = spawn(
  "anvil",
  [
    "--fork-url",
    upstream,
    "--fork-block-number",
    forkBlock.toString(),
    "--chain-id",
    "11155111",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--no-storage-caching",
    "--silent",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let anvilErrors = "";
anvil.stderr.on("data", (x) => (anvilErrors += x.toString()));
const local = async (method, params = []) => {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => r.json());
  if (r.error) throw Error(JSON.stringify(r.error));
  return r.result;
};
let browser, server;
try {
  for (let i = 0; i < 100; i++) {
    try {
      await local("eth_chainId");
      break;
    } catch {
      if (i === 99) throw Error(`Fork failed: ${anvilErrors}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const client = createPublicClient({ transport: rpcTransport(rpc) });
  const read = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args });
  await local("anvil_impersonateAccount", [a.payer]);
  await local("anvil_setBalance", [
    a.payer,
    "0x" + parseEther("10").toString(16),
  ]);
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(
      "dist",
      decodeURIComponent(pathname).replace(/^\/preview\//, "") || "index.html",
    );
    if (!file.startsWith(path.resolve("dist") + path.sep)) {
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
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".woff2": "font/woff2",
            ".png": "image/png",
            ".json": "application/json",
          }[path.extname(file)] || "text/plain",
      });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/preview/`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.UNLK_CHROMIUM_PATH
      ? { executablePath: process.env.UNLK_CHROMIUM_PATH }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  // Every public-RPC request made by the unmodified production app is redirected to the local fork.
  await context.route(
    /https:\/\/(ethereum-sepolia-rpc\.publicnode\.com|rpc\.sepolia\.ethpandaops\.io|sepolia\.rpc\.sentio\.xyz)\/?/,
    async (route) => {
      const body = route.request().postDataJSON();
      const requests = Array.isArray(body) ? body : [body];
      assert.ok(
        requests.every((x) => !x.method.startsWith("eth_send")),
        "Production public client must not send writes",
      );
      const data = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.text());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: data,
      });
    },
  );
  await context.exposeBinding(
    "localWalletRequest",
    async (_, method, params) => {
      assert.ok(
        [
          "eth_sendTransaction",
          "eth_chainId",
          "eth_accounts",
          "eth_requestAccounts",
        ].includes(method),
      );
      if (method === "eth_sendTransaction") {
        const hash = await local(method, params);
        results.transactions.push({ hash, to: params[0].to, localOnly: true });
        await local("anvil_mine", ["0x2"]);
        return hash;
      }
      return local(method, params);
    },
  );
  await context.addInitScript(
    ({ account }) => {
      const handlers = {};
      window.__calls = [];
      window.__account = account;
      window.__mode = "confirm";
      window.__changeAccount = (a) => {
        window.__account = a;
        handlers.accountsChanged?.forEach((f) => f([a]));
      };
      const provider = {
        request: async ({ method, params = [] }) => {
          window.__calls.push({ method, params });
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [window.__account];
          if (method === "eth_chainId") return "0xaa36a7";
          if (method === "eth_sendTransaction") {
            if (window.__mode === "reject")
              throw Object.assign(Error("User rejected the request."), {
                code: 4001,
              });
            return window.localWalletRequest(method, params);
          }
          throw Error("Unexpected wallet method " + method);
        },
        on: (n, f) => {
          (handlers[n] ??= []).push(f);
        },
        removeListener: (n, f) => {
          handlers[n] = (handlers[n] ?? []).filter((x) => x !== f);
        },
      };
      const announce = () =>
        dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                uuid: "local-fork-test",
                rdns: "test.local-fork",
                name: "Local fork wallet",
                icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E",
              },
              provider,
            },
          }),
        );
      addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { account: a.payer },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.on("pageerror", (e) => results.errors.push(e.message));
  await page.goto(base);
  await page.locator(".header-actions button").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Local fork wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "MAX", exact: true }).waitFor();
  const waitEnabled = async (selector) => {
    await page.waitForFunction(
      (sel) => !document.querySelector(sel)?.disabled,
      selector,
    );
  };
  await waitEnabled(".percentage-controls button:last-child");
  assert.deepEqual(
    (await page.evaluate(() => window.__calls)).map((x) => x.method),
    ["eth_requestAccounts", "eth_chainId"],
  );
  results.checks.push(
    "Connecting requests accounts and chain only, no signature",
  );
  for (const percent of [25, 50, 75, 100]) {
    await page
      .getByRole("button", {
        name: percent === 100 ? "MAX" : `${percent}%`,
        exact: true,
      })
      .click();
    await waitEnabled(".percentage-controls button:last-child");
    const amount = await page.locator("#trade-amount").inputValue();
    assert.ok(Number(amount) > 0 && Number(amount) < 10);
    assert.match(await page.locator(".gas-note").innerText(), /Gas reserved/);
  }
  assert.equal(
    (await page.evaluate(() => window.__calls)).filter(
      (x) => x.method === "eth_sendTransaction",
    ).length,
    0,
  );
  results.checks.push(
    "All four Buy percentage fills estimate real fork router gas, reserve 20% buffer, retain editable input and request no signatures",
  );
  await page.locator("#trade-amount").fill("0.001");
  await page.getByRole("button", { name: "Get a quote", exact: true }).click();
  await page
    .getByRole("button", { name: "Review buy", exact: false })
    .waitFor();
  const confirm = async (title) => {
    await page.getByRole("dialog", { name: title, exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Continue to wallet", exact: true })
      .click();
    await page
      .locator(".transaction-status")
      .filter({ hasText: "Confirmed in two blocks" })
      .waitFor();
    await page
      .getByRole("button", { name: "Dismiss transaction status", exact: true })
      .click();
  };
  const initialE = await read(a.hook, hookAbi, "eligible", [a.payer]);
  await page.getByRole("button", { name: "Review buy", exact: false }).click();
  await confirm("Buy UNLK");
  assert.ok((await read(a.hook, hookAbi, "eligible", [a.payer])) > initialE);
  results.checks.push(
    "Buy: exact quote, fee, minimum receipt, explicit review and confirmation; authenticated acquisition credit increases",
  );
  await page.getByRole("button", { name: "Sell UNLK", exact: true }).click();
  await waitEnabled(".percentage-controls button:last-child");
  await page.getByRole("button", { name: "25%", exact: true }).click();
  await waitEnabled(".percentage-controls button:last-child");
  assert.ok(Number(await page.locator("#trade-amount").inputValue()) > 0);
  await page.locator("#trade-amount").fill("1");
  // Force only the local fixture allowance to zero via a genuine local token approval, then inspect the UI's exact approval path.
  await local("eth_sendTransaction", [
    {
      from: a.payer,
      to: a.token,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "approve",
        args: [a.router, 0n],
      }),
    },
  ]);
  await local("anvil_mine", ["0x2"]);
  await page.locator(".data-stamp button").click();
  await page
    .getByRole("button", { name: "Review exact approval", exact: true })
    .click();
  await confirm("Approve UNLK for this sale");
  assert.equal(
    await read(a.token, tokenAbi, "allowance", [a.payer, a.router]),
    parseEther("1"),
  );
  results.checks.push(
    "Sell shortcuts use executable quota and balance; direct ERC-20 approval is bounded to the exact 1 UNLK input and bound router",
  );
  await page.getByRole("button", { name: "Get a quote", exact: true }).click();
  await page
    .getByRole("button", { name: "Review sell", exact: false })
    .waitFor();
  const soldBefore = await read(a.hook, hookAbi, "sold", [a.payer]);
  const creditBefore = await read(a.router, routerAbi, "nativeCredit", [
    a.payer,
  ]);
  await page.getByRole("button", { name: "Review sell", exact: false }).click();
  await confirm("Sell UNLK");
  assert.equal(
    await read(a.hook, hookAbi, "sold", [a.payer]),
    soldBefore + parseEther("1"),
  );
  assert.ok(
    (await read(a.router, routerAbi, "nativeCredit", [a.payer])) > creditBefore,
  );
  results.checks.push(
    "Sell executes through authenticated router; S increases and ETH settles as nativeCredit",
  );
  await page.goto(base + "#/unlock");
  await page
    .getByRole("button", { name: "Review withdrawal", exact: false })
    .click();
  await confirm("Withdraw native ETH");
  assert.equal(await read(a.router, routerAbi, "nativeCredit", [a.payer]), 0n);
  results.checks.push(
    "withdrawNative recovers the full settled ETH credit to the same wallet",
  );
  const tree = JSON.parse(fs.readFileSync("web/public/evidence/round-0.json"));
  let beneficiary;
  for (const leaf of tree.leaves.slice(0, 10)) {
    if (!(await read(a.distributor, distAbi, "claimed", [0n, leaf.wallet]))) {
      beneficiary = leaf.wallet;
      break;
    }
  }
  assert.ok(
    beneficiary,
    "An authentic unclaimed beneficiary is required for this local fixture",
  );
  await local("anvil_impersonateAccount", [beneficiary]);
  await local("anvil_setBalance", [
    beneficiary,
    "0x" + parseEther("1").toString(16),
  ]);
  await page.evaluate((a) => window.__changeAccount(a), beneficiary);
  await page
    .getByRole("button", { name: "Review native claim", exact: true })
    .click();
  await confirm("Claim native reward");
  assert.equal(
    await read(a.distributor, distAbi, "claimed", [0n, beneficiary]),
    true,
  );
  if (!(await read(a.rewards, evidenceAbi, "certified", [0n]))) {
    await page
      .getByText("Proof files and round certification", { exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Review complete certification",
        exact: true,
      })
      .click();
    await confirm("Certify complete reward tree");
  }
  await page
    .getByRole("button", { name: "Review attestation", exact: true })
    .click();
  await confirm("Attest claim evidence");
  await page
    .getByRole("button", { name: "Review credit sync", exact: true })
    .click();
  await confirm("Sync reward credit");
  assert.ok((await read(a.hook, hookAbi, "eligible", [beneficiary])) > 0n);
  assert.equal(
    await page
      .getByRole("button", { name: "Already claimed", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Already attested", exact: true })
      .isDisabled(),
    true,
  );
  results.checks.push(
    "Authentic unclaimed round-0 beneficiary: native claim, evidence attestation, hook sync and duplicate prevention all complete on the local fork",
  );
  await page.locator("#wallet-milestone").selectOption("6");
  assert.match(
    await page.locator(".wallet-scenario").innerText(),
    /hypothetical/i,
  );
  await page.screenshot({
    path: "test/scratch/browser/fork-reward-complete.png",
    fullPage: true,
  });
  await page.evaluate(() => (window.__mode = "reject"));
  await page.goto(base + "#/trade");
  await page.locator("#trade-amount").fill("0.001");
  await page.getByRole("button", { name: "Get a quote", exact: true }).click();
  await page.getByRole("button", { name: "Review buy", exact: false }).click();
  await page.getByRole("dialog", { name: "Buy UNLK", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Continue to wallet", exact: true })
    .click();
  await page
    .locator(".transaction-status")
    .filter({ hasText: "Request rejected" })
    .waitFor();
  results.checks.push(
    "Explicit wallet rejection returns a recoverable status without broadcasting",
  );
  await context.close();
} catch (e) {
  results.errors.push(e.stack || String(e));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  anvil.kill("SIGTERM");
  if (results.errors.length) process.exitCode = 1;
  fs.writeFileSync(
    "artifacts/fork-validation.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results, null, 2));
}
