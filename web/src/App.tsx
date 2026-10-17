import { ConnectButton } from "./wallet";
import { NextRelease } from "./NextRelease";
export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="#main" aria-label="UNLOCK home">
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
          <a href="#trade">Trade</a>
          <a href="#rights">Selling rights</a>
          <a href="#milestones">Milestones</a>
          <a href="#treasury">Treasury</a>
        </nav>
        <ConnectButton />
      </header>
      <main id="main" tabIndex={-1}>
        <NextRelease />
      </main>
      <footer className="site-footer">
        <span>UNLOCK · Launch 2071 · Ethereum</span>
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
