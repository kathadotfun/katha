import { createServer } from "node:http";
import { expect, it } from "vitest";
import { createActivityReader } from "../src/activity-reader.js";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "../src/generated/registry/index.js";
import { activityFixture, SIG, SLOT, SYSTEM } from "./fixtures/activity.js";
it("decodes through actual Kit RPC transport and numeric transformations", async () => {
  const requests: { method: string; params: unknown[] }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      id: string;
      method: string;
      params: unknown[];
    };
    requests.push(body);
    let result: unknown;
    switch (body.method) {
      case "getGenesisHash":
        result = SYSTEM;
        break;
      case "getSignaturesForAddress":
        result = [
          {
            signature: SIG,
            slot: SLOT,
            confirmationStatus: "finalized",
            err: null,
            memo: null,
            blockTime: 1n,
          },
        ];
        break;
      case "getTransaction":
        result = activityFixture();
        break;
      case "getBlock":
        result = {
          signatures: [SIG],
          blockTime: 1n,
          blockHeight: 1n,
          parentSlot: 122n,
          blockhash: SYSTEM,
          previousBlockhash: SYSTEM,
        };
        break;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result }, (_, value) =>
        typeof value === "bigint" ? Number(value) : value,
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const info = server.address();
    if (!info || typeof info === "string") throw new Error("Expected test listener");
    const read = createActivityReader({
      cluster: "localnet",
      rpcUrl: `http://127.0.0.1:${info.port}`,
      rpcSubscriptionsUrl: `ws://127.0.0.1:${info.port}`,
    });
    const page = await read({ programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS });
    expect(page.transactions[0]).toMatchObject({
      slot: SLOT,
      transactionIndex: 0,
      activities: [{ kind: "REGISTRY", event: { name: "ArtworkVerified" } }],
    });
    expect(requests.map((r) => r.method)).toEqual([
      "getGenesisHash",
      "getSignaturesForAddress",
      "getTransaction",
      "getBlock",
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
