import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { walletPermissionsSchema, type WalletSession } from "@katha/shared";
import type { RegistryAuthorities, OperatorAuthorization } from "@katha/solana";
import { createAuthorization } from "../src/authorization.js";
import { DomainError } from "../src/errors.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { temporaryWallet } from "./fixtures/wallet.js";

function fixture() {
  const admin = temporaryWallet().address;
  const verifier = temporaryWallet().address;
  const outsider = temporaryWallet().address;
  const identities = new Map<string, string>([
    ["Bearer admin", admin],
    ["Bearer verifier", verifier],
    ["Bearer outsider", outsider],
  ]);
  const authenticate = vi.fn(
    async (header: string | undefined): Promise<WalletSession> => {
      const walletAddress = identities.get(header ?? "");
      if (!walletAddress) throw new DomainError("UNAUTHENTICATED");
      return {
        walletAddress,
        walletId: randomUUID(),
        cluster: "localnet",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    },
  );
  const authorities: RegistryAuthorities = {
    authority: admin,
    registrationAuthority: admin,
    custodyAuthority: admin,
    verifierAuthority: verifier,
  };
  const readAuthorities = vi.fn(async () => authorities);
  const config = {
    cluster: "localnet" as const,
    adminWallets: [admin],
    verifierWallets: [verifier],
  };
  const authorization = createAuthorization({ authenticate }, config, readAuthorities);
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    undefined,
    [],
    undefined,
    authorization,
  );
  const reached = vi.fn();
  // Test-only handlers exercise the same reserved namespaces as future write routes.
  for (const role of ["admin", "verifier"] as const) {
    for (const path of [`/${role}`, `/${role}/probe`]) {
      app.post(path, (c) => {
        reached();
        return c.json({ walletAddress: c.get("walletSession").walletAddress });
      });
    }
  }
  return {
    admin,
    verifier,
    outsider,
    identities,
    authenticate,
    authorities,
    readAuthorities,
    config,
    authorization,
    app,
    reached,
    logs,
  };
}

