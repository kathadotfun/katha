import { serve } from "@hono/node-server";
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
  const app = createApi(logger);
  const port = config.API_PORT;

  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname: config.API_HOST,
    },
    (info) => {
      logger.serverStarted(info.port);
    },
  );

  server.on("error", () => {
    logger.serverFailed();
    process.exitCode = 1;
  });

  let isShuttingDown = false;

  function shutdown(signal: NodeJS.Signals) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logger.serverStopping(signal);

    server.close((error) => {
      if (error) {
        logger.serverFailed();
        process.exitCode = 1;
      }
    });
  }

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
startApi();
