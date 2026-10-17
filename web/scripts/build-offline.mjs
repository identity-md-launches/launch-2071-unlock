// No npm install, network, environment variables, or node_modules required.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { prepareToolchain } from "./prepare-toolchain.mjs";
const require = createRequire(import.meta.url);
const esbuild = require(path.join(prepareToolchain("esbuild"), "lib/main.js"));
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.dirname(web);
const runtime = path.join(web,"vendor/runtime");
const lock = JSON.parse(fs.readFileSync(path.join(runtime,"lock.json"),"utf8"));
for (const module of lock.modules) {
  const bytes = fs.readFileSync(path.join(runtime,module.local));
  if (createHash("sha256").update(bytes).digest("hex") !== module.sha256) throw new Error(`Vendored module changed: ${module.local}`);
}
const alias = Object.fromEntries(Object.entries(lock.entries).map(([name,file])=>[name,path.join(runtime,file)]));
const common = { bundle:true, format:"esm", target:"es2022", jsx:"automatic", alias,
  define:{"process.env.NODE_ENV":'"production"'}, logLevel:"info", legalComments:"eof" };
if (process.argv.includes("--test")) {
  const out = path.join(root,"test/scratch/frontend"); fs.mkdirSync(out,{recursive:true});
  for (const file of fs.readdirSync(path.join(web,"tests")).filter(file=>file.endsWith(".test.ts"))) {
    esbuild.buildSync({...common,platform:"node",entryPoints:[path.join(web,"tests",file)],outfile:path.join(out,file.replace(/\.ts$/,".mjs"))});
  }
  console.log("Tests compiled into test/scratch/frontend. Run node --test from web/.");
} else {
  const out = path.join(root,"dist-candidate");
  // Existing historical dist/ is preserved as delivered. This is a separate source preview export.
  fs.mkdirSync(out,{recursive:true});
  fs.cpSync(path.join(web,"public"),out,{recursive:true});
  esbuild.buildSync({...common,platform:"browser",entryPoints:[path.join(web,"src/main.tsx")],outfile:path.join(out,"assets/app.js"),
    loader:{".woff2":"file",".png":"file",".svg":"file"},assetNames:"[name]-[hash]",minify:true,metafile:true});
  const html = fs.readFileSync(path.join(web,"index.html"),"utf8").replace('src="/src/main.tsx"','src="./assets/app.js"')
    .replace("</head>",'<link rel="stylesheet" href="./assets/app.css" /></head>');
  fs.writeFileSync(path.join(out,"index.html"),html);
  console.log("Built dist-candidate/ offline; publication is not authorized.");
}
