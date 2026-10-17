import fs from "node:fs";
import { readMainnetCandidate } from "../src/mainnetReader";
import { mainnetClient, TOKEN, HOOK, POOL_ID } from "../src/mainnet";
const s = await readMainnetCandidate(null, mainnetClient);
fs.mkdirSync("../artifacts", { recursive: true });
fs.writeFileSync(
  "../artifacts/live-verification.json",
  JSON.stringify(
    { chainId: 1, TOKEN, HOOK, POOL_ID, ...s },
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
console.log(
  `Mainnet block ${s.block}: code and bindings verified, activated=${s.activated}, tier=${s.tier}, round0 certified=${s.certified}`,
);
