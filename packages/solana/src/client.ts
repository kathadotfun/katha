import {
  address,
  createClient,
  fetchEncodedAccount,
  MAX_SUPPORTED_TRANSACTION_VERSION,
} from "@solana/kit";
import type { Address, EncodedAccount, GetAccountInfoApi, Rpc } from "@solana/kit";
import { solanaRpcConnection } from "@solana/kit-plugin-rpc";

export type KathaCluster = "localnet" | "devnet";
export type KathaTransactionVersion = 0 | 1;
export type WalletTransactionVersion = "legacy" | KathaTransactionVersion;

export interface KathaRpcConfig {
  cluster: KathaCluster;
  rpcUrl?: string;
  rpcSubscriptionsUrl?: string;
}

const DEFAULT_ENDPOINTS = {
  localnet: {
    rpcUrl: "http://127.0.0.1:8899",
    rpcSubscriptionsUrl: "ws://127.0.0.1:8900",
  },
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    rpcSubscriptionsUrl: "wss://api.devnet.solana.com",
  },
} as const;

function validateEndpoint(
  value: string,
  cluster: KathaCluster,
  subscription: boolean,
): void {
  if (value !== value.trim()) {
    throw new TypeError("RPC endpoint has surrounding whitespace");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("RPC endpoint must be an absolute URL");
  }
  const protocols =
    cluster === "devnet"
      ? subscription
        ? ["wss:"]
        : ["https:"]
      : subscription
        ? ["ws:", "wss:"]
        : ["http:", "https:"];
  if (
    !protocols.includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    ["api.mainnet-beta.solana.com", "api.testnet.solana.com"].includes(url.hostname)
  ) {
    throw new TypeError("RPC endpoint is not permitted for this cluster");
  }
}

export function resolveKathaRpcConfig(
  config: KathaRpcConfig,
): Required<KathaRpcConfig> {
  if (config.cluster !== "localnet" && config.cluster !== "devnet") {
    throw new TypeError("Katha supports localnet and devnet only");
  }
  if ((config.rpcUrl === undefined) !== (config.rpcSubscriptionsUrl === undefined)) {
    throw new TypeError(
      "Custom RPC and subscription endpoints must be supplied together",
    );
  }
  const defaults = DEFAULT_ENDPOINTS[config.cluster];
  const rpcUrl = config.rpcUrl ?? defaults.rpcUrl;
  const rpcSubscriptionsUrl =
    config.rpcSubscriptionsUrl ?? defaults.rpcSubscriptionsUrl;
  validateEndpoint(rpcUrl, config.cluster, false);
  validateEndpoint(rpcSubscriptionsUrl, config.cluster, true);
  return { cluster: config.cluster, rpcUrl, rpcSubscriptionsUrl };
}

// The client has RPC access but no payer, signer, or transaction submission helper.
export function createKathaRpcClient(config: KathaRpcConfig) {
  const { rpcUrl, rpcSubscriptionsUrl } = resolveKathaRpcConfig(config);
  return createClient().use(solanaRpcConnection({ rpcUrl, rpcSubscriptionsUrl }));
}

// The pinned Solana 4.1.2 local validator cannot execute v1 transactions.
export function selectKathaTransactionVersion(
  cluster: KathaCluster,
  supportedVersions: ReadonlySet<WalletTransactionVersion>,
): KathaTransactionVersion {
  if (cluster !== "localnet" && cluster !== "devnet") {
    throw new TypeError("Katha supports localnet and devnet only");
  }
  if (cluster === "devnet" && supportedVersions.has(1)) {
    return 1;
  }
  if (supportedVersions.has(0)) {
    return 0;
  }
  throw new TypeError("Wallet has no transaction version supported by this cluster");
}

// Reads must accept v1 even when outgoing transactions use v0.
export const FINALIZED_TRANSACTION_READ_CONFIG = Object.freeze({
  commitment: "finalized" as const,
  maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function assertOwnedEncodedAccount(
  account: unknown,
  expectedAddress: Address,
  expectedProgram: Address,
  minimumDataLength = 0,
): asserts account is EncodedAccount {
  if (!Number.isSafeInteger(minimumDataLength) || minimumDataLength < 0) {
    throw new TypeError("Minimum account data length must be a nonnegative integer");
  }
  if (!isRecord(account) || account.exists !== true) {
    throw new TypeError("Solana account does not exist");
  }
  if (account.address !== expectedAddress) {
    throw new TypeError("Solana account address mismatch");
  }
  if (typeof account.programAddress !== "string") {
    throw new TypeError("Solana account owner is missing");
  }
  address(account.programAddress);
  if (account.programAddress !== expectedProgram) {
    throw new TypeError("Solana account owner mismatch");
  }
  if (
    !(account.data instanceof Uint8Array) ||
    account.data.length < minimumDataLength ||
    typeof account.space !== "bigint" ||
    account.space !== BigInt(account.data.length) ||
    typeof account.lamports !== "bigint" ||
    account.lamports < 0n ||
    typeof account.executable !== "boolean"
  ) {
    throw new TypeError("Solana account response is malformed");
  }
}

export async function fetchOwnedEncodedAccount(
  rpc: Rpc<GetAccountInfoApi>,
  accountAddress: Address,
  expectedProgram: Address,
  minimumDataLength = 0,
): Promise<EncodedAccount> {
  const account = await fetchEncodedAccount(rpc, accountAddress, {
    commitment: "finalized",
  });
  assertOwnedEncodedAccount(
    account,
    accountAddress,
    expectedProgram,
    minimumDataLength,
  );
  return account;
}
