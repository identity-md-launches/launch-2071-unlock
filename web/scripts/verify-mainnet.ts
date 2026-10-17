import fs from "node:fs";
import { readMainnetCandidate } from "../src/mainnetReader";
import { mainnetClient, TOKEN, HOOK, POOL_ID } from "../src/mainnet";
const s = await readMainnetCandidate(null, mainnetClient);
const block = await mainnetClient.getBlock({ blockNumber: s.block });
const out = new URL("../evidence/", import.meta.url);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  new URL("live-verification.json", out),
  JSON.stringify(
    { evidence: "Fresh read-only Ethereum mainnet snapshot; no local mutation or public write",
      capturedAt: new Date().toISOString(), blockHash: block.hash,
      chainId: 1, TOKEN, HOOK, POOL_ID, ...s },
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
console.log(
  `Mainnet block ${s.block}: code and bindings verified, activated=${s.activated}, tier=${s.tier}, round0 certified=${s.certified}`,
);
