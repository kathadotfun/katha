import { OPERATOR_ROLES as R } from "@katha/shared";
import type { WalletSession } from "@katha/shared";
import type {
  RegistryAuthorities,
  RegistryAuthorityRole,
  OperatorAuthorization,
} from "@katha/solana";
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
  readAuthorities: (wallet?: string) => Promise<RegistryAuthorities>,
) {
  // Copy trusted startup configuration; never persist roles in bearer sessions.
  const wallets = {
    admin: new Set(config.adminWallets),
    verifier: new Set(config.verifierWallets),
  };
  async function current(session: WalletSession) {
    if (session.cluster !== config.cluster) throw new DomainError("FORBIDDEN");
    try {
      return await readAuthorities(session.walletAddress);
    } catch {
      throw new DomainError("FORBIDDEN");
    }
  }
  function permitted(
    session: WalletSession,
    authorities: RegistryAuthorities,
    role: AdministrativeRole,
  ) {
    const grant = authorities.operatorAuthorization;
    if (grant) {
      if (grant.wallet !== session.walletAddress || grant.pauses & 1) return false;
      return role === "admin"
        ? Boolean(
            grant.roles &
            (R.catalog | R.registrar | R.custody | R.inventorySales | R.guardian),
          )
        : Boolean(grant.roles & (R.artistVerifier | R.artworkVerifier));
    }
    return wallets[role].has(session.walletAddress);
  }
  async function requireRole(
    authorization: string | undefined,
    role: AdministrativeRole,
  ): Promise<WalletSession> {
    const session = await sessions.authenticate(authorization);
    if (!permitted(session, await current(session), role))
      throw new DomainError("FORBIDDEN");
    return session;
  }
  return {
    requireRole,
    async requirePermission(authorization: string | undefined, roles: number) {
      const session = await sessions.authenticate(authorization);
      const grant = (await current(session)).operatorAuthorization;
      if (
        grant &&
        (grant.wallet !== session.walletAddress ||
          grant.pauses & 1 ||
          !(grant.roles & roles))
      )
        throw new DomainError("FORBIDDEN");
      if (
        !grant &&
        !wallets.admin.has(session.walletAddress) &&
        !wallets.verifier.has(session.walletAddress)
      )
        throw new DomainError("FORBIDDEN");
      return { ...session, authorizationSlot: grant?.slot };
    },
    async permissions(authorization: string | undefined) {
      const session = await sessions.authenticate(authorization);
      const authorities = await current(session);
      return {
        session,
        admin: permitted(session, authorities, "admin"),
        verifier: permitted(session, authorities, "verifier"),
      };
    },
    async requireRegistryAuthority(
      authorization: string | undefined,
      role: RegistryAuthorityRole,
    ): Promise<
      WalletSession & { operatorAuthorization?: OperatorAuthorization | undefined }
    > {
      const session = await sessions.authenticate(authorization);
      const authorities = await current(session);
      if (
        !permitted(
          session,
          authorities,
          role === "verifierAuthority" ? "verifier" : "admin",
        )
      )
        throw new DomainError("FORBIDDEN");
      const grant = authorities.operatorAuthorization;
      const bit = {
        authority: 0,
        registrationAuthority: R.registrar,
        verifierAuthority: R.artworkVerifier,
        custodyAuthority: R.custody,
      }[role];
      if (
        grant
          ? role === "authority" ||
            grant.wallet !== session.walletAddress ||
            !(grant.roles & bit) ||
            Boolean(grant.pauses & 1)
          : authorities[role] !== session.walletAddress
      )
        throw new DomainError("FORBIDDEN");
      return { ...session, operatorAuthorization: grant };
    },
  };
}
export type AuthorizationBoundary = ReturnType<typeof createAuthorization>;
