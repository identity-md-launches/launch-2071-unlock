import fs from "node:fs";
import { executeAbi, quoterAbi, permitAbi, erc20Abi } from "../src/mainnetAbis";
for (const [name, abi] of Object.entries({
  UniversalRouter: executeAbi,
  IV4Quoter: quoterAbi,
  Permit2: permitAbi,
  ERC20: erc20Abi,
}))
  fs.writeFileSync(
    new URL(`../public/abi/${name}.json`, import.meta.url),
    JSON.stringify(abi, null, 2) + "\n",
  );
console.log(
  "Exported the exact standard-router/Quoter/Permit2 interfaces exercised on the recorded mainnet fork.",
);
