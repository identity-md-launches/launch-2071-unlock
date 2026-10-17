import type { ReactNode } from "react";
import { useData } from "./data";
import { number, exact, date } from "./math";
import { explorer } from "./config";
export function Emblem({ large = false }: { large?: boolean }) {
  return (
    <svg
      className={large ? "emblem emblem-large" : "emblem"}
      viewBox="0 0 320 360"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M160 20 284 118 160 326 36 118Z"
        stroke="currentColor"
        strokeWidth={large ? 1 : 9}
      />
      <path
        d="M36 118h248M95 66l65 260 65-260M95 66h130M160 20v98M36 118l124 208 124-208M95 66l65 52 65-52M95 66 36 118m189-52 59 52"
        stroke="currentColor"
        strokeWidth={large ? 1 : 5}
      />
      {large && (
        <>
          <path
            d="m160 20 65 46 59 52"
            stroke="var(--accent)"
            strokeWidth="2"
          />
          <path d="M95 66 160 118l65-52" fill="var(--emblem-fill)" />
          <circle cx="160" cy="118" r="5" fill="var(--accent)" />
          <path d="M160 342v12M4 118h16m280 0h16" stroke="var(--text-muted)" />
        </>
      )}
    </svg>
  );
}
export function Amount({
  value,
  unit = "UNLK",
  digits = 4,
}: {
  value: bigint | null | undefined;
  unit?: string;
  digits?: number;
}) {
  return (
    <span
      className="amount"
      title={value != null ? `${exact(value)} ${unit}` : undefined}
    >
      {number(value, digits)}
      {value != null && unit && <span className="unit"> {unit}</span>}
    </span>
  );
}
export function Notice({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warning" | "error";
}) {
  return <div className={`notice ${tone}`}>{children}</div>;
}
export function AddressLink({ address }: { address: string }) {
  return (
    <a
      className="address"
      href={explorer(address)}
      target="_blank"
      rel="noreferrer"
    >
      {address} ↗
    </a>
  );
}
export function DataStamp() {
  const d = useData();
  return (
    <div className="data-stamp">
      <span
        className={`status-dot ${d.error ? "warn" : ""}`}
        aria-hidden="true"
      />
      {d.snapshot ? (
        <span>
          {d.error ? "Last read" : "On-chain read"} · block{" "}
          <a
            href={explorer(d.snapshot.block.toString(), "block")}
            target="_blank"
            rel="noreferrer"
          >
            {d.snapshot.block.toLocaleString("en-US")}
          </a>{" "}
          · {date(d.snapshot.timestamp)}
        </span>
      ) : (
        <span>{d.error ? "Chain data unavailable" : "Reading Sepolia…"}</span>
      )}
      <button className="text-button" onClick={d.refresh} disabled={d.loading}>
        {d.loading ? "Refreshing…" : "Refresh ↻"}
      </button>
    </div>
  );
}
export function PageHeading({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="page-heading">
      <h1>{title}</h1>
      <p>{children}</p>
    </div>
  );
}
export function EmptyWallet() {
  return (
    <p className="muted">
      Connect a wallet to read its balances and allowance. Public pool data
      stays available without connecting.
    </p>
  );
}
export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      {note && <span className="small muted">{note}</span>}
    </div>
  );
}
export function SectionLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <a className="section-link" href={`#/${to}`}>
      {children}
      <span aria-hidden="true">↗</span>
    </a>
  );
}
