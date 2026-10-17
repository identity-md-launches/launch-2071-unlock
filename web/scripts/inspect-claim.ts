import { loadSnapshot } from "../src/live";
import { indexEvents } from "../src/indexer";
import { client } from "../src/config";
const s = await loadSnapshot();
const i = await indexEvents(s);
for (const e of i.events)
  if (e.kind === "Claimed") {
    const receipt = await client.getTransactionReceipt({ hash: e.hash });
    console.log(
      JSON.stringify(
        {
          event: e,
          receipt: {
            status: receipt.status,
            block: receipt.blockNumber,
            to: receipt.to,
          },
        },
        (_, v) => (typeof v === "bigint" ? v.toString() : v),
      ),
    );
  }
