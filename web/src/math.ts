import { formatUnits } from "viem";
export function number(value: bigint | undefined | null, digits = 4): string {
  if (value === undefined || value === null) return "Unavailable";
  const s = formatUnits(value, 18);
  const [whole, fraction = ""] = s.split(".");
  const f = fraction.slice(0, digits).replace(/0+$/, "");
  if (value > 0n && whole === "0" && (!f || BigInt(f) === 0n))
    return `<${digits === 0 ? "1" : "0." + "0".repeat(digits - 1) + "1"}`;
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
}
export const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
