import { describe, expect, it } from "vitest";
import { readServerConfiguration, toPublicConfiguration } from "../src/config.js";

const databaseUrl = "postgres://synthetic:fixture-password@127.0.0.1:5432/katha_test";
const environment = { DATABASE_URL: databaseUrl };

describe("server configuration", () => {
  it("defaults the local listener and cluster while requiring the database URL", () => {
    expect(readServerConfiguration(environment)).toMatchObject({
      API_HOST: "127.0.0.1",
      API_PORT: 3001,
      KATHA_CLUSTER: "localnet",
    });
    expect(() => readServerConfiguration({})).toThrow("DATABASE_URL");
  });
  it("accepts explicit Devnet and LAN origins without equating runtime production with mainnet", () => {
    const config = readServerConfiguration({
      ...environment,
      NODE_ENV: "production",
      API_HOST: "0.0.0.0",
      API_PORT: "4001",
      KATHA_CLUSTER: "devnet",
      KATHA_PUBLIC_APP_ORIGIN: "http://192.168.1.20:3000/",
      KATHA_PUBLIC_API_ORIGIN: "http://192.168.1.20:4001",
    });
    expect(config.API_PORT).toBe(4001);
    expect(toPublicConfiguration(config)).toEqual({
      cluster: "devnet",
      appOrigin: "http://192.168.1.20:3000",
      apiOrigin: "http://192.168.1.20:4001",
    });
  });
  it.each(["mainnet", "mainnet-beta", "testnet", "", "DEVNET"])(
    "rejects unsupported cluster %s",
    (KATHA_CLUSTER) => {
      expect(() => readServerConfiguration({ ...environment, KATHA_CLUSTER })).toThrow(
        "KATHA_CLUSTER",
      );
    },
  );
  it.each(["0", "65536", "3001.5", "1e3", " 3001", "03001", "", "-1"])(
    "rejects invalid port %s",
    (API_PORT) => {
      expect(() => readServerConfiguration({ ...environment, API_PORT })).toThrow(
        "API_PORT",
      );
    },
  );
  it.each([
    "https://localhost/db",
    "postgres://localhost",
    "postgres://localhost/db#secret",
    " postgres://localhost/db",
    "",
  ])("rejects malformed database URL without values %s", (DATABASE_URL) => {
    expect(() => readServerConfiguration({ DATABASE_URL })).toThrow("DATABASE_URL");
  });
  it.each([
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com?token=secret",
    "https://example.com#secret",
    "file:///tmp",
    " https://example.com",
  ])("rejects non-origin public URLs %s", (KATHA_PUBLIC_APP_ORIGIN) => {
    expect(() =>
      readServerConfiguration({ ...environment, KATHA_PUBLIC_APP_ORIGIN }),
    ).toThrow("KATHA_PUBLIC_APP_ORIGIN");
  });
  it("reports only failed setting names, omitting all synthetic secret values and validation causes", () => {
    try {
      readServerConfiguration({
        DATABASE_URL: "SYNTHETIC_SECRET_VALUE",
        API_PORT: "ANOTHER_SECRET",
      });
      throw new Error("Expected invalid configuration");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain("DATABASE_URL");
      expect(error.message).toContain("API_PORT");
      expect(JSON.stringify(error)).not.toContain("SYNTHETIC_SECRET_VALUE");
      expect(error.message).not.toContain("SECRET");
      expect(error.cause).toBeUndefined();
    }
  });
  it("exposes only the public allowlist, ignoring arbitrary environment secrets", () => {
    const config = readServerConfiguration({
      ...environment,
      SOME_PROVIDER_TOKEN: "SYNTHETIC_SECRET",
    });
    const publicConfig = toPublicConfiguration(config);
    expect(Object.keys(publicConfig).sort()).toEqual([
      "apiOrigin",
      "appOrigin",
      "cluster",
    ]);
    expect(JSON.stringify(publicConfig)).not.toContain(databaseUrl);
    expect(JSON.stringify(publicConfig)).not.toContain("SYNTHETIC_SECRET");
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(publicConfig)).toBe(true);
  });
  it.each([
    "NEXT_PUBLIC_DATABASE_URL",
    "NEXT_PUBLIC_KATHA_DB_PASSWORD",
    "NEXT_PUBLIC_PROVIDER_TOKEN",
    "NEXT_PUBLIC_PRIVATE_KEY",
  ])("rejects public aliases for server-only settings %s", (key) => {
    expect(() =>
      readServerConfiguration({ ...environment, [key]: "SYNTHETIC_SECRET" }),
    ).toThrow("Server-only settings");
  });
});

