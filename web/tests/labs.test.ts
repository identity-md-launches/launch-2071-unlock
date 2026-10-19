import test from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters, sha256, stringToBytes, hashTypedData, type Address, type Hex } from "viem";
import { githubRepository, scopePaths, safeExternal } from "../src/labs/api";
import { conversionArgs, ethImdKey, assertLabsNativeFunding } from "../src/labs/conversion";
import { canonical, validateChallenge, signAuditPayment, permitTypes, approvalTypes, EXACT_PROXY } from "../src/labs/payment";
import { client, NATIVE } from "../src/config";
import { IMD, PERMIT2, UNIVERSAL_ROUTER } from "../src/mainnet";
import { executeAbi } from "../src/mainnetAbis";
import type { Provider } from "../src/wallet";
import { isMarketsData, usd } from "../src/labs/data";

// All wallets/signatures/challenges below are simulated. No transaction or paid order is sent.
const account = "0xFe44fC8F6C32f681a0ce443902a0b08bB5B3C736" as Address;
const orderId = "0528a007-5ec6-4acd-b9cc-b3ded6fe2929";
const payTo = "0x4e0fa57bde726079356537e2f34d671e9f41adbc";
const fixedNow = 1792400000000;
const binding = "11".repeat(32);
test("one unavailable token symbol preserves a partially available catalog and null metrics", () => {
  const result = { updatedAt: new Date(fixedNow).toISOString(), mode: "cached", chainId: 1, featured: null, markets: [{ address: IMD, symbol: null, name: "Identity.md", priceUsd: null, liquidityUsd: null, volume24h: null, fdv: null, status: "unavailable" }], coverage: { notes: ["Token metadata read failed; address remains known."] }, errors: ["RPC unavailable"] };
  assert.equal(isMarketsData(result), true);
  assert.equal(usd(result.markets[0].priceUsd), "Unavailable");
  assert.equal(isMarketsData({ ...result, markets: [{ ...result.markets[0], address: "javascript:unsafe" }] }), false);
});
function challenge() {
  const payment = { network: "eip155:1", asset: IMD, amount: "500000000000000000", payTo, decimals: 18, scheme: "exact" };
  return { x402Version: 2, quote: { id: orderId, action: "job.open", issuedAt: Math.floor(fixedNow / 1000), expiresAt: Math.floor(fixedNow / 1000) + 600, payment, quoteHash: binding }, accepts: [{ network: payment.network, asset: payment.asset, amount: payment.amount, payTo: payment.payTo, scheme: "exact", maxTimeoutSeconds: 120, extra: { assetTransferMethod: "permit2" } }], resourceUrl: `https://api.imd.fun/requests/${orderId}/submit`, resource: { url: `https://api.imd.fun/requests/${orderId}/submit`, description: "Audit", mimeType: "application/json" }, requesterScopeHash: binding };
}

test("repository URLs reject unsafe schemes, credentials and non-root targets", () => {
  assert.equal(githubRepository("https://github.com/identity-md-launches/launch-2071-unlock.git"), "https://github.com/identity-md-launches/launch-2071-unlock");
  for (const url of ["javascript:alert(1)", "http://github.com/o/r", "https://github.com.evil.test/o/r", "https://user:pass@github.com/o/r", "https://github.com:444/o/r", "https://github.com/o/r/tree/main", "https://github.com/o/r?q=x", "https://github.com/o/r#scope", "https://127.0.0.1/o/r"]) assert.throws(() => githubRepository(url));
});

test("scope paths remain relative, bounded and deduplicated", () => {
  assert.deepEqual(scopePaths("src/contracts\nsrc/lib,src/contracts"), ["src/contracts", "src/lib"]);
  for (const scope of ["", "../secret", "/etc/passwd", "src/../../secret", "src/./file", "src//file", "https://evil.test/code", "src\\file", "src/<script>", Array.from({ length: 17 }, (_, i) => `src/${i}`).join("\n")]) assert.throws(() => scopePaths(scope));
});

test("report/source links allow only explicit HTTPS source domains", () => {
  assert.equal(safeExternal("https://github.com/identity-md-launches/launch-2071-unlock"), "https://github.com/identity-md-launches/launch-2071-unlock");
  for (const url of ["javascript:alert(1)", "data:text/html,<script>", "https://etherscan.io.evil.test/tx/x", "https://user@etherscan.io/tx/x", "https://etherscan.io:444/tx/x", "http://etherscan.io/tx/x"]) assert.equal(safeExternal(url), undefined);
});

