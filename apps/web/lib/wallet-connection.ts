import type { WalletOperation } from "./wallet-operation.ts";
import {
  address,
  createClient,
  getAddressEncoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  isTransactionModifyingSigner,
} from "@solana/kit";
import { walletSigner, type WalletNamespace } from "@solana/kit-plugin-wallet";
import {
  walletClusterSchema,
  validateWalletSignInChallenge,
  type WalletChallengeResponse,
  type WalletSession,
} from "@katha/shared";

import {
  inspectPreparedTransaction,
  validateSignedTransaction,
} from "./prepared-transaction.ts";

type Cluster = WalletSession["cluster"];
export type WalletConnectionSnapshot = Readonly<{
  status: ReturnType<WalletNamespace["getState"]>["status"];
  wallets: readonly { id: string; name: string }[];
  connected: null | {
    walletId: string;
    supportsMessageSigning: boolean;
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

// Distinguishes a declined prompt from a wallet that returned different bytes;
// neither case ever submits, but each needs a different next step from the operator.
export class WalletSigningError extends Error {
  readonly reason: "NOT_SIGNED" | "WALLET_CHANGED" | "MODIFIED";
  constructor(reason: WalletSigningError["reason"]) {
    super("Transaction signature was not completed or did not match the preparation.");
    this.name = "WalletSigningError";
    this.reason = reason;
  }
}

// Wallet Standard handles stay inside this adapter; application views receive
// public connection data, never signer methods, session tokens or wallet icons.
export function createWalletBoundary(
  source: Pick<
    WalletNamespace,
    "getState" | "subscribe" | "connect" | "disconnect" | "selectAccount"
  > &
    Partial<Pick<WalletNamespace, "signMessage">>,
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
              walletId: id(connected.wallet),
              supportsMessageSigning:
                connected.account.features.includes("solana:signMessage") &&
                connected.wallet.features.includes("solana:signMessage"),
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
    cluster,
    async signPreparedTransaction(
      operation: WalletOperation,
      signal: AbortSignal,
      review: Omit<
        Parameters<typeof inspectPreparedTransaction>[1],
        "wallet" | "cluster" | "kind" | "kathaId"
      > = {},
    ) {
      available();
      signal.throwIfAborted();
      const before = read().connected;
      const signer = source.getState().connected?.signer;
      if (
        !before ||
        !signer ||
        !isTransactionModifyingSigner(signer) ||
        !(operation.transactionVersion === 0 ? before.supportsV0 : before.supportsV1)
      )
        throw new Error("Wallet cannot sign this transaction version separately.");
      const prepared = await inspectPreparedTransaction(operation, {
        ...review,
        wallet: before.address,
        cluster,
        kind: operation.kind,
        kathaId: operation.kathaId,
      });
      signal.throwIfAborted();
      let signed;
      try {
        [signed] = await signer.modifyAndSignTransactions([prepared.transaction], {
          abortSignal: signal,
        });
        signal.throwIfAborted();
      } catch {
        throw new WalletSigningError("NOT_SIGNED");
      }
      const after = read().connected;
      if (
        disposed ||
        after?.walletId !== before.walletId ||
        after.address !== before.address ||
        !signed
      )
        throw new WalletSigningError("WALLET_CHANGED");
      try {
        const wire = String(getBase64EncodedWireTransaction(signed));
        await validateSignedTransaction(wire, operation);
        return wire;
      } catch {
        throw new WalletSigningError("MODIFIED");
      }
    },
    async signLoginChallenge(
      challenge: WalletChallengeResponse,
      origin: string,
      signal: AbortSignal,
    ) {
      available();
      signal.throwIfAborted();
      const before = read().connected;
      if (!before?.supportsMessageSigning || !source.signMessage)
        throw new Error("Wallet message signing unavailable.");
      const parsed = validateWalletSignInChallenge(challenge, {
        origin,
        cluster,
        walletAddress: before.address,
      });
      try {
        const signature = await source.signMessage(
          new TextEncoder().encode(parsed.message),
          { abortSignal: signal },
        );
        signal.throwIfAborted();
        const after = read().connected;
        if (
          disposed ||
          after?.walletId !== before.walletId ||
          after.address !== before.address ||
          signature.length !== 64
        )
          throw new Error("Wallet changed.");
        return getBase64Decoder().decode(signature);
      } catch {
        throw new Error("Wallet sign-in signature was not completed.");
      }
    },
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
