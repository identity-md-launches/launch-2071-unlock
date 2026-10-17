import fs from "node:fs";
import { keccak256 } from "viem";
import { root, config, read, codeFor, save, live } from "./mainnet-evidence.mjs";
const prep = read("live-preparation.json");
const factory = await codeFor("factory", prep.addresses.factory);
const actual = await codeFor("distributor", prep.addresses.distributor);
const meta = JSON.parse(
  fs.readFileSync(new URL("docs/mainnet/release/native-distributor-artifact.json", root)),
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
  block: config.block,
  factoryHash: keccak256(factory),
  initcodeHash: keccak256("0x" + init),
  expectedInitcodeHash: meta.creationKeccak,
  templateHash: keccak256("0x" + runtime),
  expectedTemplateHash: meta.runtimeTemplateKeccak,
  bytes: runtime.length / 2,
  immutableOffsets: refs,
  matched: expected === masked && keccak256(factory) === meta.factoryRuntimeKeccak &&
    keccak256("0x" + init) === meta.creationKeccak &&
    keccak256("0x" + runtime) === meta.runtimeTemplateKeccak,
  runtimeHash: keccak256(actual),
};
save(live ? "native-distributor-verification-live.json" : "native-distributor-verification.json", result);
console.log(result);
if (!result.matched) process.exitCode = 1;
