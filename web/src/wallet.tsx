import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createWalletClient,
  custom,
  getAddress,
  type Abi,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { chain, client, RPC_URLS, explorer } from "./config";
import { verifyBindings } from "./live";
import { number, short } from "./math";
import { storage } from "./storage";
export type Provider = EIP1193Provider & {
  on?: (event: string, fn: (value: any) => void) => void;
  removeListener?: (event: string, fn: (value: any) => void) => void;
};
interface Discovered {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Provider;
}
export interface Action {
  title: string;
  description: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  details?: [string, string][];
  validate?: () => Promise<void>;
  onSuccess?: () => void;
}
interface Review {
  action: Action;
  account: Address;
  gas: bigint;
  gasPrice: bigint;
}
interface Transaction {
  superseded?: boolean;
  hash?: Hex;
  label: string;
  status:
    | "preparing"
    | "signing"
    | "pending"
    | "confirmed"
    | "reverted"
    | "rejected"
    | "error";
  message?: string;
}
interface Context {
  address?: Address;
  network?: number;
  provider?: Provider;
  open: () => void;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  review: (action: Action) => Promise<void>;
  tx: Transaction | null;
  busy: boolean;
  receiptVersion: number;
}
const WalletContext = createContext<Context>(null!);
export const useWallet = () => useContext(WalletContext);
export function errorMessage(e: unknown): string {
  const x = e as { shortMessage?: string; message?: string; code?: number };
  const text =
    x?.shortMessage ?? x?.message ?? "Unable to complete the request.";
  if (x?.code === 4001 || /rejected|denied/i.test(text))
    return "Request rejected in your wallet. Nothing was resent.";
  if (/QuotaExceeded/i.test(text))
    return "This sale exceeds the current allowance. Refresh your wallet data and enter a smaller amount.";
  if (/insufficient funds/i.test(text))
    return "Insufficient test ETH for the payment and gas. Add Sepolia ETH and try again.";
  if (/allowance/i.test(text))
    return "The router needs a sufficient token approval before it can simulate this sale.";
  return text.slice(0, 450);
}
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) d?.showModal();
    else if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export { Modal };
const coinbaseMark =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="#2c5ff6"/><circle cx="14" cy="14" r="10" fill="white"/><rect x="10" y="10" width="8" height="8" rx="1" fill="#2c5ff6"/></svg>',
  );