it("rejects app authorities unsupported by challenge persistence before listening", () => {
  expect(() =>
    readServerConfiguration({
      DATABASE_URL: "postgres://localhost/katha_test",
      KATHA_PUBLIC_APP_ORIGIN: "http://[::1]:3000",
    }),
  ).toThrow("KATHA_PUBLIC_APP_ORIGIN");
});

it("defaults to empty frozen role allowlists and keeps them out of public settings", () => {
  const config = readServerConfiguration(environment);
  expect(config.KATHA_ADMIN_WALLETS).toEqual([]);
  expect(config.KATHA_VERIFIER_WALLETS).toEqual([]);
  expect(Object.isFrozen(config.KATHA_ADMIN_WALLETS)).toBe(true);
  expect(Object.keys(toPublicConfiguration(config))).toEqual([
    "cluster",
    "appOrigin",
    "apiOrigin",
  ]);
});
it("accepts separate server-configured role wallets and paired cluster endpoints", () => {
  const config = readServerConfiguration({
    ...environment,
    KATHA_ADMIN_WALLETS: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    KATHA_VERIFIER_WALLETS: "Vote111111111111111111111111111111111111111",
    KATHA_RPC_URL: "http://127.0.0.1:8899",
    KATHA_RPC_SUBSCRIPTIONS_URL: "ws://127.0.0.1:8900",
  });
  expect(config.KATHA_ADMIN_WALLETS).toHaveLength(1);
  expect(config.KATHA_VERIFIER_WALLETS).toHaveLength(1);
  expect(JSON.stringify(toPublicConfiguration(config))).not.toContain("Tokenkeg");
  expect(JSON.stringify(toPublicConfiguration(config))).not.toContain("8899");
});
it.each([
  "private key",
  "z".repeat(44),
  "11111111111111111111111111111111",
  " TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA,",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA,TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
])("rejects malformed or duplicated role wallets %s", (value) => {
  for (const field of ["KATHA_ADMIN_WALLETS", "KATHA_VERIFIER_WALLETS"])
    expect(() => readServerConfiguration({ ...environment, [field]: value })).toThrow(
      field,
    );
});
it.each([
  { KATHA_RPC_URL: "http://127.0.0.1:8899" },
  {
    KATHA_CLUSTER: "devnet",
    KATHA_RPC_URL: "http://rpc.example",
    KATHA_RPC_SUBSCRIPTIONS_URL: "ws://rpc.example",
  },
  {
    KATHA_RPC_URL: "https://user:secret@rpc.example",
    KATHA_RPC_SUBSCRIPTIONS_URL: "wss://rpc.example",
  },
  {
    KATHA_RPC_URL: "https://api.mainnet-beta.solana.com",
    KATHA_RPC_SUBSCRIPTIONS_URL: "wss://api.mainnet-beta.solana.com",
  },
])("rejects unsafe or incomplete RPC pairs", (settings) => {
  expect(() => readServerConfiguration({ ...environment, ...settings })).toThrow(
    "KATHA_RPC_URL",
  );
});
it.each([
  "NEXT_PUBLIC_KATHA_ADMIN_WALLETS",
  "NEXT_PUBLIC_KATHA_VERIFIER_WALLETS",
  "NEXT_PUBLIC_KATHA_RPC_URL",
])("rejects public authority/provider aliases %s", (key) => {
  expect(() => readServerConfiguration({ ...environment, [key]: "synthetic" })).toThrow(
    "Server-only",
  );
});
