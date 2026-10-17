import { createRoot } from "react-dom/client";
import { Component, type ReactNode } from "react";
import { App } from "./App";
import { WalletProvider } from "./wallet";
import { DataProvider } from "./data";
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
        <p>Sepolia testnet - test assets, no real monetary value</p>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <WalletProvider>
      <DataProvider>
        <App />
      </DataProvider>
    </WalletProvider>
  </ErrorBoundary>,
);
