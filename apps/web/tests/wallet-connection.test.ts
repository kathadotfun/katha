import assert from "node:assert/strict";
import { test } from "node:test";
import { address, getAddressEncoder } from "@solana/kit";
import { walletSignInMessage } from "@katha/shared";
import type { WalletNamespace, WalletState } from "@solana/kit-plugin-wallet";
import {
  createWalletBoundary,
  createBrowserWalletConnection,
} from "../lib/wallet-connection.ts";

type Account = NonNullable<WalletState["connected"]>["account"];
function fixture() {
  const first = {
    address: "11111111111111111111111111111111",
    publicKey: new Uint8Array(32),
    chains: ["solana:localnet"],
    features: ["solana:signMessage"],
  } as unknown as Account;
  const second = {
    ...first,
    address: "11111111111111111111111111111112",
    publicKey: Uint8Array.from(
      getAddressEncoder().encode(address("11111111111111111111111111111112")),
    ),
  };
  const wallet = {
    name: "Synthetic wallet",
    chains: ["solana:localnet"],
    accounts: [first, second],
    features: ["solana:signMessage"],
    version: "1.0.0",
    icon: "data:image/png;base64,",
  } as unknown as NonNullable<WalletState["connected"]>["wallet"];
  let state: WalletState = {
    status: "disconnected",
    wallets: [wallet],
    connected: null,
    reconnectingTo: null,
  };
  const listeners = new Set<() => void>();
  let reject = false;
  const signed: Uint8Array[] = [];
  const emit = (patch: Partial<WalletState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const source: Pick<
    WalletNamespace,
    | "getState"
    | "subscribe"
    | "connect"
    | "disconnect"
    | "selectAccount"
    | "signMessage"
  > = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect: async (selected) => {
      if (reject) throw new Error("PRIVATE_WALLET_ERROR");
      emit({
        status: "connected",
        connected: {
          wallet: selected,
          account: first,
          signer: null,
          supportedTransactionVersions: new Set([0]),
        },
      });
      return [first, second];
    },
    disconnect: async () => {
      emit({ status: "disconnected", connected: null });
    },
    signMessage: async (message) => {
      signed.push(Uint8Array.from(message));
      return new Uint8Array(64) as Awaited<ReturnType<WalletNamespace["signMessage"]>>;
    },
    selectAccount: (account) => {
      if (state.connected) emit({ connected: { ...state.connected, account } });
    },
  };
  const boundary = createWalletBoundary(source, "localnet");
  return {
    boundary,
    emit,
    source,
    first,
    second,
    wallet,
    listeners,
    signed,
    reject: () => {
      reject = true;
    },
  };
}
test("wallet boundary connects, selects authorized accounts and clears on disconnect", async () => {
  const f = fixture();
  const initial = f.boundary.getSnapshot();
  assert.equal(f.boundary.getSnapshot(), initial);
  await f.boundary.connect(initial.wallets[0]!.id);
  assert.equal(f.boundary.getSnapshot().connected?.address, f.first.address);
  assert.equal(f.boundary.getSnapshot().connected?.supportsV0, true);
  assert.equal(f.boundary.getSnapshot().connected?.supportsV1, false);
  f.boundary.selectAccount(f.second.address);
  assert.equal(f.boundary.getSnapshot().connected?.address, f.second.address);
  assert.throws(() => f.boundary.selectAccount("unknown"));
  await f.boundary.disconnect();
  assert.equal(f.boundary.getSnapshot().connected, null);
  f.boundary.dispose();
});
test("wallet changes/revocation clear or replace public identity and expose no signer or session", async () => {
  const f = fixture();
  await f.boundary.connect(f.boundary.getSnapshot().wallets[0]!.id);
  const connected = f.source.getState().connected!;
  f.emit({
    connected: {
      ...connected,
      account: f.second,
      supportedTransactionVersions: new Set([1]),
    },
  });
  assert.equal(f.boundary.getSnapshot().connected?.address, f.second.address);
  assert.equal(f.boundary.getSnapshot().connected?.supportsV1, true);
  assert.ok(!JSON.stringify(f.boundary.getSnapshot()).includes("signer"));
  assert.ok(!JSON.stringify(f.boundary.getSnapshot()).includes("token"));
  f.emit({ status: "disconnected", connected: null, wallets: [] });
  assert.equal(f.boundary.getSnapshot().connected, null);
  assert.equal(f.boundary.getSnapshot().wallets.length, 0);
  f.boundary.dispose();
});
test("wrong networks, invalid addresses and mismatched public keys fail closed", async () => {
  const f = fixture();
  f.emit({ wallets: [{ ...f.wallet, chains: ["solana:mainnet"] as const }] });
  assert.equal(f.boundary.getSnapshot().wallets.length, 0);
  await assert.rejects(f.boundary.connect("unknown"));
  for (const account of [
    { ...f.first, address: "unsafe" },
    { ...f.first, chains: ["solana:mainnet"] as const },
    { ...f.first, publicKey: new Uint8Array(31) },
    { ...f.second, publicKey: f.first.publicKey },
  ]) {
    f.emit({
      status: "connected",
      connected: {
        wallet: f.wallet,
        account,
        signer: null,
        supportedTransactionVersions: new Set(),
      },
    });
    assert.equal(f.boundary.getSnapshot().connected, null);
  }
  f.boundary.dispose();
});
test("rejected connections do not leak wallet errors; pending actions and disposed clients are unavailable", async () => {
  const f = fixture();
  const id = f.boundary.getSnapshot().wallets[0]!.id;
  f.reject();
  await assert.rejects(
    f.boundary.connect(id),
    (error) => error instanceof Error && !error.message.includes("PRIVATE"),
  );
  f.emit({ status: "connecting" });
  await assert.rejects(f.boundary.connect(id));
  await assert.rejects(f.boundary.disconnect());
  f.boundary.dispose();
  assert.equal(f.listeners.size, 0);
  await assert.rejects(f.boundary.connect(id));
});
test("real plugin is inert on the server and connection is not a wallet session", () => {
  const current = createBrowserWalletConnection("devnet");
  assert.equal(current.boundary.getSnapshot().status, "pending");
  assert.equal(current.boundary.getSnapshot().connected, null);
  assert.deepEqual(current.boundary.getSnapshot().wallets, []);
  current.dispose();
});

