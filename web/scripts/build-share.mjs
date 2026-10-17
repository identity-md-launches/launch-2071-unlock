import fs from "node:fs";
const { chromium } = await import(process.env.IMD_PLAYWRIGHT ?? "playwright");
const rates = [
  20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
];
const targets = [
  "Initial",
  "$100K",
  "$250K",
  "$500K",
  "$1M",
  "$2M",
  "$3.5M",
  "$5M",
  "$7.5M",
  "$10M",
  "$15M",
  "$20M",
  "$25M",
  "$30M",
  "$35M",
  "$40M",
  "$50M",
];
const points = rates.map((r, i) => ({ x: 60 + i * 67.5, y: 466 - i * 14, r }));
const step = points
  .map((p, i) => (i ? `H${p.x}V${p.y}` : `M${p.x} ${p.y}`))
  .join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#09090b"/><g font-family="JetBrains Mono,monospace"><path d="m70 24 16 14-16 22-16-22 16-14zm-16 14h32m-24-7 8 29 8-29" stroke="#34d399" fill="none" stroke-width="1.5"/><text x="104" y="49" font-size="24" fill="#f4f4f5" font-weight="600">UNLOCK_</text><text x="1140" y="47" text-anchor="end" font-size="16" fill="#a1a1aa">Ethereum mainnet · UNLK / IMD</text><path d="M60 84h1080" stroke="#27272a"/><text x="60" y="152" fill="#f4f4f5" font-size="48" font-weight="600">Every milestone stays open.</text><text x="60" y="191" fill="#a1a1aa" font-size="20">Initial 20%. Sixteen permanent FDV gates. Global bypass at $50M.</text><g stroke="#27272a" fill="none"><path d="M60 270h1080M60 340h1080M60 410h1080M60 480h1080"/></g><path d="${step}" stroke="#fbbf24" fill="none" stroke-width="2" stroke-dasharray="5 5"/>${points.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#09090b" stroke="#34d399" stroke-width="2"/><text x="${p.x}" y="${p.y - 14}" text-anchor="middle" fill="#f4f4f5" font-size="14">${i === 16 ? "Bypass" : p.r + "%"}</text><text x="${p.x}" y="514" text-anchor="middle" fill="#a1a1aa" font-size="12">${targets[i]}</text>`).join("")}<path d="M60 548h1080" stroke="#27272a"/><text x="60" y="587" fill="#a1a1aa" font-size="16">Rules, not a price chart. Mainnet uses real assets. No guaranteed price or return.</text></g></svg>`;
const path = new URL("../public/share.svg", import.meta.url);
fs.writeFileSync(path, svg + "\n");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const fonts = [400, 600]
    .map((weight) => {
      const name = weight === 400 ? "regular" : "semibold";
      const bytes = fs.readFileSync(
        new URL(
          `../src/assets/fonts/jetbrains-mono-${name}.woff2`,
          import.meta.url,
        ),
      );
      return `@font-face{font-family:"JetBrains Mono";font-weight:${weight};src:url(data:font/woff2;base64,${bytes.toString("base64")})}`;
    })
    .join("");
  await page.setContent(`<style>${fonts}body{margin:0}</style>${svg}`);
  await page.evaluate(async () => {
    await document.fonts.load('400 14px "JetBrains Mono"');
    await document.fonts.load('600 24px "JetBrains Mono"');
    await document.fonts.ready;
  });
  await page.screenshot({
    path: new URL("../public/share.png", import.meta.url).pathname,
  });
} finally {
  await browser.close();
}
