import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const primaryJourney = process.argv[2] === "--primary-journey";
const adminLifecycle = primaryJourney || process.argv[2] === "--admin-lifecycle";
if (
  process.argv
    .slice(2)
    .some((arg) => !["--admin-lifecycle", "--primary-journey"].includes(arg))
)
  throw new Error("Unknown program test option");
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const coreProgram = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const registryProgram = "5829CUnLsucsi3Tj7573LYV5gNQo35ztGhdY4yhNoAkC";
const coreSha256 = "5680d2371204033f55cdcf0c08d393ed737d99cfe35d83f65befe80f7537484a";
const coreBinary = join(root, "target/test-fixtures/core-devnet.so");
const registryBinary = join(root, "target/core-cpi-test/katha_registry.so");
const marketplaceBinary = join(root, "target/marketplace-test/katha_marketplace.so");
const toolEnv = { ...process.env, NO_DNA: "1" };

function run(command, args, cwd = root, env = toolEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ?? code})`));
    });
  });
}

async function verifiedCoreBinary() {
  await mkdir(dirname(coreBinary), { recursive: true });
  let bytes;
  try {
    bytes = await readFile(coreBinary);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await run("solana", [
      "program",
      "dump",
      "--url",
      "https://api.devnet.solana.com",
      coreProgram,
      coreBinary,
    ]);
    bytes = await readFile(coreBinary);
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== coreSha256) {
    throw new Error(
      `Core Devnet binary hash changed: ${hash}; review the fixture before updating its pin`,
    );
  }
  return bytes;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function rpc(url, method, params = []) {
  const response = await globalThis.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: globalThis.AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const result = await response.json();
  if (result.error) throw new Error(`${method}: ${JSON.stringify(result.error)}`);
  return result.result;
}

async function loadProgram(url, id, bytes) {
  // Surfpool 1.6.0 accepts raw hex chunks; its published example's 0x prefix is rejected.
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    const hex = bytes.subarray(offset, offset + 16_384).toString("hex");
    await rpc(url, "surfnet_writeProgram", [id, hex, offset]);
  }
  const account = await rpc(url, "getAccountInfo", [id, { encoding: "base64" }]);
  if (account.value?.executable !== true)
    throw new Error(`${id} was not loaded as an executable program`);
}

async function main() {
  const coreBytes = await verifiedCoreBinary();
  await run(
    "cargo",
    [
      "build-sbf",
      "--tools-version",
      "v1.57",
      "--arch",
      "v3",
      "--features",
      "core-cpi-test",
      "--sbf-out-dir",
      dirname(registryBinary),
      "--",
      "--locked",
    ],
    join(root, "programs/katha_registry"),
  );
  if (!adminLifecycle || primaryJourney) {
    await run(
      "cargo",
      [
        "build-sbf",
        "--tools-version",
        "v1.57",
        "--arch",
        "v3",
        "--sbf-out-dir",
        dirname(marketplaceBinary),
        "--",
        "--locked",
      ],
      join(root, "programs/katha_marketplace"),
    );
  }
  const registryBytes = await readFile(registryBinary);
  await run("pnpm", ["--filter", "@katha/solana", "program:typecheck"]);
  const port = await freePort();
  let wsPort = await freePort();
  while (wsPort === port) wsPort = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${wsPort}`;
  const surfpool = spawn(
    "surfpool",
    [
      "start",
      "--offline",
      "--no-deploy",
      "--ci",
      "--airdrop-amount",
      "0",
      "--port",
      String(port),
      "--ws-port",
      String(wsPort),
      "--db",
      ":memory:",
    ],
    { cwd: tmpdir(), env: toolEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  let surfpoolOutput = "";
  let surfpoolStartError;
  surfpool.once("error", (error) => {
    surfpoolStartError = error;
  });
  for (const stream of [surfpool.stdout, surfpool.stderr]) {
    stream.on("data", (chunk) => {
      surfpoolOutput = (surfpoolOutput + chunk.toString()).slice(-4_000);
    });
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (surfpoolStartError) throw surfpoolStartError;
      if (surfpool.exitCode !== null)
        throw new Error(`Surfpool exited before readiness: ${surfpoolOutput}`);
      try {
        ready = (await rpc(url, "getHealth")) === "ok";
      } catch {
        // The local RPC is still starting.
      }
      if (ready) break;
      await delay(100);
    }
    if (!ready) throw new Error(`Surfpool did not become ready: ${surfpoolOutput}`);
    await loadProgram(url, coreProgram, coreBytes);
    await loadProgram(url, registryProgram, registryBytes);
    if (primaryJourney)
      await loadProgram(
        url,
        "B7q1HFwusCjndtLaTd75wUCSTPtrYw88ABAonLw4b8Lq",
        await readFile(marketplaceBinary),
      );
    await run(
      "pnpm",
      [
        "--filter",
        "@katha/solana",
        "exec",
        "vitest",
        "run",
        ...(adminLifecycle
          ? ["tests/admin-lifecycle.test.ts"]
          : [
              "tests/core-cpi.test.ts",
              "tests/registry-config.test.ts",
              "tests/marketplace-fixtures.test.ts",
              "tests/marketplace-config.test.ts",
              "tests/marketplace-eligibility.test.ts",
              "tests/marketplace-listing.test.ts",
              "tests/marketplace-release.test.ts",
              "tests/marketplace-purchase.test.ts",
              "tests/marketplace-primary.test.ts",
              "tests/marketplace-resale.test.ts",
            ]),
      ],
      root,
      {
        ...toolEnv,
        KATHA_TEST_CORE_SO: coreBinary,
        KATHA_TEST_REGISTRY_SO: registryBinary,
        ...(!adminLifecycle ? { KATHA_TEST_MARKETPLACE_SO: marketplaceBinary } : {}),
        ...(primaryJourney ? { KATHA_TEST_PRIMARY_BROWSER: "1" } : {}),
        KATHA_TEST_SURFPOOL_RPC: url,
        KATHA_TEST_SURFPOOL_WS: wsUrl,
      },
    );
  } finally {
    if (!surfpoolStartError) {
      surfpool.kill("SIGTERM");
      for (let attempt = 0; attempt < 50 && surfpool.exitCode === null; attempt++)
        await delay(100);
      if (surfpool.exitCode === null) surfpool.kill("SIGKILL");
    }
  }
}

main().catch((error) => {
  globalThis.console.error(error);
  process.exitCode = 1;
});
