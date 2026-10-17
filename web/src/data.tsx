import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { client } from "./config";
import {
  loadSnapshot,
  loadWallet,
  type Snapshot,
  type WalletState,
} from "./live";
import {
  indexEvents,
  loadHolders,
  type IndexData,
  type Holder,
} from "./indexer";
import { useWallet, errorMessage } from "./wallet";
interface Data {
  snapshot: Snapshot | null;
  wallet: WalletState | null;
  index: IndexData | null;
  holders: Holder[] | null;
  error: string;
  walletError: string;
  historyError: string;
  refresh: () => void;
  loading: boolean;
  historyLoading: boolean;
}
const DataContext = createContext<Data>(null!);
export const useData = () => useContext(DataContext);
export function DataProvider({ children }: { children: ReactNode }) {
  const w = useWallet();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [index, setIndex] = useState<IndexData | null>(null);
  const [holders, setHolders] = useState<Holder[] | null>(null);
  const [error, setError] = useState("");
  const [walletError, setWalletError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const running = useRef(false);
  const activeAddress = useRef(w.address);
  activeAddress.current = w.address;
  async function refresh() {
    if (running.current) return;
    running.current = true;
    setLoading(true);
    try {
      const next = await loadSnapshot();
      setSnapshot(next);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const unwatch = client.watchBlockNumber({
      onBlockNumber: () => void refresh(),
      onError: () => {
        setError(
          "RPC connection interrupted. Cached values may be stale. Retry to reconnect.",
        );
      },
    });
    return unwatch;
  }, []);
  useEffect(() => {
    void refresh();
  }, [w.receiptVersion, w.network]);
  useEffect(() => {
    let alive = true;
    setWallet((current) =>
      current?.address.toLowerCase() === w.address?.toLowerCase()
        ? current
        : null,
    );
    setWalletError("");
    if (w.address && snapshot) {
      const address = w.address;
      loadWallet(address, snapshot)
        .then((x) => {
          if (alive && activeAddress.current === address) setWallet(x);
        })
        .catch((e) => {
          if (alive) setWalletError(errorMessage(e));
        });
    }
    return () => {
      alive = false;
    };
  }, [w.address, snapshot, w.receiptVersion]);
  useEffect(() => {
    if (!snapshot) return;
    let alive = true;
    setHistoryLoading(true);
    indexEvents(snapshot)
      .then(async (idx) => {
        if (!alive) return;
        setIndex(idx);
        setHistoryError(idx.complete ? "" : (idx.error ?? "Partial history"));
        const rows = await loadHolders(idx, snapshot);
        if (alive) setHolders(rows);
      })
      .catch((e) => {
        if (alive) setHistoryError(errorMessage(e));
      })
      .finally(() => {
        if (alive) setHistoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [snapshot?.block]);
  return (
    <DataContext.Provider
      value={{
        snapshot,
        wallet:
          wallet?.address.toLowerCase() === w.address?.toLowerCase()
            ? wallet
            : null,
        index,
        holders,
        error,
        walletError,
        historyError,
        refresh,
        loading,
        historyLoading,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
