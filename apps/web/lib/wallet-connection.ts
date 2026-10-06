import { address, createClient, getAddressEncoder } from "@solana/kit";
import { walletSigner, type WalletNamespace } from "@solana/kit-plugin-wallet";
import { walletClusterSchema, type WalletSession } from "@katha/shared";

type Cluster = WalletSession["cluster"];
export type WalletConnectionSnapshot = Readonly<{
  status: ReturnType<WalletNamespace["getState"]>["status"];
  wallets: readonly { id: string; name: string }[];
  connected: null | {
    walletName: string;
    address: string;
    accounts: readonly string[];
    supportsV0: boolean;
    supportsV1: boolean;
  };
}>;
export const disconnectedWalletSnapshot: WalletConnectionSnapshot = {
  status: "pending",
  wallets: [],
  connected: null,
};

// Wallet Standard handles stay inside this adapter; application views receive
// public connection data, never signer methods, session tokens or wallet icons.
export function createWalletBoundary(
  source: Pick<
    WalletNamespace,
    "getState" | "subscribe" | "connect" | "disconnect" | "selectAccount"
  >,
  cluster: Cluster,
) {
  const chain = `solana:${walletClusterSchema.parse(cluster)}` as const;
  const ids = new WeakMap<object, string>();
  let nextId = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const name = (value: string) => value.trim().slice(0, 80) || "Solana wallet";
  function id(wallet: object) {
    let value = ids.get(wallet);
    if (!value) {
      value = `wallet-${++nextId}`;
      ids.set(wallet, value);
    }
    return value;
  }
  function validAccount(
    account: NonNullable<
      ReturnType<WalletNamespace["getState"]>["connected"]
    >["account"],
  ) {
    try {
      const bytes = getAddressEncoder().encode(address(account.address));
      return (
        account.chains.includes(chain) &&
        account.publicKey.length === 32 &&
        bytes.every((byte, index) => byte === account.publicKey[index])
      );
    } catch {
      return false;
    }
  }
  function read(): WalletConnectionSnapshot {
    const state = source.getState();
    const connected = state.connected;
    return {
      status: state.status,
      wallets: state.wallets
        .filter((wallet) => wallet.chains.includes(chain))
        .map((wallet) => ({ id: id(wallet), name: name(wallet.name) })),
      connected:
        connected &&
        connected.wallet.chains.includes(chain) &&
        connected.wallet.accounts.some(
          (account) =>
            account.address === connected.account.address && validAccount(account),
        ) &&
        validAccount(connected.account)
          ? {
              walletName: name(connected.wallet.name),
              address: connected.account.address,
              accounts: connected.wallet.accounts
                .filter(validAccount)
                .map((account) => account.address),
              supportsV0: connected.supportedTransactionVersions.has(0),
              supportsV1: connected.supportedTransactionVersions.has(1),
            }
          : null,
    };
  }
  let snapshot = read();
  const unsubscribe = source.subscribe(() => {
    if (disposed) return;
    snapshot = read();
    for (const listener of listeners) listener();
  });
  function available() {
    if (
      disposed ||
      ["pending", "connecting", "disconnecting", "reconnecting"].includes(
        source.getState().status,
      )
    )
      throw new Error("Wallet action unavailable.");
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async connect(walletId: string) {
      available();
      const wallet = source
        .getState()
        .wallets.find(
          (wallet) => id(wallet) === walletId && wallet.chains.includes(chain),
        );
      if (!wallet) throw new Error("Wallet is no longer available.");
      try {
        await source.connect(wallet);
        if (!read().connected) throw new Error("No valid wallet account.");
      } catch {
        throw new Error(
          "Wallet connection was not completed. Try again in your wallet.",
        );
      }
    },
    async disconnect() {
      available();
      try {
        await source.disconnect();
      } catch {
        throw new Error("Wallet disconnection was not completed. Try again.");
      }
    },
    selectAccount(value: string) {
      available();
      const account = source
        .getState()
        .connected?.wallet.accounts.find(
          (account) => account.address === value && validAccount(account),
        );
      if (!account) throw new Error("Wallet account is no longer available.");
      source.selectAccount(account);
    },
    dispose() {
      disposed = true;
      unsubscribe();
      listeners.clear();
      snapshot = disconnectedWalletSnapshot;
    },
  };
}
export type WalletConnection = ReturnType<typeof createWalletBoundary>;
export function createBrowserWalletConnection(cluster: Cluster) {
  const client = createClient().use(
    walletSigner({
      chain: `solana:${walletClusterSchema.parse(cluster)}`,
      storage: null,
      autoConnect: false,
    }),
  );
  const boundary = createWalletBoundary(client.wallet, cluster);
  return {
    boundary,
    dispose() {
      boundary.dispose();
      client[Symbol.dispose]();
    },
  };
}