test("exact-output commands enforce bounded ETH input, exact IMD output and customer refund", () => {
  // Official UniversalRouter 2.0.0, v4-periphery dependency 444c526b77d804590f0d7bc5a481af5a3277c952.
  const amount = 500000000000000000n, max = 1200000000000000n, deadline = 1792400120n;
  const [commands, inputs, expiry] = conversionArgs(account, amount, max, deadline);
  assert.equal(commands, "0x1004"); assert.equal(expiry, deadline); assert.equal(inputs.length, 2);
  const [actions, params] = decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), inputs[0]);
  assert.equal(actions, "0x080c0f"); assert.equal(params.length, 3);
  const [swap] = decodeAbiParameters(parseAbiParameters("((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountOut,uint128 amountInMaximum,bytes hookData)"), params[0]);
  assert.equal(swap.poolKey.currency0.toLowerCase(), NATIVE); assert.equal(swap.poolKey.currency1.toLowerCase(), IMD.toLowerCase());
  assert.equal(swap.poolKey.fee, ethImdKey.fee); assert.equal(swap.poolKey.tickSpacing, 200); assert.equal(swap.poolKey.hooks.toLowerCase(), NATIVE);
  assert.equal(swap.zeroForOne, true); assert.equal(swap.amountOut, amount); assert.equal(swap.amountInMaximum, max); assert.equal(swap.hookData, "0x");
  const [settleCurrency, settleMax] = decodeAbiParameters(parseAbiParameters("address,uint256"), params[1]); assert.equal(settleCurrency.toLowerCase(), NATIVE); assert.equal(settleMax, max);
  const [takeCurrency, takeMinimum] = decodeAbiParameters(parseAbiParameters("address,uint256"), params[2]); assert.equal(takeCurrency.toLowerCase(), IMD.toLowerCase()); assert.equal(takeMinimum, amount);
  const [refundCurrency, recipient, refundMinimum] = decodeAbiParameters(parseAbiParameters("address,address,uint256"), inputs[1]);
  assert.equal(refundCurrency.toLowerCase(), NATIVE); assert.equal(recipient.toLowerCase(), account.toLowerCase()); assert.equal(refundMinimum, 0n);
});

test("exact-output ABI rejects amounts outside uint128", () => { assert.throws(() => conversionArgs(account, 1n << 128n, 1n, 100n)); assert.throws(() => conversionArgs(account, 1n, -1n, 100n)); });

test("native-funding exception accepts only the exact fresh verified conversion request", () => {
  const amount = 500000000000000000n, expected = 1000000000000000n, slippage = 50, maximum = (expected * 10050n + 9999n) / 10000n, deadline = BigInt(fixedNow / 1000 + 120);
  const quote = { amount, expected, slippage, maximum, deadline, quotedAt: fixedNow, account };
  const valid = () => ({ address: UNIVERSAL_ROUTER as Address, abi: executeAbi, functionName: "execute", args: conversionArgs(account, amount, maximum, deadline), value: maximum, labsFunding: { ...quote } });
  assert.doesNotThrow(() => assertLabsNativeFunding(valid(), account, fixedNow));
  const mutations: Array<(action: any) => void> = [
    action => { delete action.labsFunding; }, action => { action.address = IMD; }, action => { action.functionName = "approve"; },
    action => { action.labsFunding.account = IMD; }, action => { action.value += 1n; }, action => { action.labsFunding.maximum += 1n; },
    action => { action.labsFunding.amount = 0n; }, action => { action.labsFunding.amount = 1n << 128n; }, action => { action.labsFunding.expected = 0n; },
    action => { action.labsFunding.slippage = 0; }, action => { action.labsFunding.slippage = 501; },
    action => { action.labsFunding.quotedAt = fixedNow - 60001; }, action => { action.labsFunding.quotedAt = fixedNow + 1001; },
    action => { action.labsFunding.deadline = BigInt(fixedNow / 1000 + 15); }, action => { action.labsFunding.deadline = BigInt(fixedNow / 1000 + 122); },
    action => { action.args = conversionArgs(IMD, amount, maximum, deadline); }, // Foreign refund recipient.
    action => { action.args = conversionArgs(account, amount + 1n, maximum, deadline); }, // Changed output.
    action => { action.args = conversionArgs(account, amount, maximum + 1n, deadline); }, // Changed route limit.
    action => { action.args = ["0x9004", action.args[1], deadline]; }, // Revert-allowed v4 command.
  ];
  for (const mutate of mutations) { const action = valid(); mutate(action); assert.throws(() => assertLabsNativeFunding(action, account, fixedNow)); }
});

