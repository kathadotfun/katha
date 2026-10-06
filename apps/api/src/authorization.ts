import type { WalletSession } from "@katha/shared";
import type { RegistryAuthorities, RegistryAuthorityRole } from "@katha/solana";
import type { WalletSessionBoundary } from "./wallet-session.js";
import { DomainError } from "./errors.js";

export type AdministrativeRole = "admin" | "verifier";
export function createAuthorization(
  sessions: Pick<WalletSessionBoundary, "authenticate">,
  config: {
    cluster: "localnet" | "devnet";
    adminWallets: readonly string[];
    verifierWallets: readonly string[];
  },
  readAuthorities: () => Promise<RegistryAuthorities>,
) {
  // Copy trusted startup configuration; never persist roles in bearer sessions.
  const wallets = {
    admin: new Set(config.adminWallets),
    verifier: new Set(config.verifierWallets),
  };
  async function requireRole(
    authorization: string | undefined,
    role: AdministrativeRole,
  ): Promise<WalletSession> {
    const session = await sessions.authenticate(authorization);
    if (session.cluster !== config.cluster || !wallets[role].has(session.walletAddress))
      throw new DomainError("FORBIDDEN");
    return session;
  }
  return {
    requireRole,
    async permissions(authorization: string | undefined) {
      const session = await sessions.authenticate(authorization);
      if (session.cluster !== config.cluster) throw new DomainError("FORBIDDEN");
      return {
        session,
        admin: wallets.admin.has(session.walletAddress),
        verifier: wallets.verifier.has(session.walletAddress),
      };
    },
    async requireRegistryAuthority(
      authorization: string | undefined,
      role: RegistryAuthorityRole,
    ): Promise<WalletSession> {
      const session = await requireRole(
        authorization,
        role === "verifierAuthority" ? "verifier" : "admin",
      );
      let authorities: RegistryAuthorities;
      try {
        authorities = await readAuthorities();
      } catch {
        // An unavailable or invalid chain response never grants authority.
        throw new DomainError("FORBIDDEN");
      }
      if (authorities[role] !== session.walletAddress)
        throw new DomainError("FORBIDDEN");
      return session;
    },
  };
}
export type AuthorizationBoundary = ReturnType<typeof createAuthorization>;
