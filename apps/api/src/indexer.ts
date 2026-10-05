import { createActivityStore, createDatabase } from "@katha/db";
import { walletAddressSchema } from "@katha/shared";
import {
  createActivityReader,
  createRegistryCollectionReader,
  CORE_PROGRAM_ADDRESS,
} from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import { setTimeout } from "node:timers/promises";
import { readServerConfiguration, ConfigurationError } from "./config.js";
import { createLogger } from "./logger.js";
import { ingestActivityStream } from "./activity-ingestion.js";

async function run() {
  const logger = createLogger();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let connection: ReturnType<typeof createDatabase> | undefined;
  try {
    const [collectionArg, slotArg, ...extra] = process.argv.slice(2);
    const collection = walletAddressSchema.parse(collectionArg);
    if (
      extra.length ||
      !slotArg ||
      !/^(0|[1-9][0-9]{0,18})$/.test(slotArg) ||
      BigInt(slotArg) > 9223372036854775807n
    )
      throw new Error("Expected collection and start slot");
    const fromSlot = BigInt(slotArg);
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
    const readCollection = createRegistryCollectionReader(rpcConfig);
    connection = createDatabase(config.DATABASE_URL);
    const store = createActivityStore(connection.db, {
      registry: KATHA_REGISTRY_PROGRAM_ADDRESS,
      core: CORE_PROGRAM_ADDRESS,
      collection,
    });
    while (!controller.signal.aborted) {
      if ((await readCollection()) !== collection)
        throw new Error("Unexpected Registry collection");
      // Mint bindings must be acknowledged before processing the Core stream.
      for (const programAddress of [
        KATHA_REGISTRY_PROGRAM_ADDRESS,
        CORE_PROGRAM_ADDRESS,
      ]) {
        await ingestActivityStream({
          read,
          store,
          stream: { cluster, programAddress, fromSlot },
          collection,
          signal: controller.signal,
        });
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
