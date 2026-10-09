import { createServer } from "node:http";

export type LocalRpcFault =
  | { kind: "UNAVAILABLE" }
  | { kind: "ACCOUNT_OWNER"; address: string }
  | { kind: "ACCOUNT_DATA"; address: string; data: string };

/** Surfpool 1.6 reports discovery entries as confirmed even below its finalized slot. */
export async function surfpoolIndexerRpc(upstream: string) {
  if (new URL(upstream).hostname !== "127.0.0.1")
    throw new Error("Local test RPC only");
  let fault: LocalRpcFault | null = null;
  async function forward(body: string): Promise<Record<string, unknown>> {
    const response = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const value: unknown = await response.json();
    if (
      !response.ok ||
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      throw new Error("Invalid local RPC response");
    return value as Record<string, unknown>;
  }
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString("utf8");
      const input: Record<string, unknown> = JSON.parse(body);
      if (fault?.kind === "UNAVAILABLE") throw new Error("Synthetic RPC outage");
      const result = await forward(body);
      if (fault && !result.error) {
        const params = input.params as unknown[];
        const payload = result.result as { value?: unknown };
        const keys =
          input.method === "getMultipleAccounts"
            ? (params[0] as string[])
            : input.method === "getAccountInfo"
              ? [String(params[0])]
              : [];
        const rows = Array.isArray(payload?.value) ? payload.value : [payload?.value];
        const position = keys.indexOf(fault.address);
        const row = rows[position] as Record<string, unknown> | undefined;
        if (row && typeof row === "object") {
          if (fault.kind === "ACCOUNT_OWNER")
            row.owner = "11111111111111111111111111111111";
          else row.data = [fault.data, "base64"];
        }
      }
      if (input.method === "getSignaturesForAddress" && !result.error) {
        const snapshot = await forward(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getSlot",
            params: [{ commitment: "finalized" }],
          }),
        );
        if (!Number.isSafeInteger(snapshot.result) || !Array.isArray(result.result))
          throw new Error("Invalid finality evidence");
        const finalized = BigInt(String(snapshot.result));
        result.result = result.result.flatMap((entry: unknown) => {
          if (entry === null || typeof entry !== "object" || Array.isArray(entry))
            throw new Error("Invalid discovery entry");
          const row = entry as Record<string, unknown>;
          if (
            !Number.isSafeInteger(row.slot) ||
            typeof row.signature !== "string" ||
            row.err === undefined
          )
            throw new Error("Invalid discovery evidence");
          // Preserve signature, slot, error and timestamp; never manufacture an event.
          return BigInt(String(row.slot)) <= finalized
            ? [{ ...row, confirmationStatus: "finalized" }]
            : [];
        });
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    } catch {
      response.writeHead(502);
      response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const binding = server.address();
  if (!binding || typeof binding === "string") throw new Error("Missing test RPC port");
  return {
    url: `http://127.0.0.1:${binding.port}`,
    // Test-only faults are reversible and never alter the upstream ledger.
    setFault: (value: LocalRpcFault | null) => {
      fault = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
