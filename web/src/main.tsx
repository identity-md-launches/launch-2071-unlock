import { createRoot } from "react-dom/client";
import { Component, type ReactNode } from "react";
import { App } from "./App";
import { WalletProvider } from "./wallet";
import "./styles.css";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="site-main">
        <h1>UNLOCK</h1>
        <p>
          The interface could not load. Reload to retry. No transaction is sent
          by reloading.
        </p>
        <button className="button" onClick={() => location.reload()}>
          Reload site
        </button>
        <p>Ethereum mainnet. Real assets and gas costs.</p>
        <a href="./recovery.html">Open contract links & native proofs</a>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <WalletProvider>
      <App />
    </WalletProvider>
  </ErrorBoundary>,
);
