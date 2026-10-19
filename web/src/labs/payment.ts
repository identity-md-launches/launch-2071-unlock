import { createWalletClient, custom, getAddress, sha256, stringToBytes, type Address, type Hex } from "viem";
import { chain, client } from "../config";
import { IMD, PERMIT2 } from "../mainnet";
import type { Provider } from "../wallet";

// x402 exact Permit2 proxy, a protocol spender, never a payment recipient.
// https://github.com/coinbase/x402/blob/main/typescript/packages/mechanisms/evm/src/constants.ts
export const EXACT_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" as const;
export const permitTypes = {
  PermitWitnessTransferFrom: [{ name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "witness", type: "Witness" }],
  TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
  Witness: [{ name: "to", type: "address" }, { name: "validAfter", type: "uint256" }],
} as const;
export const approvalTypes = { QuoteApproval: [
  { name: "resource", type: "string" }, { name: "requesterScopeHash", type: "bytes32" }, { name: "quoteId", type: "string" }, { name: "quoteHash", type: "bytes32" }, { name: "paymentHash", type: "bytes32" }, { name: "action", type: "string" }, { name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "payTo", type: "address" }, { name: "expiresAt", type: "uint256" },
] } as const;
export function canonical(v: any): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const hash32 = (v: string): Hex => {
  const h = v.startsWith("0x") ? v : `0x${v}`;
  if (!/^0x[\da-f]{64}$/i.test(h)) throw Error("The payment challenge contains an invalid binding hash.");
  return h as Hex;
};
export function validateChallenge(ch: any, orderId: string) {
  const q = ch?.quote, req = ch?.accepts?.[0];
  if (!q || !req || ch.x402Version !== 2 || ch.accepts.length !== 1 || q.id !== orderId || q.action !== "job.open" || !Number.isSafeInteger(q.expiresAt) || q.expiresAt < Date.now() / 1000 + 45 || (q.issuedAt !== undefined && (!Number.isSafeInteger(q.issuedAt) || q.issuedAt > Date.now() / 1000 + 60 || q.issuedAt >= q.expiresAt))) throw Error("The quote has expired or cannot safely be signed. Refresh the order and request a new quote only after its final status is known.");
  if (!q.payment || q.payment.network !== "eip155:1" || q.payment.scheme !== "exact" || q.payment.decimals !== 18 || req.network !== q.payment.network || req.scheme !== "exact" || req.extra?.assetTransferMethod !== "permit2" || typeof q.payment.asset !== "string" || q.payment.asset.toLowerCase() !== IMD.toLowerCase() || typeof req.asset !== "string" || req.asset.toLowerCase() !== IMD.toLowerCase() || req.amount !== q.payment.amount || getAddress(req.payTo) !== getAddress(q.payment.payTo) || BigInt(req.payTo) === 0n || typeof req.amount !== "string" || !/^\d+$/.test(req.amount) || BigInt(req.amount) <= 0n || !Number.isSafeInteger(req.maxTimeoutSeconds) || req.maxTimeoutSeconds <= 0 || req.maxTimeoutSeconds > 86400) throw Error("Payment terms do not match the Ethereum IMD quote. Nothing was signed.");
  const url = new URL(ch.resourceUrl);
  if (url.origin !== "https://api.imd.fun" || url.username || url.password || url.pathname !== `/requests/${orderId}/submit` || url.search || url.hash || (ch.resource && ch.resource.url !== ch.resourceUrl)) throw Error("The challenge is not bound to the official IMD order endpoint.");
  hash32(ch.requesterScopeHash); hash32(q.quoteHash);
  return { q, req };
}

export async function signAuditPayment(provider: Provider, account: Address, ch: any, orderId: string, onStep: (text: string) => void) {
  const { q, req } = validateChallenge(ch, orderId);
  const assertWallet = async () => {
    if (Number(await provider.request({ method: "eth_chainId" })) !== 1) throw Error("Switch your wallet to Ethereum before signing.");
    const accounts = await provider.request({ method: "eth_accounts" }) as string[];
    if (accounts[0]?.toLowerCase() !== account.toLowerCase()) throw Error("The wallet account changed. Sign in again before paying.");
    validateChallenge(ch, orderId);
  };
  await assertWallet();
  const accountCode = await client.getCode({ address: account });
  if (accountCode && accountCode !== "0x" && !accountCode.toLowerCase().startsWith("0xef0100")) throw Error("IMD audit payments currently support ordinary Ethereum accounts and EIP-7702 accounts. Contract wallets cannot pay this API yet. Use a supported wallet; no payment was signed.");
  const proxy = await client.getCode({ address: EXACT_PROXY });
  if (!proxy || proxy === "0x") throw Error("The documented x402 Permit2 proxy is not available on Ethereum. Payment is disabled.");
  const wallet = createWalletClient({ account, chain, transport: custom(provider) });
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = BigInt(`0x${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`).toString();
  const deadline = String(Math.min(q.expiresAt - 5, Math.floor(Date.now() / 1000) + Number(req.maxTimeoutSeconds || 120)));
  const authorization = { from: account, permitted: { token: getAddress(req.asset), amount: req.amount }, spender: EXACT_PROXY, nonce, deadline, witness: { to: getAddress(req.payTo), validAfter: "0" } };
  onStep("Signature 1 of 2: authorize the exact IMD payment for this recipient and deadline.");
  const signature = await wallet.signTypedData({ domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2 }, types: permitTypes, primaryType: "PermitWitnessTransferFrom", message: { ...authorization, permitted: { ...authorization.permitted, amount: BigInt(req.amount) }, nonce: BigInt(nonce), deadline: BigInt(deadline), witness: { ...authorization.witness, validAfter: 0n } } });
  await assertWallet();
  const payment = { x402Version: 2, ...(ch.resource ? { resource: ch.resource } : {}), accepted: req, payload: { signature, permit2Authorization: authorization } };
  onStep("Signature 2 of 2: bind this exact payment to the pinned audit quote.");
  const quoteSignature = await wallet.signTypedData({ domain: { name: "IdentityMD Paid Action", version: "1", chainId: 1 }, types: approvalTypes, primaryType: "QuoteApproval", message: { resource: ch.resourceUrl, requesterScopeHash: hash32(ch.requesterScopeHash), quoteId: q.id, quoteHash: hash32(q.quoteHash), paymentHash: sha256(stringToBytes(canonical(payment))), action: q.action, asset: getAddress(q.payment.asset), amount: BigInt(q.payment.amount), payTo: getAddress(q.payment.payTo), expiresAt: BigInt(q.expiresAt) } });
  await assertWallet();
  return { payment, quoteSignature };
}
