import { address } from "@solana/kit";
import type { GetAccountInfoApi, Rpc } from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  assertOwnedEncodedAccount,
  createKathaRpcClient,
  fetchOwnedEncodedAccount,
  FINALIZED_TRANSACTION_READ_CONFIG,
  resolveKathaRpcConfig,
  selectKathaTransactionVersion,
} from "../src/client.js";

const accountAddress = address("11111111111111111111111111111111");
const programAddress = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const encodedAccount = () => ({
  exists: true,
  address: accountAddress,
  programAddress,
  data: new Uint8Array([1, 2, 3]),
  space: 3n,
  lamports: 1n,
  executable: false,
});

describe("Katha RPC clusters", () => {
  it("resolves explicit localnet and Devnet endpoints", () => {
    expect(resolveKathaRpcConfig({ cluster: "localnet" })).toEqual({
      cluster: "localnet",
      rpcUrl: "http://127.0.0.1:8899",
      rpcSubscriptionsUrl: "ws://127.0.0.1:8900",
    });
    expect(resolveKathaRpcConfig({ cluster: "devnet" })).toEqual({
      cluster: "devnet",
      rpcUrl: "https://api.devnet.solana.com",
      rpcSubscriptionsUrl: "wss://api.devnet.solana.com",
    });
  });

  it("accepts a paired local/LAN override without contacting RPC", () => {
    expect(
      resolveKathaRpcConfig({
        cluster: "localnet",
        rpcUrl: "http://192.168.1.20:8899",
        rpcSubscriptionsUrl: "ws://192.168.1.20:8900",
      }).rpcUrl,
    ).toBe("http://192.168.1.20:8899");
  });

  it.each([
    { cluster: "mainnet" },
    { cluster: "testnet" },
    { cluster: "devnet", rpcUrl: "https://rpc.example.org" },
    { cluster: "devnet", rpcSubscriptionsUrl: "wss://rpc.example.org" },
    {
      cluster: "devnet",
      rpcUrl: "http://api.devnet.solana.com",
      rpcSubscriptionsUrl: "wss://api.devnet.solana.com",
    },
    {
      cluster: "devnet",
      rpcUrl: "https://api.devnet.solana.com",
      rpcSubscriptionsUrl: "ws://api.devnet.solana.com",
    },
    {
      cluster: "devnet",
      rpcUrl: "https://api.mainnet-beta.solana.com",
      rpcSubscriptionsUrl: "wss://api.mainnet-beta.solana.com",
    },
    {
      cluster: "localnet",
      rpcUrl: "http://user:secret@127.0.0.1:8899",
      rpcSubscriptionsUrl: "ws://127.0.0.1:8900",
    },
    {
      cluster: "localnet",
      rpcUrl: " http://127.0.0.1:8899",
      rpcSubscriptionsUrl: "ws://127.0.0.1:8900",
    },
  ])("rejects unsupported or malformed cluster configuration %#", (config) => {
    expect(() => resolveKathaRpcConfig(config as never)).toThrow(TypeError);
  });

  it("builds a read-only Kit client", () => {
    const client = createKathaRpcClient({ cluster: "devnet" });
    expect(client.rpc.getAccountInfo).toBeTypeOf("function");
    expect(client.rpcSubscriptions.accountNotifications).toBeTypeOf("function");
    expect("payer" in client).toBe(false);
    expect("sendTransaction" in client).toBe(false);
  });
});

describe("transaction version handling", () => {
  it("prefers v1 on Devnet when a wallet supports it", () => {
    expect(selectKathaTransactionVersion("devnet", new Set([0, 1]))).toBe(1);
  });

  it("uses wallet-compatible v0 on Devnet and pinned localnet", () => {
    expect(selectKathaTransactionVersion("devnet", new Set([0]))).toBe(0);
    expect(selectKathaTransactionVersion("localnet", new Set([0, 1]))).toBe(0);
  });

  it("rejects unsupported wallet versions and local v1-only wallets", () => {
    expect(() =>
      selectKathaTransactionVersion("devnet", new Set(["legacy"])),
    ).toThrow();
    expect(() => selectKathaTransactionVersion("localnet", new Set([1]))).toThrow();
    expect(() =>
      selectKathaTransactionVersion("mainnet" as never, new Set([1])),
    ).toThrow();
  });

  it("opts finalized reads into the highest supported transaction version", () => {
    expect(FINALIZED_TRANSACTION_READ_CONFIG).toEqual({
      commitment: "finalized",
      maxSupportedTransactionVersion: 1,
    });
  });
});

describe("encoded account trust boundary", () => {
  it("accepts a matching owner and sufficient data", () => {
    expect(() =>
      assertOwnedEncodedAccount(encodedAccount(), accountAddress, programAddress, 3),
    ).not.toThrow();
  });

  it.each([
    { exists: false },
    { address: programAddress },
    { programAddress: accountAddress },
    { programAddress: "not-a-solana-address" },
    { data: "AQID" },
    { space: 2n },
    { lamports: -1n },
    { lamports: "1" },
    { executable: "false" },
  ])("rejects missing, forged, or malformed account data %#", (change) => {
    expect(() =>
      assertOwnedEncodedAccount(
        { ...encodedAccount(), ...change },
        accountAddress,
        programAddress,
      ),
    ).toThrow();
  });

  it("fetches finalized encoded data and checks its owner", async () => {
    let requestedCommitment: unknown;
    const rpc = {
      getAccountInfo: (_requestedAddress: unknown, config: { commitment: unknown }) => {
        requestedCommitment = config.commitment;
        return {
          send: async () => ({
            value: {
              data: ["AQID", "base64"],
              executable: false,
              lamports: 1n,
              owner: programAddress,
              space: 3n,
            },
          }),
        };
      },
    } as unknown as Rpc<GetAccountInfoApi>;

    const account = await fetchOwnedEncodedAccount(
      rpc,
      accountAddress,
      programAddress,
      3,
    );
    expect(requestedCommitment).toBe("finalized");
    expect(account.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects insufficient data and invalid minimum lengths", () => {
    expect(() =>
      assertOwnedEncodedAccount(encodedAccount(), accountAddress, programAddress, 4),
    ).toThrow();
    expect(() =>
      assertOwnedEncodedAccount(encodedAccount(), accountAddress, programAddress, -1),
    ).toThrow();
  });
});
