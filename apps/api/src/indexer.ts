import { KATHA_MARKETPLACE_PROGRAM_ADDRESS } from "@katha/solana/marketplace";
import {
  createActivityStore,
  createIndexerRecoveryStore,
  createDatabase,
  createOperationReceiptStore,
} from "@katha/db";
import { walletAddressSchema } from "@katha/shared";
import {
  createActivityReader,
  createAttemptExpiryReader,
  createHistoryReader,
  isRetryableRpcFailure,
  createRegistryCollectionReader,
  CORE_PROGRAM_ADDRESS,
} from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import { setTimeout } from "node:timers/promises";
import { readServerConfiguration, ConfigurationError } from "./config.js";
import { createLogger } from "./logger.js";
import { createExpiredAttemptResolver } from "./operation-receipts.js";
import {
  recoverActivityStream,
  reconcileCoreOwnership,
  retryRpc,
  HistoryGap,
  IndexerNetworkChanged,
} from "./activity-recovery.js";

async function run() {
  const logger = createLogger();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let connection: ReturnType<typeof createDatabase> | undefined;
  try {
    const [collectionArg, slotArg, ...flags] = process.argv.slice(2);
    const collection = walletAddressSchema.parse(collectionArg);
    if (
      flags.some(
        (flag) =>
          !["--once", "--backfill"].includes(flag) &&
          !/^--through-slot=(0|[1-9][0-9]{0,18})$/.test(flag) &&
          !/^--max-pages=[1-9][0-9]{0,3}$/.test(flag),
      ) ||
      new Set(flags).size !== flags.length ||
      !slotArg ||
      !/^(0|[1-9][0-9]{0,18})$/.test(slotArg) ||
      BigInt(slotArg) > 9223372036854775807n
    )
      throw new Error("Expected collection and start slot");
    const fromSlot = BigInt(slotArg);
    const endFlags = flags.filter((flag) => flag.startsWith("--through-slot="));
    if (
      endFlags.length > 1 ||
      (endFlags.length && (!flags.includes("--backfill") || !flags.includes("--once")))
    )
      throw new Error("Historical ranges require one-shot backfill");
    const throughSlot = endFlags.length
      ? BigInt(endFlags[0]!.split("=")[1]!)
      : undefined;
    if (
      throughSlot !== undefined &&
      (throughSlot < fromSlot || throughSlot > 9223372036854775807n)
    )
      throw new Error("Invalid backfill range");
    const pageFlags = flags.filter((flag) => flag.startsWith("--max-pages="));
    const maxPages = pageFlags.length ? Number(pageFlags[0]!.split("=")[1]) : 100;
    if (pageFlags.length > 1 || maxPages > 1000) throw new Error("Invalid page budget");
    const once = flags.includes("--once");
    const config = readServerConfiguration(process.env);
    const cluster = config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET";
    const rpcConfig = {
      cluster: config.KATHA_CLUSTER,
      ...(config.KATHA_RPC_URL === undefined ? {} : { rpcUrl: config.KATHA_RPC_URL }),
      ...(config.KATHA_RPC_SUBSCRIPTIONS_URL === undefined
        ? {}
        : { rpcSubscriptionsUrl: config.KATHA_RPC_SUBSCRIPTIONS_URL }),
    };
    const read = createActivityReader(rpcConfig);
    const history = createHistoryReader(rpcConfig);
    const readCollection = createRegistryCollectionReader(rpcConfig);
    connection = createDatabase(config.DATABASE_URL);
    const store = createActivityStore(connection.db, {
      registry: KATHA_REGISTRY_PROGRAM_ADDRESS,
      core: CORE_PROGRAM_ADDRESS,
      marketplace: KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      collection,
    });
    const recoveryStore = createIndexerRecoveryStore(connection.db, {
      registry: KATHA_REGISTRY_PROGRAM_ADDRESS,
      core: CORE_PROGRAM_ADDRESS,
      marketplace: KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      collection,
    });
    // Browsers drop signed bytes on reload; resolve their provably expired attempts here.
    const resolveExpiredAttempts = createExpiredAttemptResolver(
      createOperationReceiptStore(connection.db),
      createAttemptExpiryReader(rpcConfig),
      config.KATHA_CLUSTER,
    );
    let lastExpirySweep = 0;
    let backfill = flags.includes("--backfill");
    while (!controller.signal.aborted) {
      if (!once && Date.now() - lastExpirySweep >= 30_000) {
        lastExpirySweep = Date.now();
        try {
          await resolveExpiredAttempts();
        } catch {
          logger.activityPollingFailed();
        }
      }
      try {
        const snapshot = await retryRpc(
          () => history.snapshot(controller.signal),
          controller.signal,
        );
        if (
          !(await recoveryStore.bindNetwork(
            cluster,
            snapshot.genesisHash,
            snapshot.finalizedSlot,
          ))
        )
          throw new IndexerNetworkChanged();
        if ((await retryRpc(readCollection, controller.signal)) !== collection)
          throw new Error("Unexpected Registry collection");
        // Mint bindings must be acknowledged before processing the Core stream.
        for (const programAddress of [
          KATHA_REGISTRY_PROGRAM_ADDRESS,
          CORE_PROGRAM_ADDRESS,
          KATHA_MARKETPLACE_PROGRAM_ADDRESS,
        ]) {
          await recoverActivityStream({
            read,
            history,
            recoveryStore,
            snapshot,
            backfill,
            maxPages,
            ...(throughSlot === undefined ? {} : { throughSlot }),
            store,
            stream: { cluster, programAddress, fromSlot },
            collection,
            signal: controller.signal,
          });
        }
        if (throughSlot === undefined) {
          const result = await reconcileCoreOwnership({
            history,
            recoveryStore,
            stream: { cluster, programAddress: CORE_PROGRAM_ADDRESS, fromSlot },
            collection,
            snapshot,
            signal: controller.signal,
          });
          if (once && result.mismatches) throw new HistoryGap("OWNER_MISMATCH");
        }
        backfill = false;
        if (once) break;
      } catch (error) {
        if (
          controller.signal.aborted ||
          once ||
          error instanceof IndexerNetworkChanged ||
          (!(error instanceof HistoryGap) && !isRetryableRpcFailure(error))
        )
          throw error;
        logger.activityPollingFailed();
      }
      await setTimeout(5000, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      if (error instanceof ConfigurationError)
        logger.configurationInvalid(error.fields);
      else logger.activityPollingFailed();
      process.exitCode = 1;
    }
  } finally {
    await connection?.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
await run();
