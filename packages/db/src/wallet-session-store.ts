import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import {
  wallets,
  walletChallenges,
  walletSessions,
  type NewWalletChallengeRecord,
} from "./schema/wallet-sessions.js";

/** Persistence only: the caller must cryptographically validate before issuance. */
export function createWalletSessionStore(db: Database) {
  return {
    async saveChallenge(
      address: string,
      challenge: Omit<NewWalletChallengeRecord, "walletId">,
    ) {
      return db.transaction(async (tx) => {
        await tx.insert(wallets).values({ address }).onConflictDoNothing();
        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.address, address));
        if (!wallet) throw new Error("Wallet persistence failed");
        const [record] = await tx
          .insert(walletChallenges)
          .values({ ...challenge, walletId: wallet.id })
          .returning();
        if (!record) throw new Error("Challenge persistence failed");
        return record;
      });
    },
    async findChallenge(id: string) {
      const [record] = await db
        .select({ challenge: walletChallenges, address: wallets.address })
        .from(walletChallenges)
        .innerJoin(wallets, eq(wallets.id, walletChallenges.walletId))
        .where(eq(walletChallenges.id, id));
      return record;
    },
    async issueSession(
      challengeId: string,
      walletId: string,
      tokenHash: string,
      expiresAt: Date,
    ) {
      try {
        return await db.transaction(async (tx) => {
          const [consumed] = await tx
            .update(walletChallenges)
            .set({ consumedAt: new Date() })
            .where(
              and(
                eq(walletChallenges.id, challengeId),
                eq(walletChallenges.walletId, walletId),
                isNull(walletChallenges.consumedAt),
                sql`clock_timestamp() >= ${walletChallenges.issuedAt}`,
                sql`clock_timestamp() < ${walletChallenges.expiresAt}`,
              ),
            )
            .returning();
          if (!consumed) return undefined;
          const [session] = await tx
            .insert(walletSessions)
            .values({ challengeId, walletId, tokenHash, expiresAt })
            .returning();
          return session;
        });
      } catch (error) {
        // Expiry can occur between the update and insertion; rollback both writes.
        const cause = error instanceof Error ? error.cause : undefined;
        const driver = cause ?? error;
        if (
          driver &&
          typeof driver === "object" &&
          "constraint_name" in driver &&
          ["wallet_challenges_expired", "wallet_sessions_challenge_valid"].includes(
            String(driver.constraint_name),
          )
        )
          return undefined;
        throw error;
      }
    },
    async findSession(
      tokenHash: string,
      domain: string,
      cluster: "LOCALNET" | "DEVNET",
    ) {
      const [record] = await db
        .select({
          session: walletSessions,
          challenge: walletChallenges,
          address: wallets.address,
        })
        .from(walletSessions)
        .innerJoin(
          walletChallenges,
          eq(walletChallenges.id, walletSessions.challengeId),
        )
        .innerJoin(wallets, eq(wallets.id, walletSessions.walletId))
        .where(
          and(
            eq(walletSessions.tokenHash, tokenHash),
            isNull(walletSessions.revokedAt),
            sql`${walletSessions.expiresAt} > clock_timestamp()`,
            eq(walletChallenges.domain, domain),
            eq(walletChallenges.cluster, cluster),
          ),
        );
      return record;
    },
    async revokeSession(tokenHash: string) {
      await db
        .update(walletSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(walletSessions.tokenHash, tokenHash),
            isNull(walletSessions.revokedAt),
          ),
        );
    },
  };
}
export type WalletSessionStore = ReturnType<typeof createWalletSessionStore>;
