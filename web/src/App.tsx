import { useEffect, useRef, useState } from "react";
import { MyUnlock, Milestones, Activity, HowItWorks, Contracts } from "./pages";
import { NextRelease } from "./NextRelease";
import { Terminal } from "./Terminal";
import { ConnectButton } from "./wallet";
import { Emblem } from "./components";
import { REPO } from "./config";
const navigation = [
  ["trade", "Trade"],
  ["unlock", "My Unlock"],
  ["milestones", "Milestones"],
  ["activity", "Activity"],
  ["how", "Docs"],
  ["treasury", "Next release"],
] as const;
export function App() {
  const [route, setRoute] = useState(
    location.hash.replace(/^#\/?/, "").split("?")[0] || "trade",
  );
  const main = useRef<HTMLElement>(null);
  const changed = useRef(false);
  useEffect(() => {
    const onHash = () => {
      setRoute(location.hash.replace(/^#\/?/, "").split("?")[0] || "trade");
      changed.current = true;
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.title = `${navigation.find(([key]) => key === route)?.[1] ?? "Contracts"} · UNLOCK`;
    window.scrollTo({ top: 0, behavior: "instant" });
    if (changed.current) main.current?.focus({ preventScroll: true });
  }, [route]);
  const page =
    route === "treasury" ? (
      <NextRelease />
    ) : route === "unlock" ? (
      <MyUnlock />
    ) : route === "milestones" ? (
      <Milestones />
    ) : route === "activity" ? (
      <Activity />
    ) : route === "how" ? (
      <HowItWorks />
    ) : route === "contracts" ? (
      <Contracts />
    ) : (
      <Terminal />
    );
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <a
          className="brand"
          href="#/trade"
          aria-label="UNLOCK trading workspace"
        >
          <Emblem />
          <span>
            UNLOCK
            <span className="brand-cursor" aria-hidden="true">
              _
            </span>
          </span>
        </a>
        <nav className="main-nav" aria-label="Primary navigation">
          {navigation.map(([key, label]) => (
            <a
              key={key}
              href={`#/${key}`}
              aria-current={route === key ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <ConnectButton />
        </div>
      </header>
      <div className="testnet-banner">
        <span className="testnet-dot" aria-hidden="true" />
        <strong>Sepolia testnet</strong>
        <span>Test assets, no real monetary value</span>
      </div>
      <main
        id="main"
        ref={main}
        tabIndex={-1}
        className={`site-main route-${route}`}
      >
        {page}
      </main>
      <footer className="site-footer">
        <span>
          UNLOCK / 1560 <span className="muted">· Sepolia only</span>
        </span>
        <div>
          <a href="#/how">Rules & risks</a>
          <a href="#/contracts">Contracts & evidence ↗</a>
          <a href={REPO} target="_blank" rel="noreferrer">
            Source ↗
          </a>
        </div>
        <p>
          Test assets, no real monetary value. No guaranteed price, milestone or
          return.
        </p>
      </footer>
    </>
  );
}