it("admits only the configured role, with no admin-to-verifier inheritance", async () => {
  const f = fixture();
  expect(
    (
      await f.app.request("/admin/probe", {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await f.app.request("/verifier/probe", {
        method: "POST",
        headers: { Authorization: "Bearer verifier" },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await f.app.request("/verifier/probe", {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await f.app.request("/admin/probe", {
        method: "POST",
        headers: { Authorization: "Bearer verifier" },
      })
    ).status,
  ).toBe(403);
  expect(f.reached).toHaveBeenCalledTimes(2);
  expect(f.readAuthorities).toHaveBeenCalled();
});
it.each([
  "/admin",
  "/admin/probe",
  "/admin/future/path",
  "/verifier",
  "/verifier/probe",
  "/verifier/future/path",
])("guards %s before any write handler", async (path) => {
  const f = fixture();
  const anonymous = await f.app.request(path, {
    method: "POST",
    headers: { "X-Role": "admin" },
  });
  expect(anonymous.status).toBe(401);
  const denied = await f.app.request(path + "?role=admin", {
    method: "POST",
    headers: {
      Authorization: "Bearer outsider",
      "X-Role": "admin",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "admin", walletAddress: f.admin }),
  });
  expect(denied.status).toBe(403);
  expect(denied.headers.get("Cache-Control")).toBe("no-store");
  expect(f.reached).not.toHaveBeenCalled();
  expect(f.logs.join("")).not.toContain(f.admin);
  expect(f.logs.join("")).not.toContain("Bearer outsider");
});
it("rechecks sessions and rejects revoked, expired or wrong-cluster sessions", async () => {
  const f = fixture();
  await f.authorization.requireRole("Bearer admin", "admin");
  f.authenticate.mockResolvedValueOnce({
    walletId: randomUUID(),
    walletAddress: f.admin,
    cluster: "devnet",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  expect(
    (
      await f.app.request("/auth/permissions?admin=true", {
        headers: { Authorization: "Bearer admin" },
      })
    ).status,
  ).toBe(403);
  f.identities.delete("Bearer admin");
  await expect(
    f.authorization.requireRole("Bearer admin", "admin"),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  f.authenticate.mockResolvedValueOnce({
    walletAddress: f.admin,
    walletId: randomUUID(),
    cluster: "devnet",
    expiresAt: new Date().toISOString(),
  });
  await expect(
    f.authorization.requireRole("Bearer admin", "admin"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("empty configuration denies and later mutation cannot grant access", async () => {
  const f = fixture();
  const config = {
    ...f.config,
    adminWallets: [] as string[],
    verifierWallets: [] as string[],
  };
  const guard = createAuthorization(
    { authenticate: f.authenticate },
    config,
    f.readAuthorities,
  );
  config.adminWallets.push(f.admin);
  await expect(guard.requireRole("Bearer admin", "admin")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it.each([
  "authority",
  "registrationAuthority",
  "custodyAuthority",
  "verifierAuthority",
] as const)(
  "requires the exact finalized %s as well as API permission",
  async (role) => {
    const f = fixture();
    const token = role === "verifierAuthority" ? "Bearer verifier" : "Bearer admin";
    await f.authorization.requireRegistryAuthority(token, role);
    f.readAuthorities.mockResolvedValueOnce({ ...f.authorities, [role]: f.outsider });
    await expect(
      f.authorization.requireRegistryAuthority(token, role),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      f.authorization.requireRegistryAuthority("Bearer outsider", role),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.readAuthorities).toHaveBeenCalledTimes(3);
  },
);
it("fails closed on missing, malformed, timed-out or failed Registry reads", async () => {
  const f = fixture();
  for (const cause of [
    new Error("provider secret"),
    new TypeError("forged owner"),
    new Error("timeout"),
    new Error("uninitialized"),
  ]) {
    f.readAuthorities.mockRejectedValueOnce(cause);
    await expect(
      f.authorization.requireRegistryAuthority("Bearer verifier", "verifierAuthority"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This action is not permitted.",
    });
  }
});
it("protects namespaces even when authorization dependencies are absent", async () => {
  const app = createApi(createLogger(() => {}));
  const write = vi.fn();
  app.post("/admin/probe", (c) => {
    write();
    return c.body(null, 204);
  });
  expect((await app.request("/admin/probe", { method: "POST" })).status).toBe(401);
  expect(write).not.toHaveBeenCalled();
  expect((await app.request("/health/live")).status).toBe(200);
});
it("allows a wallet with both explicitly assigned roles", async () => {
  const f = fixture();
  const guard = createAuthorization(
    { authenticate: f.authenticate },
    { ...f.config, verifierWallets: [f.admin] },
    f.readAuthorities,
  );
  expect((await guard.requireRole("Bearer admin", "verifier")).walletAddress).toBe(
    f.admin,
  );
});

it("discovers only current authenticated permissions through fresh chain reads", async () => {
  const f = fixture();
  for (const [token, admin, verifier] of [
    ["admin", true, false],
    ["verifier", false, true],
    ["outsider", false, false],
  ] as const) {
    const res = await f.app.request("/auth/permissions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = walletPermissionsSchema.parse(await res.json());
    expect(Object.keys(body).sort()).toEqual(["admin", "session", "verifier"]);
    expect(body.admin).toBe(admin);
    expect(body.verifier).toBe(verifier);
    expect(body.session.walletAddress).toBe(f.identities.get(`Bearer ${token}`));
  }
  f.identities.delete("Bearer admin");
  expect(
    (
      await f.app.request("/auth/permissions", {
        headers: { Authorization: "Bearer admin" },
      })
    ).status,
  ).toBe(401);
  expect((await f.app.request("/auth/permissions")).status).toBe(401);
  expect((await createApi().request("/auth/permissions")).status).toBe(401);
  expect(f.readAuthorities).toHaveBeenCalled();
});

function grantFor(f: ReturnType<typeof fixture>, roles: number): OperatorAuthorization {
  const wallet = f.admin as OperatorAuthorization["wallet"];
  return {
    wallet,
    roles,
    governance: wallet,
    grant: wallet,
    registryConfig: wallet,
    pauses: 0,
    slot: 123n,
  };
}

it("uses fresh grants instead of environment lists and rejects a revoked session on its next request", async () => {
  const f = fixture();
  const authorization = createAuthorization(
    { authenticate: f.authenticate },
    { ...f.config, adminWallets: [], verifierWallets: [] },
    f.readAuthorities,
  );
  f.readAuthorities.mockResolvedValue({
    ...f.authorities,
    operatorAuthorization: grantFor(f, 1 | 4),
  });
  expect(
    (
      await authorization.requireRegistryAuthority(
        "Bearer admin",
        "registrationAuthority",
      )
    ).walletAddress,
  ).toBe(f.admin);
  expect(
    (await authorization.requirePermission("Bearer admin", 1)).authorizationSlot,
  ).toBe(123n);
  f.readAuthorities.mockResolvedValue({
    ...f.authorities,
    operatorAuthorization: grantFor(f, 0),
  });
  await expect(
    authorization.requireRole("Bearer admin", "admin"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    f.authorization.requireRole("Bearer admin", "admin"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("does not implicitly grant routine powers to the root or to another operator role", async () => {
  const f = fixture();
  f.readAuthorities.mockResolvedValue({
    ...f.authorities,
    operatorAuthorization: grantFor(f, 8),
  });
  await expect(
    f.authorization.requirePermission("Bearer admin", 2),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    f.authorization.requireRegistryAuthority("Bearer admin", "registrationAuthority"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (
      await f.authorization.requireRegistryAuthority(
        "Bearer admin",
        "verifierAuthority",
      )
    ).walletAddress,
  ).toBe(f.admin);
  f.readAuthorities.mockResolvedValue({
    ...f.authorities,
    operatorAuthorization: grantFor(f, 64),
  });
  await expect(
    f.authorization.requirePermission("Bearer admin", 1 | 4 | 16 | 32),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    f.authorization.requireRegistryAuthority("Bearer admin", "authority"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("denies protected reads and database writes when chain permission reads fail or pause", async () => {
  const f = fixture();
  f.readAuthorities.mockRejectedValue(new Error("RPC unavailable"));
  await expect(
    f.authorization.requireRole("Bearer admin", "admin"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    f.authorization.requirePermission("Bearer verifier", 2),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(f.authorization.permissions("Bearer admin")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  f.readAuthorities.mockResolvedValue({
    ...f.authorities,
    operatorAuthorization: { ...grantFor(f, 127), pauses: 1 },
  });
  await expect(
    f.authorization.requirePermission("Bearer admin", 1),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("reports provider timeouts as service failures and never reaches a protected write", async () => {
  const f = fixture();
  const timeout = new Error("Synthetic private provider details");
  timeout.name = "TimeoutError";
  f.readAuthorities.mockRejectedValue(timeout);
  const response = await f.app.request("/admin/probe", {
    method: "POST",
    headers: { Authorization: "Bearer admin" },
  });
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain(timeout.message);
  expect(f.reached).not.toHaveBeenCalled();
  await expect(
    f.authorization.requireRegistryAuthority("Bearer admin", "registrationAuthority"),
  ).rejects.toThrow("Registry authorization unavailable");
});
