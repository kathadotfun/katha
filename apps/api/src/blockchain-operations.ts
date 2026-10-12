import {
  canonicalDocumentBytes,
  operationIntentSchema,
  sha256Hex,
  unsignedOperationResponseSchema,
  type OperationIntent,
} from "@katha/shared";
import type { OperationPreparationStore } from "@katha/db";
import {
  OperationSimulationError,
  hasKathaTransactionConfig,
  RegistryLifecycleError,
  type OperationChain,
  type RegistryTransactionContext,
  type UnsignedRegistryTransaction,
  type RegistryAuthorityRole,
  type WalletTransactionVersion,
} from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import type { AuthorizationBoundary } from "./authorization.js";
import { DomainError } from "./errors.js";

const roles: Record<OperationIntent["kind"], RegistryAuthorityRole> = {
  REGISTER_ARTWORK: "registrationAuthority",
  VERIFY_ARTWORK: "verifierAuthority",
  RECORD_CONDITION: "verifierAuthority",
  UPDATE_CUSTODY: "custodyAuthority",
  MINT_ARTWORK: "registrationAuthority",
  REVISE_METADATA: "registrationAuthority",
};
export function createBlockchainOperations(
  store: OperationPreparationStore,
  authorization: AuthorizationBoundary,
  chain: OperationChain,
  cluster: "localnet" | "devnet",
) {
  return {
    // No generic HTTP route: feature handlers supply a validated intent and trusted builder.
    async prepare(
      bearer: string | undefined,
      input: unknown,
      versions: ReadonlySet<WalletTransactionVersion>,
      build: (
        context: RegistryTransactionContext,
        intent: OperationIntent,
      ) => Promise<UnsignedRegistryTransaction>,
    ) {
      const parsed = operationIntentSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const intent = parsed.data;
      const session = await authorization.requireRegistryAuthority(
        bearer,
        roles[intent.kind],
      );
      if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
      const expectedAccounts = [...intent.expectedAccounts].sort();
      const expectedHashes = [...intent.expectedHashes].sort();
      const semanticIntent = {
        schemaVersion: 1,
        ...intent,
        expectedAccounts,
        expectedHashes,
        cluster,
        walletId: session.walletId,
        authorityWallet: session.walletAddress,
        feePayer: session.walletAddress,
        programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
      };
      if (canonicalDocumentBytes(semanticIntent).byteLength > 65536)
        throw new DomainError("INVALID_REQUEST");
      if (!versions.has(0) && !(cluster === "devnet" && versions.has(1)))
        throw new DomainError("INVALID_REQUEST");
      let context: RegistryTransactionContext;
      try {
        context = await chain.context(session.walletAddress, versions);
      } catch {
        throw new Error("Blockchain preparation unavailable");
      }
      let prepared: UnsignedRegistryTransaction;
      try {
        prepared = await build(context, intent);
      } catch (error) {
        if (error instanceof RegistryLifecycleError || error instanceof TypeError)
          throw new DomainError("CONFLICT");
        throw error;
      }
      const message = prepared.transactionMessage;
      const instruction = message.instructions[0];
      const actualAccounts = [
        ...new Set([
          session.walletAddress,
          KATHA_REGISTRY_PROGRAM_ADDRESS,
          ...(instruction?.accounts ?? []).map((account) => account.address),
        ]),
      ].sort();
      if (
        prepared.cluster !== cluster ||
        context.cluster !== cluster ||
        message.feePayer.address !== session.walletAddress ||
        message.version !== (cluster === "devnet" && versions.has(1) ? 1 : 0) ||
        message.lifetimeConstraint.blockhash !== context.lifetime.blockhash ||
        message.lifetimeConstraint.lastValidBlockHeight !==
          context.lifetime.lastValidBlockHeight ||
        message.instructions.length !== 1 ||
        !hasKathaTransactionConfig(message) ||
        instruction?.programAddress !== KATHA_REGISTRY_PROGRAM_ADDRESS ||
        JSON.stringify(actualAccounts) !== JSON.stringify(expectedAccounts)
      )
        throw new DomainError("CONFLICT");
      // Bind account roles and exact instruction data too. Only blockhash/version transport
      // may change on retries; a changed instruction must use a new idempotency key.
      const canonicalBytes = canonicalDocumentBytes({
        ...semanticIntent,
        instruction: {
          programAddress: instruction.programAddress,
          accounts: (instruction.accounts ?? []).map(({ address, role }) => ({
            address,
            role,
          })),
          dataHex: Buffer.from(instruction.data ?? []).toString("hex"),
        },
      });
      if (canonicalBytes.byteLength > 65536) throw new DomainError("INVALID_REQUEST");
      const canonicalRequest = new TextDecoder().decode(canonicalBytes);
      const requestHash = await sha256Hex(canonicalBytes);
      let artifact: Awaited<ReturnType<OperationChain["simulate"]>>;
      try {
        artifact = await chain.simulate(prepared);
      } catch (error) {
        if (error instanceof OperationSimulationError && error.code === "REJECTED")
          throw new DomainError("CONFLICT");
        throw new Error("Blockchain preparation unavailable", { cause: error });
      }
      if (
        artifact.requiredSignerAddresses.length !== 1 ||
        artifact.requiredSignerAddresses[0] !== session.walletAddress
      )
        throw new DomainError("CONFLICT");
      // Validate the transport projection before persisting anything; no RPC logs or errors escape.
      const response = unsignedOperationResponseSchema.parse({
        operationId: "00000000-0000-4000-8000-000000000000",
        preparationId: "00000000-0000-4000-8000-000000000000",
        kathaId: intent.kathaId,
        kind: intent.kind,
        cluster,
        status: "PREPARED",
        requestHash,
        ...artifact,
        lastValidBlockHeight: artifact.lastValidBlockHeight.toString(),
      });
      const saved = await store.save(
        {
          artworkId: intent.artworkId,
          walletId: session.walletId,
          cluster: cluster === "localnet" ? "LOCALNET" : "DEVNET",
          kind: intent.kind,
          idempotencyKey: intent.idempotencyKey,
          requestHash,
          programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
          expectedAccounts,
          expectedHashes,
        },
        session.walletAddress,
        intent.kathaId,
        {
          canonicalRequest,
          messageHash: response.messageHash,
          transactionBase64: response.transactionBase64,
          transactionVersion: response.transactionVersion,
          blockhash: response.blockhash,
          lastValidBlockHeight: BigInt(response.lastValidBlockHeight),
          simulationSlot: BigInt(response.simulation.slot),
          simulationUnits:
            response.simulation.unitsConsumed === null
              ? null
              : BigInt(response.simulation.unitsConsumed),
        },
      );
      if (saved.status !== "saved")
        throw new DomainError(saved.status === "not_found" ? "NOT_FOUND" : "CONFLICT");
      return unsignedOperationResponseSchema.parse({
        ...response,
        operationId: saved.operationId,
        preparationId: saved.preparationId,
      });
    },
  };
}