test("sign-in boundary signs only matching canonical bytes and rejects wrong context before prompting", async () => {
  const f = fixture();
  await f.boundary.connect(f.boundary.getSnapshot().wallets[0]!.id);
  const origin = "http://localhost:3000";
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const challengeId = "aaaaaaaa-1111-4111-8111-111111111111";
  const challenge = {
    expiresAt,
    challengeId,
    message: walletSignInMessage({
      origin,
      walletAddress: f.first.address,
      cluster: "localnet",
      nonce: "a".repeat(64),
      issuedAt: new Date().toISOString(),
      expiresAt,
      challengeId,
    }),
  };
  const signature = await f.boundary.signLoginChallenge(
    challenge,
    origin,
    new AbortController().signal,
  );
  assert.equal(signature.length, 88);
  assert.deepEqual(f.signed[0], new TextEncoder().encode(challenge.message));
  await assert.rejects(
    f.boundary.signLoginChallenge(
      { ...challenge, message: challenge.message + "\n" },
      origin,
      new AbortController().signal,
    ),
  );
  await assert.rejects(
    f.boundary.signLoginChallenge(
      challenge,
      "http://attacker.test",
      new AbortController().signal,
    ),
  );
  assert.equal(f.signed.length, 1);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(f.boundary.signLoginChallenge(challenge, origin, abort.signal));
  let finish!: (value: Awaited<ReturnType<WalletNamespace["signMessage"]>>) => void;
  f.source.signMessage = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = f.boundary.signLoginChallenge(
    challenge,
    origin,
    new AbortController().signal,
  );
  f.boundary.selectAccount(f.second.address);
  finish(new Uint8Array(64) as Awaited<ReturnType<WalletNamespace["signMessage"]>>);
  await assert.rejects(pending);
  f.boundary.dispose();
});
