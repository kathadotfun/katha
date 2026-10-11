import assert from "node:assert/strict";
import { test } from "node:test";
import type { NfcTagResponse } from "@katha/shared";
import { createNfcTags, parseTagId } from "../lib/nfc-tags.ts";
import {
  WalletSessionApiError,
  createWalletSessionApi,
} from "../lib/wallet-session-api.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";

const kathaId = "KATHA-PAUBHA-000001";
const tagId = "6f1c2b3a-1111-4111-8111-111111111111";
const session = {
  walletId: "aaaaaaaa-1111-4111-8111-111111111111",
  walletAddress: "11111111111111111111111111111112",
  cluster: "localnet" as const,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
function tag(patch: Partial<NfcTagResponse> = {}): NfcTagResponse {
  return {
    tagId,
    kathaId,
    state: "ACTIVE",
    assignedAt: new Date(Date.now() - 1000).toISOString(),
    retiredAt: null,
    ...patch,
  };
}
function fixture() {
  let auth: WalletSessionSnapshot = { status: "signed-in", session, error: null };
  const listeners = new Set<() => void>();
  const calls: string[] = [];
  const methods = {
    getSnapshot: () => auth,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn) && undefined;
    },
    async assignNfcTag(id: string, value: string) {
      calls.push(`assign:${id}:${value}`);
      return tag();
    },
    async readNfcTag(value: string) {
      calls.push(`read:${value}`);
      return tag();
    },
    async retireNfcTag(value: string) {
      calls.push(`retire:${value}`);
      return tag({ state: "RETIRED", retiredAt: new Date().toISOString() });
    },
  };
  return {
    methods,
    calls,
    signOut() {
      auth = { status: "signed-out", session: null, error: null };
      for (const fn of listeners) fn();
    },
  };
}

test("tag references are canonical UUIDs and invalid input never reaches the API", async () => {
  assert.equal(parseTagId(` ${tagId.toUpperCase()} `), tagId);
  assert.equal(parseTagId("KT-NFC-04A2"), null);
  const f = fixture();
  const nfc = createNfcTags(f.methods, kathaId);
  await nfc.assign("not-a-tag");
  assert.equal(f.calls.length, 0);
  assert.match(nfc.getSnapshot().error!, /UUID/);
  nfc.dispose();
});

test("assign, look up and retire act only on this artwork's active binding", async () => {
  const f = fixture();
  const nfc = createNfcTags(f.methods, kathaId);
  await nfc.assign(tagId);
  assert.equal(nfc.getSnapshot().result, "assigned");
  await nfc.retire();
  assert.equal(nfc.getSnapshot().tag?.state, "RETIRED");
  await nfc.retire();
  assert.deepEqual(f.calls, [`assign:${kathaId}:${tagId}`, `retire:${tagId}`]);
  f.methods.readNfcTag = async () => tag({ kathaId: "KATHA-PAUBHA-000002" });
  await nfc.lookup(tagId);
  await nfc.retire();
  assert.equal(f.calls.filter((call) => call.startsWith("retire")).length, 1);
  nfc.dispose();
});

test("conflicts are explained and sign-out clears tag results", async () => {
  const f = fixture();
  f.methods.assignNfcTag = async () => {
    throw new WalletSessionApiError("CONFLICT");
  };
  const nfc = createNfcTags(f.methods, kathaId);
  await nfc.assign(tagId);
  assert.match(nfc.getSnapshot().error!, /already be bound/);
  await nfc.lookup(tagId);
  f.signOut();
  assert.equal(nfc.getSnapshot().tag, null);
  nfc.dispose();
});

test("NFC transport uses the admin endpoints and rejects mismatched bindings", async () => {
  const requests: string[] = [];
  let body: unknown = tag();
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    requests.push(`${init?.method} ${String(url)}`);
    return Response.json(body);
  });
  const signal = new AbortController().signal;
  await api.assignNfcTag(kathaId, tagId, "token", signal);
  await api.readNfcTag(tagId, "token", signal);
  body = tag({ state: "RETIRED", retiredAt: new Date().toISOString() });
  await api.retireNfcTag(tagId, "token", signal);
  assert.deepEqual(requests, [
    `POST http://localhost:3001/admin/artworks/${kathaId}/nfc-tags`,
    `GET http://localhost:3001/admin/nfc-tags/${tagId}`,
    `POST http://localhost:3001/admin/nfc-tags/${tagId}/retire`,
  ]);
  body = tag({ kathaId: "KATHA-PAUBHA-000002" });
  await assert.rejects(api.assignNfcTag(kathaId, tagId, "token", signal));
});
