import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readServerConfiguration } from "./config.js";

function startApi() {
  let config;
  try {
    config = readServerConfiguration(process.env);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Invalid API configuration.",
    );
    process.exitCode = 1;
    return;
  }
  const app = new Hono();
  const port = config.API_PORT;

  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname: config.API_HOST,
    },
    (info) => {
      console.info(`Katha API listening on port ${info.port}`);
    },
  );

  let isShuttingDown = false;

  function shutdown(signal: NodeJS.Signals) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.info(`Received ${signal}; closing the Katha API server.`);

    server.close((error) => {
      if (error) {
        console.error("The Katha API server did not close cleanly.", error);
        process.exitCode = 1;
      }
    });
  }

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
startApi();
