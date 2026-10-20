import { useEffect, useState } from "react";
import { ConnectButton } from "./wallet";
import { NextRelease } from "./NextRelease";
// Retired research routes resolve here without mounting the archived Labs runtime.
function currentSection() {
  const hash = location.hash.slice(1);
  if (hash.toLowerCase().startsWith("labs")) {
    history.replaceState(null, "", `${location.pathname}${location.search}#trade`);
    return "trade";
  }
  return hash && hash !== "main" ? hash : "trade";
}
export function App() {
  const [section, setSection] = useState(currentSection);
  useEffect(() => {
    const update = () => { if (location.hash === "#main") { document.getElementById("main")?.focus(); return; } setSection(currentSection()); };
    addEventListener("hashchange", update);
    return () => removeEventListener("hashchange", update);
  }, []);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="#trade" aria-label="UNLOCK home">
          <svg
            width="28"
            height="32"
            viewBox="0 0 28 32"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m14 2 12 11-12 17L2 13 14 2Zm-12 11h24M8 7l6 23 6-23"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          <span>
            UNLOCK<span className="accent">_</span>
          </span>
        </a>
        <nav aria-label="Primary navigation">
          {[
            ["trade", "Trade"],
            ["rights", "My Unlock"],
            ["milestones", "Milestones"],
            ["activity", "Activity"],
            ["treasury", "Treasury"],
            ["how", "Docs"],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={
                section === id || (id === "trade" && section === "main")
                  ? "location"
                  : undefined
              }
            >
              {label}
            </a>
          ))}
          <a href="./whitepaper/">Whitepaper</a>
        </nav>
        <ConnectButton />
      </header>
      <main id="main" tabIndex={-1}>
        <NextRelease />
      </main>
      <footer className="site-footer">
        <span>UNLOCK · Launch 2071 · Ethereum</span>
        <a href="./whitepaper/">English whitepaper</a>
        <a href="#how">Rules & risks</a>
        <a href="#contracts">Contracts</a>
        <a
          href="https://github.com/identity-md-launches/launch-2071-unlock/tree/40d70b7bd0853aedf84eac839a40a5f12e6ac341"
          target="_blank"
          rel="noreferrer"
        >
          Pinned contract source ↗
        </a>
        <p>
          Mainnet uses real assets. No guaranteed price, milestone, NFT purchase
          or return.
        </p>
      </footer>
    </>
  );
}