test("native-funding exception rejects a foreign pool even when its command envelope is valid", () => {
  const amount = 500000000000000000n, expected = 1000000000000000n, maximum = (expected * 10050n + 9999n) / 10000n, deadline = BigInt(fixedNow / 1000 + 120);
  const [commands, originalInputs] = conversionArgs(account, amount, maximum, deadline);
  const [actions, params] = decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), originalInputs[0]);
  const foreignSwap = encodeAbiParameters(parseAbiParameters("((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountOut,uint128 amountInMaximum,bytes hookData)"), [{ poolKey: { ...ethImdKey, fee: 500 }, zeroForOne: true, amountOut: amount, amountInMaximum: maximum, hookData: "0x" }]);
  const foreignV4 = encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [actions, [foreignSwap, params[1], params[2]]]);
  const action = { address: UNIVERSAL_ROUTER as Address, abi: executeAbi, functionName: "execute", args: [commands, [foreignV4, originalInputs[1]], deadline] as const, value: maximum, labsFunding: { amount, expected, slippage: 50, maximum, deadline, quotedAt: fixedNow, account } };
  assert.throws(() => assertLabsNativeFunding(action, account, fixedNow), /calldata changed/);
});

test("current IMD Permit2 challenge accepts only its exact quote and official endpoint", (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  assert.equal(validateChallenge(challenge(), orderId).q.id, orderId);
  const cases: Array<(ch: any) => void> = [
    ch => { ch.quote.id = "different-order"; }, ch => { ch.quote.action = "launch.open"; }, ch => { ch.quote.expiresAt = fixedNow / 1000 + 44; },
    ch => { ch.accepts[0].network = "eip155:8453"; }, ch => { ch.quote.payment.network = "eip155:8453"; }, ch => { ch.accepts[0].scheme = "upto"; },
    ch => { ch.accepts[0].asset = NATIVE; }, ch => { ch.quote.payment.asset = NATIVE; }, ch => { ch.accepts[0].amount = "1"; }, ch => { ch.accepts[0].payTo = account; },
    ch => { ch.accepts[0].extra.assetTransferMethod = "eip3009"; }, ch => { ch.resourceUrl = `https://evil.test/requests/${orderId}/submit`; },
    ch => { ch.resourceUrl += "?redirect=evil"; }, ch => { ch.requesterScopeHash = "not-a-hash"; }, ch => { ch.quote.quoteHash = "00"; },
    ch => { ch.x402Version = 1; }, ch => { ch.accepts.push({ ...ch.accepts[0] }); }, ch => { ch.quote.payment.decimals = 6; }, ch => { ch.quote.payment.scheme = "upto"; },
    ch => { ch.accepts[0].maxTimeoutSeconds = Infinity; }, ch => { ch.accepts[0].maxTimeoutSeconds = 0; }, ch => { ch.resourceUrl = `https://user:pass@api.imd.fun/requests/${orderId}/submit`; },
  ];
  for (const mutate of cases) { const value = challenge(); mutate(value); assert.throws(() => validateChallenge(value, orderId)); }
});

test("challenge rejects missing, nonfinite and non-integer expiry before any wallet signature", (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  for (const expiry of [undefined, NaN, Infinity, "1792400600", 1792400600.5]) { const value: any = challenge(); value.quote.expiresAt = expiry; assert.throws(() => validateChallenge(value, orderId)); }
});

test("canonical payment hashes are stable over property insertion order and bind payment changes", () => {
  const one = { z: ["a", { value: "500000000000000000", a: 1 }], a: "test" };
  const two = { a: "test", z: ["a", { a: 1, value: "500000000000000000" }] };
  assert.equal(canonical(one), canonical(two)); assert.equal(sha256(stringToBytes(canonical(one))), sha256(stringToBytes(canonical(two))));
  assert.notEqual(sha256(stringToBytes(canonical(one))), sha256(stringToBytes(canonical({ ...one, a: "changed" }))));
});

