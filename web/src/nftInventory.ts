import { NFT_COLLECTION, NFT_BENEFICIARY } from "./candidate";

export interface Holding { id: string; uri: string; block: bigint; readAt: number; }
export async function verifyInventoryPage(inventory: unknown, block: bigint,
  ownerOf: (id: bigint) => Promise<string>, tokenURI: (id: bigint) => Promise<string>, signal: AbortSignal,
): Promise<Holding[]> {
  if (!inventory || typeof inventory !== "object" || !("items" in inventory) || !Array.isArray(inventory.items) || inventory.items.length > 100) throw new Error("Unexpected inventory response");
  const ids: string[] = [...new Set<string>(inventory.items.filter((item: any) => item?.token?.address_hash?.toLowerCase() === NFT_COLLECTION).map((item: any) => String(item.id)))];
  if (ids.some(id => !/^(0|[1-9]\d{0,77})$/.test(id) || BigInt(id) >= 2n ** 256n)) throw new Error("Invalid indexed token id");
  const owned: Holding[] = [];
  for (let i=0; i<ids.length; i+=4) {
    if (signal.aborted) throw new Error("Inventory request cancelled");
    const rows = await Promise.all(ids.slice(i,i+4).map(async id => {
      const owner = await ownerOf(BigInt(id));
      if (owner.toLowerCase() !== NFT_BENEFICIARY) return null;
      const uri = await tokenURI(BigInt(id));
      return {id,uri,block,readAt:Date.now()};
    }));
    owned.push(...rows.filter((row): row is Holding => row !== null));
  }
  if (signal.aborted) throw new Error("Inventory request cancelled");
  return owned;
}

export const inventoryIsStale = (holdings: Holding[], now: number) => holdings.some(row => now - row.readAt > 60000);
