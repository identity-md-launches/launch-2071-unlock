import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { prepareToolchain } from "./prepare-toolchain.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const compiler = path.join(prepareToolchain("typescript"), "lib/tsc.js");
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [compiler, "--project", "web/tsconfig.offline.json", ...args], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.signal) throw new Error(`TypeScript terminated by ${result.signal}`);
process.exitCode = result.status ?? 1;