test("mock payment signs exact Permit2 witness then binds complete payload hash to quote", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  t.mock.method(client, "getCode", async ({ address }: any) => address.toLowerCase() === account.toLowerCase() ? "0x" as Hex : "0x6000" as Hex);
  const signed: any[] = [];
  const provider = { request: async ({ method, params }: any) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_accounts") return [account];
    if (method === "eth_signTypedData_v4") { signed.push(JSON.parse(params[1])); return `0x${"11".repeat(65)}`; }
    throw Error(`Unexpected wallet method ${method}`);
  } } as unknown as Provider;
  const ch = challenge(); const result = await signAuditPayment(provider, account, ch, orderId, () => {});
  assert.equal(signed.length, 2); assert.equal(signed[0].primaryType, "PermitWitnessTransferFrom"); assert.deepEqual(signed[0].types.PermitWitnessTransferFrom, permitTypes.PermitWitnessTransferFrom);
  assert.equal(signed[0].domain.name, "Permit2"); assert.equal(BigInt(signed[0].domain.chainId), 1n); assert.equal(signed[0].domain.verifyingContract.toLowerCase(), PERMIT2.toLowerCase());
  assert.equal(signed[0].message.permitted.amount, ch.quote.payment.amount); assert.equal(signed[0].message.spender.toLowerCase(), EXACT_PROXY.toLowerCase()); assert.equal(signed[0].message.witness.to.toLowerCase(), payTo);
  assert.ok(BigInt(signed[0].message.deadline) < BigInt(ch.quote.expiresAt)); assert.equal(signed[0].message.witness.validAfter, "0");
  assert.deepEqual(result.payment.accepted, ch.accepts[0]); assert.equal(result.payment.payload.permit2Authorization.from.toLowerCase(), account.toLowerCase());
  assert.equal(signed[1].primaryType, "QuoteApproval"); assert.deepEqual(signed[1].types.QuoteApproval, approvalTypes.QuoteApproval);
  assert.equal(signed[1].message.paymentHash, sha256(stringToBytes(canonical(result.payment)))); assert.equal(signed[1].message.resource, ch.resourceUrl); assert.equal(signed[1].message.quoteId, orderId); assert.equal(signed[1].message.requesterScopeHash, `0x${binding}`);
  assert.match(hashTypedData({ domain: { name: "IdentityMD Paid Action", version: "1", chainId: 1 }, types: approvalTypes, primaryType: "QuoteApproval", message: { ...signed[1].message, amount: BigInt(signed[1].message.amount), expiresAt: BigInt(signed[1].message.expiresAt) } }), /^0x[0-9a-f]{64}$/);
});

test("wallet network/account changes stop the mock payment before subsequent signatures", async (t) => {
  t.mock.method(Date, "now", () => fixedNow); t.mock.method(client, "getCode", async ({ address }: any) => address.toLowerCase() === account.toLowerCase() ? "0x" as Hex : "0x6000" as Hex);
  let signatures = 0;
  const provider = { request: async ({ method }: any) => {
    if (method === "eth_chainId") return signatures ? "0x2105" : "0x1";
    if (method === "eth_accounts") return [account];
    if (method === "eth_signTypedData_v4") { signatures++; return `0x${"11".repeat(65)}`; }
    throw Error(method);
  } } as unknown as Provider;
  await assert.rejects(signAuditPayment(provider, account, challenge(), orderId, () => {}), /Switch your wallet to Ethereum/); assert.equal(signatures, 1);
});

test("wallet account changes after the first signature stop quote approval", async (t) => {
  t.mock.method(Date, "now", () => fixedNow); t.mock.method(client, "getCode", async ({ address }: any) => address.toLowerCase() === account.toLowerCase() ? "0x" as Hex : "0x6000" as Hex);
  let signatures = 0;
  const provider = { request: async ({ method }: any) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_accounts") return signatures ? [IMD] : [account];
    if (method === "eth_signTypedData_v4") { signatures++; return `0x${"11".repeat(65)}`; }
    throw Error(method);
  } } as unknown as Provider;
  await assert.rejects(signAuditPayment(provider, account, challenge(), orderId, () => {}), /wallet account changed/); assert.equal(signatures, 1);
});

test("unsupported contract-wallet payment is disabled before any signature", async (t) => {
  t.mock.method(Date, "now", () => fixedNow); t.mock.method(client, "getCode", async () => "0x6000" as Hex);
  let signatures = 0;
  const provider = { request: async ({ method }: any) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_accounts") return [account];
    if (method === "eth_signTypedData_v4") { signatures++; return `0x${"11".repeat(65)}`; }
    throw Error(method);
  } } as unknown as Provider;
  await assert.rejects(signAuditPayment(provider, account, challenge(), orderId, () => {}), /Contract wallets cannot pay/); assert.equal(signatures, 0);
});
