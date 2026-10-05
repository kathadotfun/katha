import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { OperationPreparationStore } from "@katha/db";
import {
  OperationSimulationError,
  type OperationChain,
  type RegistryTransactionContext,
  type UnsignedRegistryTransaction,
} from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS as REGISTRY } from "@katha/solana/registry";
import { createBlockchainOperations } from "../src/blockchain-operations.js";
import { createAuthorization } from "../src/authorization.js";
import { DomainError } from "../src/errors.js";
import { temporaryWallet } from "./fixtures/wallet.js";

function fixture() {
  const wallet = temporaryWallet().address;
  const session = {
    walletId: randomUUID(),
    walletAddress: wallet,
    cluster: "localnet" as const,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const authorities = {
    authority: wallet,
    registrationAuthority: wallet,
    verifierAuthority: wallet,
    custodyAuthority: wallet,
  };
  const readAuthorities = vi.fn(async () => authorities);
  const authenticate = vi.fn(async (bearer: string | undefined) => {
    if (bearer !== "Bearer test") throw new DomainError("UNAUTHENTICATED");
    return session;
  });
  const authorization = createAuthorization(
    { authenticate },
    { cluster: "localnet", adminWallets: [wallet], verifierWallets: [wallet] },
    readAuthorities,
  );
  const context = vi.fn(
    async () =>
      ({
        cluster: "localnet",
        feePayerAddress: wallet,
        authorityAddress: wallet,
        supportedTransactionVersions: new Set([0]),
        lifetime: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 100n,
        },
        currentBlockHeight: 50n,
      }) as unknown as RegistryTransactionContext,
  );
  const simulate = vi.fn(async (prepared: UnsignedRegistryTransaction) => ({
    transactionBase64: "AAAA" as Awaited<
      ReturnType<OperationChain["simulate"]>
    >["transactionBase64"],
    messageHash: "b".repeat(64),
    requiredSignerAddresses: [prepared.transactionMessage.feePayer.address],
    transactionVersion: 0 as const,
    feePayer: prepared.transactionMessage.feePayer.address,
    ...prepared.transactionMessage.lifetimeConstraint,
    simulation: { slot: "10", unitsConsumed: "20" },
  }));
  const chain: OperationChain = { context, simulate };
  const save = vi.fn<OperationPreparationStore["save"]>(async () => ({
    status: "saved" as const,
    operationId: randomUUID(),
    preparationId: randomUUID(),
  }));
  const store: OperationPreparationStore = { save };
  const input = {
    artworkId: randomUUID(),
    kathaId: "KATHA-PAUBHA-000001",
    kind: "REGISTER_ARTWORK" as const,
    idempotencyKey: "synthetic-operation",
    expectedAccounts: [REGISTRY, wallet],
    expectedHashes: ["c".repeat(64)],
    parameters: { category: "PAUBHA", creationYear: 2026 },
  };
  const build = vi.fn(
    async (
      context: RegistryTransactionContext,
    ): Promise<UnsignedRegistryTransaction> => {
      const instruction = {
        programAddress: REGISTRY,
        accounts: [{ address: context.authorityAddress, role: 3 as const }],
        data: new Uint8Array([1]),
      };
      return {
        cluster: context.cluster,
        instruction,
        requiredSignerAddresses: [context.authorityAddress],
        transactionMessage: {
          version: 0,
          feePayer: { address: context.feePayerAddress },
          lifetimeConstraint: context.lifetime,
          instructions: [instruction],
        },
      };
    },
  );
  const service = createBlockchainOperations(store, authorization, chain, "localnet");
  const prepare = (
    bearer: string | undefined = "Bearer test",
    value: unknown = input,
  ) => service.prepare(bearer, value, new Set([0]), build);
  return {
    service,
    prepare,
    input,
    build,
    save,
    simulate,
    context,
    session,
    readAuthorities,
    authorities,
  };
}
it("persists exact canonical intent and simulated wire without signing or recording a receipt", async () => {
  const f = fixture();
  const result = await f.prepare();
  expect(result.status).toBe("PREPARED");
  expect(result.lastValidBlockHeight).toBe("100");
  const [operation, wallet, kathaId, artifact] = f.save.mock.calls[0]!;
  expect(operation.requestHash).toMatch(/^[0-9a-f]{64}$/);
  expect(wallet).toBe(f.session.walletAddress);
  expect(kathaId).toBe(f.input.kathaId);
  expect(JSON.parse(artifact.canonicalRequest)).toMatchObject({
    parameters: f.input.parameters,
    authorityWallet: wallet,
    cluster: "localnet",
    schemaVersion: 1,
  });
  expect(artifact.transactionBase64).toBe(result.transactionBase64);
  expect(f.readAuthorities).toHaveBeenCalledOnce();
  expect(result).not.toHaveProperty("canonicalRequest");
});
it.each([undefined, "Bearer stranger"])(
  "rejects unauthenticated callers before builder/RPC/persistence",
  async (bearer) => {
    const f = fixture();
    await expect(
      f.service.prepare(bearer, f.input, new Set([0]), f.build),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.build).not.toHaveBeenCalled();
    expect(f.context).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  },
);
it("rechecks finalized authority for every preparation and retry", async () => {
  const f = fixture();
  await f.prepare();
  f.authorities.registrationAuthority = temporaryWallet().address;
  await expect(f.prepare()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.save).toHaveBeenCalledTimes(1);
});
it("rejects a mismatched session cluster", async () => {
  const f = fixture();
  f.session.cluster = "devnet" as never;
  await expect(f.prepare()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.build).not.toHaveBeenCalled();
});
it("rejects unknown input fields and unsupported transaction versions", async () => {
  const f = fixture();
  await expect(
    f.prepare("Bearer test", { ...f.input, signer: "secret" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    f.service.prepare("Bearer test", f.input, new Set(["legacy"]), f.build),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(f.save).not.toHaveBeenCalled();
});
it.each(["program", "feePayer", "lifetime", "accounts", "instructions"])(
  "rejects altered %s before simulation",
  async (field) => {
    const f = fixture();
    const original = f.build.getMockImplementation()!;
    f.build.mockImplementationOnce(async (context) => {
      const value = await original(context);
      if (field === "program")
        return {
          ...value,
          transactionMessage: {
            ...value.transactionMessage,
            instructions: [
              {
                ...value.instruction,
                programAddress:
                  REGISTRY === value.instruction.programAddress
                    ? value.transactionMessage.feePayer.address
                    : REGISTRY,
              },
            ],
          },
        };
      if (field === "feePayer")
        return {
          ...value,
          transactionMessage: {
            ...value.transactionMessage,
            feePayer: { address: REGISTRY },
          },
        };
      if (field === "lifetime")
        return {
          ...value,
          transactionMessage: {
            ...value.transactionMessage,
            lifetimeConstraint: { ...context.lifetime, lastValidBlockHeight: 101n },
          },
        };
      if (field === "accounts")
        return {
          ...value,
          transactionMessage: {
            ...value.transactionMessage,
            instructions: [
              {
                ...value.instruction,
                accounts: [
                  { address: context.authorityAddress, role: 3 },
                  { address: context.lifetime.blockhash as never, role: 0 },
                ],
              },
            ],
          },
        };
      if (field === "instructions")
        return {
          ...value,
          transactionMessage: {
            ...value.transactionMessage,
            instructions: [value.instruction, value.instruction],
          },
        } as unknown as UnsignedRegistryTransaction;
      return value;
    });
    await expect(f.prepare()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.simulate).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  },
);
it("rejects extra required signers", async () => {
  const f = fixture();
  f.simulate.mockImplementationOnce(async (prepared) => ({
    transactionBase64: "AAAA" as Awaited<
      ReturnType<OperationChain["simulate"]>
    >["transactionBase64"],
    messageHash: "b".repeat(64),
    requiredSignerAddresses: [prepared.transactionMessage.feePayer.address, REGISTRY],
    transactionVersion: 0,
    feePayer: prepared.transactionMessage.feePayer.address,
    ...prepared.transactionMessage.lifetimeConstraint,
    simulation: { slot: "10", unitsConsumed: "20" },
  }));
  await expect(f.prepare()).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).not.toHaveBeenCalled();
});
it.each(["REJECTED", "UNAVAILABLE"] as const)(
  "does not persist %s simulation failures",
  async (code) => {
    const f = fixture();
    f.simulate.mockRejectedValueOnce(new OperationSimulationError(code));
    await expect(f.prepare()).rejects.toMatchObject(
      code === "REJECTED"
        ? { code: "CONFLICT" }
        : { message: "Blockchain preparation unavailable" },
    );
    expect(f.save).not.toHaveBeenCalled();
  },
);
it("bounds canonical requests before RPC/build work", async () => {
  const f = fixture();
  f.input.parameters = { text: "x".repeat(65536) } as never;
  await expect(f.prepare()).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(f.context).not.toHaveBeenCalled();
});
it("ignores object key/account ordering when committing semantic intent", async () => {
  const f = fixture();
  await f.prepare();
  const first = f.save.mock.calls[0]![0].requestHash;
  f.input.parameters = { creationYear: 2026, category: "PAUBHA" };
  f.input.expectedAccounts.reverse();
  await f.prepare();
  expect(f.save.mock.calls[1]![0].requestHash).toBe(first);
});
it.each([
  ["REGISTER_ARTWORK", "registrationAuthority"],
  ["VERIFY_ARTWORK", "verifierAuthority"],
  ["RECORD_CONDITION", "verifierAuthority"],
  ["UPDATE_CUSTODY", "custodyAuthority"],
  ["MINT_ARTWORK", "registrationAuthority"],
  ["REVISE_METADATA", "registrationAuthority"],
] as const)("checks the chain role for %s", async (kind, role) => {
  const f = fixture();
  f.authorities[role] = temporaryWallet().address;
  await expect(f.prepare("Bearer test", { ...f.input, kind })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(f.build).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});
it("commits account roles and instruction data in the idempotent request hash", async () => {
  const f = fixture();
  await f.prepare();
  const previous = f.save.mock.calls[0]![0].requestHash;
  const original = f.build.getMockImplementation()!;
  f.build.mockImplementationOnce(async (context) => {
    const value = await original(context);
    return {
      ...value,
      transactionMessage: {
        ...value.transactionMessage,
        instructions: [{ ...value.instruction, data: new Uint8Array([2]) }],
      },
    };
  });
  await f.prepare();
  expect(f.save.mock.calls[1]![0].requestHash).not.toBe(previous);
});
