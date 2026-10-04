import { createWalletSessions } from "./wallet-session.js";
import { createPublicArtists } from "./public-artists.js";
import { createPublicArtistStore } from "@katha/db";
import { createArtists } from "./artists.js";
import { createAuthorization } from "./authorization.js";
import { createRegistryAuthorityReader } from "@katha/solana";
import { createDatabase, createWalletSessionStore, createArtistStore } from "@katha/db";
import { createReadiness } from "./readiness.js";
import { createShutdown } from "./shutdown.js";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createApi } from "./app.js";
import { createLogger } from "./logger.js";
import { ConfigurationError, readServerConfiguration } from "./config.js";

function startApi() {
  const logger = createLogger();
  let config;
  try {
    config = readServerConfiguration(process.env);
  } catch (error) {
    logger.configurationInvalid(
      error instanceof ConfigurationError ? error.fields : [],
    );
    process.exitCode = 1;
    return;
  }
  const database = createDatabase(config.DATABASE_URL);
  const readiness = createReadiness(database.check);
  const sessions = createWalletSessions(createWalletSessionStore(database.db), {
    origin: config.KATHA_PUBLIC_APP_ORIGIN,
    cluster: config.KATHA_CLUSTER,
  });
  const app = createApi(
    logger,
    readiness,
    [config.KATHA_PUBLIC_APP_ORIGIN, config.KATHA_PUBLIC_API_ORIGIN],
    sessions,
    createAuthorization(
      sessions,
      {
        cluster: config.KATHA_CLUSTER,
        adminWallets: config.KATHA_ADMIN_WALLETS,
        verifierWallets: config.KATHA_VERIFIER_WALLETS,
      },
      createRegistryAuthorityReader({
        cluster: config.KATHA_CLUSTER,
        ...(config.KATHA_RPC_URL === undefined ? {} : { rpcUrl: config.KATHA_RPC_URL }),
        ...(config.KATHA_RPC_SUBSCRIPTIONS_URL === undefined
          ? {}
          : { rpcSubscriptionsUrl: config.KATHA_RPC_SUBSCRIPTIONS_URL }),
      }),
    ),
    createArtists(createArtistStore(database.db)),
    createPublicArtists(createPublicArtistStore(database.db)),
  );
  const port = config.API_PORT;

  const server = createServer(
    getRequestListener(app.fetch, {
      errorHandler: () => {
        logger.serverFailed();
        return new Response("An unexpected error occurred.", { status: 500 });
      },
    }),
  );
  const close = createShutdown(server, readiness, database.close);
  let isShuttingDown = false;
  function shutdown(signal?: NodeJS.Signals) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (signal) logger.serverStopping(signal);
    void close()
      .then((clean) => {
        if (!clean) {
          logger.serverFailed();
          // Release lingering sockets after bounded drain/close failure.
          process.exit(1);
        }
      })
      .catch(() => {
        logger.serverFailed();
        process.exit(1);
      });
  }
  server.on("error", () => {
    logger.serverFailed();
    process.exitCode = 1;
    shutdown();
  });
  server.listen(port, config.API_HOST, () => logger.serverStarted(port));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
startApi();
