import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("rejects invalid worker arguments without exposing private environment values", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/indexer.ts", "SYNTHETIC_PRIVATE_INPUT", "1"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: "SYNTHETIC_PRIVATE_CONFIG" },
      encoding: "utf8",
      timeout: 5000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("SYNTHETIC_PRIVATE");
  expect(JSON.parse(result.stderr)).toMatchObject({ event: "activity_polling_failed" });
}, 8000);
