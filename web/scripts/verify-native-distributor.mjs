import fs from "node:fs";
import { createPublicClient, http, keccak256 } from "viem";
const c = createPublicClient({
  transport: http("https://ethereum-rpc.publicnode.com"),
});
const b = BigInt(
  JSON.parse(fs.readFileSync("artifacts/fork-config.json")).block,
);
const factory = await c.getBytecode({
  address: "0x12c63b581d07093f6126bc02263c58f7eadaa96f",
  blockNumber: b,
});
const actual = await c.getBytecode({
  address: "0xc70795e2d8dfac6131038dcba84aa2aaed1ceed1",
  blockNumber: b,
});
const meta = JSON.parse(
  fs.readFileSync("docs/mainnet/release/native-distributor-artifact.json"),
);
const init = factory
  .slice(2)
  .slice(
    meta.factoryCreationBodyOffset * 2,
    (meta.factoryCreationBodyOffset + meta.creationBytes) * 2,
  );
const runtime = init.slice(0x167 * 2, (0x167 + meta.runtimeBytes) * 2);
let expected = runtime,
  masked = actual.slice(2);
let refs = [];
for (let i = 0; i < runtime.length / 2; ) {
  let op = parseInt(runtime.slice(i * 2, i * 2 + 2), 16),
    size = op >= 0x60 && op <= 0x7f ? op - 0x5f : 0;
  if (
    op === 0x7f &&
    runtime.slice((i + 1) * 2, (i + 33) * 2) === "0".repeat(64)
  ) {
    refs.push(i + 1);
    masked =
      masked.slice(0, (i + 1) * 2) +
      "0".repeat(64) +
      masked.slice((i + 33) * 2);
  }
  i += 1 + size;
}
const result = {
  block: String(b),
  factoryHash: keccak256(factory),
  initcodeHash: keccak256("0x" + init),
  expectedInitcodeHash: meta.creationKeccak,
  templateHash: keccak256("0x" + runtime),
  expectedTemplateHash: meta.runtimeTemplateKeccak,
  bytes: runtime.length / 2,
  immutableOffsets: refs,
  matched: expected === masked,
  runtimeHash: keccak256(actual),
};
fs.writeFileSync(
  "artifacts/native-distributor-verification.json",
  JSON.stringify(result, null, 2),
);
console.log(result);
if (!result.matched) process.exitCode = 1;
