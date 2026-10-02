import { defineConfig } from "drizzle-kit";
import { validateDatabaseUrl } from "./src/connection.js";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  ...(process.env.DATABASE_URL === undefined
    ? {}
    : {
        dbCredentials: { url: validateDatabaseUrl(process.env.DATABASE_URL) },
      }),
});
