import { createActivityReader, CORE_PROGRAM_ADDRESS } from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import { readServerConfiguration, ConfigurationError } from "./config.js";
import { createLogger } from "./logger.js";
import { pollActivityPages } from "./activity-poller.js";

async function inspect() {
  const logger = createLogger();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (process.argv.length !== 2) throw new Error("Unsupported inspection arguments");
    const config = readServerConfiguration(process.env);
    const read = createActivityReader({
      cluster: config.KATHA_CLUSTER,
      ...(config.KATHA_RPC_URL === undefined ? {} : { rpcUrl: config.KATHA_RPC_URL }),
      ...(config.KATHA_RPC_SUBSCRIPTIONS_URL === undefined
        ? {}
        : { rpcSubscriptionsUrl: config.KATHA_RPC_SUBSCRIPTIONS_URL }),
    });
    // Preview only: no database connection, persistent cursor or raw payload output.
    await pollActivityPages(
      read,
      [KATHA_REGISTRY_PROGRAM_ADDRESS, CORE_PROGRAM_ADDRESS].map((programAddress) => ({
        programAddress,
      })),
      async (page) => {
        logger.activityPageObserved({
          cluster: page.cluster,
          transactions: page.transactions.length,
          activities: page.transactions.reduce(
            (count, tx) => count + tx.activities.length,
            0,
          ),
        });
      },
      controller.signal,
    );
  } catch (error) {
    if (!controller.signal.aborted) {
      if (error instanceof ConfigurationError)
        logger.configurationInvalid(error.fields);
      else logger.activityPollingFailed();
      process.exitCode = 1;
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
await inspect();
