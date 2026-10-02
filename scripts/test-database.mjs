import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { setTimeout } from "node:timers/promises";

const container = `katha-db-test-${randomUUID()}`;
let started = false;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
function cleanup() {
  if (started) {
    docker("rm", "--force", "--volumes", container);
    started = false;
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cleanup();
    process.exit(1);
  });
}
try {
  // Own disposable container, random loopback port, no development volume or .env.
  docker(
    "run",
    "--detach",
    "--rm",
    "--pull",
    "never",
    "--name",
    container,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_USER=katha_test",
    "--env",
    "POSTGRES_PASSWORD=synthetic-test-only",
    "--env",
    "POSTGRES_DB=katha_test",
    "postgres:18.6",
  );
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker(
        "exec",
        container,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "katha_test",
        "-d",
        "katha_test",
      );
      ready = true;
      break;
    } catch {
      await setTimeout(500);
    }
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  const binding = docker("port", container, "5432/tcp");
  const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
  if (!match) throw new Error("Expected a single loopback-only test port");
  const url = `postgres://katha_test:synthetic-test-only@127.0.0.1:${match[1]}/katha_test`;
  execFileSync("pnpm", ["--filter", "@katha/db", "test:integration"], {
    stdio: "inherit",
    timeout: 120_000,
    env: { ...process.env, DATABASE_URL: url, KATHA_TEST_DATABASE_URL: url },
  });
} finally {
  cleanup();
}