export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Discovered[]>([]);
  const [provider, setProvider] = useState<Provider>();
  const [address, setAddress] = useState<Address>();
  const [network, setNetwork] = useState<number>();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string>();
  const [connectionError, setConnectionError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [tx, setTx] = useState<Transaction | null>(null);
  const [receiptVersion, setReceiptVersion] = useState(0);
  const connectedRef = useRef({ address, network, provider });
  connectedRef.current = { address, network, provider };
  const monitoring = useRef(new Set<string>());
  useEffect(() => {
    const handler = (e: Event) => {
      const w = (e as CustomEvent<Discovered>).detail;
      if (!w?.info?.uuid || !w.provider) return;
      setWallets((old) =>
        old.some((x) => x.info.uuid === w.info.uuid) ? old : [...old, w],
      );
    };
    window.addEventListener("eip6963:announceProvider", handler);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () =>
      window.removeEventListener("eip6963:announceProvider", handler);
  }, []);
  async function connect(p: Provider, id: string, prompt = true) {
    setPending(id);
    setConnectionError("");
    try {
      const accounts = (await p.request({
        method: prompt ? "eth_requestAccounts" : "eth_accounts",
      })) as Address[];
      if (!accounts.length) return;
      const chainId = await p.request({ method: "eth_chainId" });
      setProvider(p);
      setAddress(getAddress(accounts[0]));
      setNetwork(Number(chainId));
      storage.set("unlk-wallet", id);
      setOpen(false);
    } catch (e) {
      setConnectionError(errorMessage(e));
    } finally {
      setPending(undefined);
    }
  }
  useEffect(() => {
    const stored = storage.get("unlk-wallet");
    if (!stored || provider) return;
    const w = wallets.find((w) => w.info.rdns === stored);
    if (w) void connect(w.provider, w.info.rdns, false);
    else if (stored === "coinbase") void coinbase(false);
    else if (stored === "browser" && (window as any).ethereum)
      void connect((window as any).ethereum, "browser", false);
  }, [wallets]);
  useEffect(() => {
    if (!provider) return;
    const accounts = (v: Address[]) => {
      setAddress(v[0] ? getAddress(v[0]) : undefined);
      setReview(null);
      setReceiptVersion((v) => v + 1);
    };
    const changed = (v: string) => {
      setNetwork(Number(v));
      setReview(null);
      setReceiptVersion((v) => v + 1);
    };
    const gone = () => {
      setAddress(undefined);
      setProvider(undefined);
      setReview(null);
    };
    provider.on?.("accountsChanged", accounts);
    provider.on?.("chainChanged", changed);
    provider.on?.("disconnect", gone);
    return () => {
      provider.removeListener?.("accountsChanged", accounts);
      provider.removeListener?.("chainChanged", changed);
      provider.removeListener?.("disconnect", gone);
    };
  }, [provider]);
  const disconnect = () => {
    setAddress(undefined);
    setProvider(undefined);
    setNetwork(undefined);
    setReview(null);
    storage.remove("unlk-wallet");
  };
  async function switchNetwork() {
    if (!provider) return;
    setConnectionError("");
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
    } catch (e) {
      if ((e as { code?: number }).code === 4902) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0xaa36a7",
                chainName: "Sepolia",
                rpcUrls: RPC_URLS,
                nativeCurrency: chain.nativeCurrency,
                blockExplorerUrls: [chain.blockExplorers.default.url],
              },
            ],
          });
        } catch (err) {
          setConnectionError(errorMessage(err));
        }
      } else setConnectionError(errorMessage(e));
    }
  }
  async function coinbase(prompt = true) {
    setPending("coinbase");
    try {
      const { createCoinbaseWalletSDK } = await import("@coinbase/wallet-sdk");
      const sdk = createCoinbaseWalletSDK({
        appName: "UNLOCK",
        appLogoUrl: new URL("./favicon.svg", location.href.split("#")[0]).href,
        appChainIds: [11155111],
        preference: { options: "smartWalletOnly" },
      });
      await connect(
        sdk.getProvider() as unknown as Provider,
        "coinbase",
        prompt,
      );
    } catch (e) {
      setConnectionError(errorMessage(e));
      setPending(undefined);
    }
  }
  const busy = !!tx && ["preparing", "signing", "pending"].includes(tx.status);
  async function monitor(hash: Hex, label: string, wasReplaced = false) {
    const monitoredHash = hash;
    if (monitoring.current.has(hash)) return;
    monitoring.current.add(hash);
    let replaced = wasReplaced;
    try {
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 2,
        timeout: 180000,
        onReplaced: (replacement) => {
          replaced = replaced || replacement.reason !== "repriced";
          hash = replacement.transactionReceipt.transactionHash;
          storage.set(
            "unlk-pending",
            JSON.stringify({ hash, label, superseded: replaced }),
          );
          setTx({
            hash,
            label,
            status: "pending",
            superseded: replaced,
            message:
              replacement.reason === "cancelled"
                ? "Wallet replacement detected; checking its receipt."
                : "Transaction replaced in your wallet; tracking the replacement.",
          });
        },
      });
      setTx({
        hash: receipt.transactionHash,
        label,
        status: replaced
          ? "rejected"
          : receipt.status === "success"
            ? "confirmed"
            : "reverted",
        message: replaced
          ? "Your wallet cancelled or replaced the original action. Inspect the replacement receipt; the original action is not marked complete."
          : receipt.status === "success"
            ? "Confirmed in two blocks. Refreshing on-chain data."
            : "The transaction reverted. Gas was spent; the action did not complete.",
      });
      storage.remove("unlk-pending");
      setReceiptVersion((v) => v + 1);
      return receipt.status === "success" && !replaced;
    } catch {
      setTx({
        hash,
        label,
        status: "pending",
        superseded: replaced,
        message:
          "Receipt is not available yet. Check the explorer or check again. No transaction was resent.",
      });
    } finally {
      monitoring.current.delete(monitoredHash);
    }
  }
  useEffect(() => {
    try {
      const stored = storage.get("unlk-pending");
      if (stored) {
        const x = JSON.parse(stored);
        if (/^0x[a-fA-F0-9]{64}$/.test(x.hash)) {
          setTx({
            hash: x.hash,
            label: x.label,
            status: "pending",
            superseded: !!x.superseded,
          });
          void monitor(x.hash, x.label, !!x.superseded);
        }
      }
    } catch {
      /* optional storage */
    }
  }, []);
  async function prepare(action: Action) {
    if (!address || !provider) {
      setOpen(true);
      return;
    }
    if (network !== chain.id) {
      await switchNetwork();
      return;
    }
    if (busy) return;
    setTx({ label: action.title, status: "preparing" });
    try {
      await verifyBindings(true);
      await action.validate?.();
      const req = {
        address: action.address,
        abi: action.abi,
        functionName: action.functionName,
        args: action.args ?? [],
        account: address,
        value: action.value ?? 0n,
      };
      await client.simulateContract(req);
      const [gas, gasPrice] = await Promise.all([
        client.estimateContractGas(req),
        client.getGasPrice(),
      ]);
      setReview({ action, account: address, gas, gasPrice });
      setTx(null);
    } catch (e) {
      setTx({ label: action.title, status: "error", message: errorMessage(e) });
    }
  }
  async function sign() {
    if (!review) return;
    const { action, account } = review;
    const ctx = connectedRef.current;
    if (!ctx.provider || ctx.address !== account || ctx.network !== chain.id) {
      setReview(null);
      setTx({
        label: action.title,
        status: "error",
        message: "Wallet or network changed. Review the action again.",
      });
      return;
    }
    setTx({ label: action.title, status: "preparing" });
    try {
      await verifyBindings(true);
      await action.validate?.();
      const freshAccounts = (await ctx.provider.request({
        method: "eth_accounts",
      })) as Address[];
      const freshChain = await ctx.provider.request({ method: "eth_chainId" });
      if (
        !freshAccounts[0] ||
        freshAccounts[0].toLowerCase() !== account.toLowerCase() ||
        Number(freshChain) !== chain.id
      )
        throw Error("Wallet or network changed. Review this action again.");
      const req = {
        address: action.address,
        abi: action.abi,
        functionName: action.functionName,
        args: action.args ?? [],
        account,
        value: action.value ?? 0n,
      };
      const sim = await client.simulateContract(req);
      const gas = await client.estimateContractGas(req);
      setTx({ label: action.title, status: "signing" });
      setReview(null);
      const wallet = createWalletClient({
        chain,
        transport: custom(ctx.provider),
        account,
      });
      const hash = await wallet.writeContract({
        ...sim.request,
        gas: (gas * 120n) / 100n,
        chain,
        account,
      });
      setTx({ hash, label: action.title, status: "pending" });
      storage.set(
        "unlk-pending",
        JSON.stringify({ hash, label: action.title }),
      );
      const succeeded = await monitor(hash, action.title);
      if (succeeded) action.onSuccess?.();
    } catch (e) {
      setReview(null);
      const message = errorMessage(e);
      setTx({
        label: action.title,
        status: /rejected/i.test(message) ? "rejected" : "error",
        message,
      });
    }
  }
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !wallets.length &&
    !(window as any).ethereum;
  const mobileLinks = [
    {
      name: "MetaMask",
      icon: "metamask",
      url: `https://link.metamask.io/dapp/${location.href.replace(/^https?:\/\//, "")}`,
    },
    {
      name: "Coinbase Wallet",
      icon: "coinbase",
      url: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(location.href)}`,
    },
    {
      name: "Rabby",
      icon: "rabby",
      url: `https://go.rabby.io/mobile/dapp?url=${encodeURIComponent(location.href)}`,
    },
    {
      name: "Phantom",
      icon: "phantom",
      url: `https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`,
    },
  ];
  return (
    <WalletContext.Provider
      value={{
        address,
        network,
        provider,
        open: () => {
          setConnectionError("");
          setOpen(true);
        },
        disconnect,
        switchNetwork,
        review: prepare,
        tx,
        busy,
        receiptVersion,
      }}
    >
      {children}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Connect a wallet"
      >
        <p className="muted">
          Read freely. Connecting asks for access to your address, never a
          signature or approval.
        </p>
        <div className="wallet-options">
          {wallets.map((w) => (
            <button
              key={w.info.uuid}
              disabled={!!pending}
              onClick={() => connect(w.provider, w.info.rdns)}
            >
              <img src={w.info.icon} alt="" width="28" height="28" />
              <span>
                {w.info.name}
                {pending === w.info.rdns ? " · opening…" : ""}
              </span>
            </button>
          ))}
          {!wallets.length && !mobile && (window as any).ethereum && (
            <button
              disabled={!!pending}
              onClick={() => connect((window as any).ethereum, "browser")}
            >
              <span aria-hidden="true">◇</span>Browser wallet
            </button>
          )}
          {mobile &&
            mobileLinks.map((w) => (
              <a className="wallet-link" href={w.url} key={w.name}>
                <img
                  width="28"
                  height="28"
                  src={
                    w.icon === "coinbase"
                      ? coinbaseMark
                      : `./wallets/${w.icon}.svg`
                  }
                  alt=""
                />
                Open in {w.name}
              </a>
            ))}
          <button disabled={!!pending} onClick={() => coinbase()}>
            <img src={coinbaseMark} alt="" width="28" height="28" />
            Coinbase Smart Wallet{pending === "coinbase" ? " · opening…" : ""}
          </button>
        </div>
        <p className="small muted">
          MetaMask and Rabby extensions appear when installed. On mobile, open
          this site in your wallet’s browser. Smart wallets call the same router
          directly; balances and allowances belong to that wallet’s address.
        </p>
        <p role="status" className="error">
          {connectionError}
        </p>
      </Modal>
      <Modal
        open={!!review}
        onClose={() => {
          if (!busy) setReview(null);
        }}
        title={review?.action.title ?? "Review transaction"}
      >
        {review && (
          <>
            <p>{review.action.description}</p>
            <dl className="details">
              <div>
                <dt>Network</dt>
                <dd>Sepolia testnet</dd>
              </div>
              <div>
                <dt>Contract</dt>
                <dd>
                  <a
                    href={explorer(review.action.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="address"
                  >
                    {review.action.address}
                  </a>
                </dd>
              </div>
              {review.action.details?.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              <div>
                <dt>ETH sent</dt>
                <dd>{number(review.action.value ?? 0n, 8)} test ETH</dd>
              </div>
              <div>
                <dt>Estimated gas</dt>
                <dd>~{number(review.gas * review.gasPrice, 8)} test ETH</dd>
              </div>
            </dl>
            <p className="small muted">
              Gas is an estimate. The action is simulated again before your
              wallet opens. Your wallet has the final fee and signing controls.
            </p>
            <button
              className="button primary full"
              disabled={busy}
              onClick={sign}
            >
              {busy ? "Checking again…" : "Continue to wallet"}
            </button>
          </>
        )}
      </Modal>
      {connectionError && !open && (
        <div className="connection-note" role="status">
          {connectionError}
          <button onClick={() => setConnectionError("")}>Dismiss</button>
        </div>
      )}
      {tx && (
        <aside className="transaction-status" role="status">
          <div>
            <strong>
              {tx.label} · {tx.status}
            </strong>
            {tx.message && <p>{tx.message}</p>}
            {tx.hash && (
              <a
                href={explorer(tx.hash, "tx")}
                target="_blank"
                rel="noreferrer"
              >
                View transaction ↗
              </a>
            )}
          </div>
          {tx.status === "pending" && tx.hash && (
            <button onClick={() => monitor(tx.hash!, tx.label, tx.superseded)}>
              Check receipt
            </button>
          )}
          {!busy && (
            <button
              className="icon-button"
              aria-label="Dismiss transaction status"
              onClick={() => setTx(null)}
            >
              ×
            </button>
          )}
        </aside>
      )}
    </WalletContext.Provider>
  );
}
export function ConnectButton() {
  const w = useWallet();
  if (w.address && w.network !== chain.id)
    return (
      <button className="button compact" onClick={w.switchNetwork}>
        Switch to Sepolia
      </button>
    );
  return w.address ? (
    <button className="button compact" onClick={w.disconnect} title={w.address}>
      {short(w.address)} · Disconnect
    </button>
  ) : (
    <button className="button compact" onClick={w.open}>
      Connect wallet <span aria-hidden="true">↗</span>
    </button>
  );
}
