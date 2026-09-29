import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();
const port = 3001;

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.info(`Katha API listening on http://localhost:${info.port}`);
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
