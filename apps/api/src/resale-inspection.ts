import { randomUUID } from "node:crypto";
import {
  readConditionInspectionScope,
  type ConditionAttestationReader,
  type MarketplaceListingReader,
} from "@katha/solana";
import {
  getKathaConfigDecoder,
  getConditionAttestationDecoder,
  getConditionHeadDecoder,
  ConditionReason,
} from "@katha/solana/registry";
import { getMarketplaceConfigDecoder, ListingStatus } from "@katha/solana/marketplace";
import {
  resaleInspectionRequestSchema,
  resaleInspectionReviewSchema,
} from "@katha/shared";
import type { ResaleInspectionStore } from "@katha/db";
import type { WalletSessionBoundary } from "./wallet-session.js";
import type { AuthorizationBoundary } from "./authorization.js";
import { DomainError } from "./errors.js";
export function createResaleInspection(
  store: ResaleInspectionStore,
  sessions: Pick<WalletSessionBoundary, "authenticate">,
  authorization: AuthorizationBoundary,
  readCondition: ConditionAttestationReader,
  readMarket: MarketplaceListingReader,
  cluster: "localnet" | "devnet",
) {
  async function live(kathaId: string) {
    const [accounts, market] = await Promise.all([
      readCondition(kathaId, randomUUID()),
      readMarket(kathaId),
    ]);
    const config = getKathaConfigDecoder().decode(accounts.configAccount.data);
    let scoped;
    try {
      scoped = await readConditionInspectionScope(
        config.verifierAuthority,
        accounts,
        kathaId,
      );
    } catch (error) {
      if (error instanceof TypeError) throw new DomainError("CONFLICT");
      throw error;
    }
    if (
      !scoped.scope ||
      !accounts.currentReportAccount ||
      !accounts.conditionHeadAccount.exists
    )
      throw new DomainError("CONFLICT");
    const scope = scoped.scope;
    const report = getConditionAttestationDecoder().decode(
      accounts.currentReportAccount.data,
    );
    const head = getConditionHeadDecoder().decode(accounts.conditionHeadAccount.data);
    const marketHead = getConditionHeadDecoder().decode(
      market.accounts.conditionHeadAccount.data,
    );
    // Separate finalized reads are observations, not a reservation. Mismatches fail closed.
    if (
      market.state.owner !== scope.ownerWallet ||
      market.state.artistId !== scoped.record.artistId ||
      market.accounts.artworkAccount.address !== accounts.artworkAccount.address ||
      marketHead.version !== head.version ||
      marketHead.currentReport !== head.currentReport ||
      Buffer.from(marketHead.currentHash).toString("hex") !==
        Buffer.from(head.currentHash).toString("hex")
    )
      throw new DomainError("CONFLICT");
    const validity = getMarketplaceConfigDecoder().decode(
      market.accounts.marketplaceConfigAccount.data,
    ).inspectionValiditySeconds;
    const now = market.chainTime;
    const hash = Buffer.from(head.currentHash).toString("hex");
    const secondary = (market.state.ledger?.completedSales ?? 0n) > 0n;
    const validReport =
      report.verifier === config.verifierAuthority &&
      !/^0+$/.test(hash) &&
      report.inspectedAt > 0n &&
      report.inspectedAt <= report.recordedAt &&
      report.recordedAt <= now;
    const revisionMatches =
      report.custodyRevisionScope.__option === "Some" &&
      report.custodyRevisionScope.value === BigInt(scope.custodyRevision);
    const ownerMatches =
      report.ownerScope.__option === "Some" &&
      report.ownerScope.value === scope.ownerWallet;
    const initial =
      report.version === 1 &&
      report.reason === ConditionReason.InitialVerification &&
      report.ownerScope.__option === "None" &&
      report.custodyRevisionScope.__option === "None" &&
      scope.custodyRevision === 1;
    const until = report.inspectedAt + validity;
    const reason = secondary ? ConditionReason.PreResale : ConditionReason.PreSale;
    const required = scope.custodyState === "COLLECTOR_HELD";
    const status = !required
      ? validReport && (initial || revisionMatches)
        ? "NOT_REQUIRED"
        : "STALE"
      : !validReport
        ? "STALE"
        : report.reason !== reason
          ? "REQUIRED"
          : !ownerMatches || !revisionMatches
            ? "STALE"
            : validity === 0n || now > until
              ? "EXPIRED"
              : "APPROVED";
    const approved = status === "APPROVED" || status === "NOT_REQUIRED";
    return {
      scope,
      secondary,
      canList: approved && market.state.ledger?.status !== ListingStatus.Active,
      inspection: {
        status,
        report: head.currentReport,
        hash,
        version: head.version,
        inspectedAt: report.inspectedAt.toString(),
        validUntil: required ? until.toString() : null,
      },
      chainTime: now.toString(),
    };
  }
  async function review(bearer: string | undefined, kathaId: string, verifier = false) {
    const session = verifier
      ? await authorization.requireRegistryAuthority(bearer, "verifierAuthority")
      : await sessions.authenticate(bearer);
    if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
    const state = await live(kathaId);
    if (!verifier && session.walletAddress !== state.scope.ownerWallet)
      throw new DomainError("FORBIDDEN");
    const artwork = await store.load(kathaId);
    if (!artwork) throw new DomainError("NOT_FOUND");
    const records = await store.list(
      artwork.id,
      verifier ? undefined : session.walletAddress,
    );
    const pending = records.some(
      (r) =>
        r.ownerWallet === state.scope.ownerWallet &&
        r.custodyRevision === BigInt(state.scope.custodyRevision) &&
        r.conditionVersion === state.inspection.version,
    );
    return resaleInspectionReviewSchema.parse({
      kathaId,
      title: artwork.title,
      cluster,
      ownerWallet: state.scope.ownerWallet,
      custodyState: state.scope.custodyState,
      custodyRevision: String(state.scope.custodyRevision),
      secondary: state.secondary,
      canList: state.canList,
      canRequest:
        !verifier &&
        state.secondary &&
        state.scope.custodyState === "COLLECTOR_HELD" &&
        state.inspection.status !== "APPROVED" &&
        !pending,
      chainTime: state.chainTime,
      inspection: state.inspection,
      requests: records.map((r) => ({
        id: r.id,
        conditionVersion: r.conditionVersion,
        ownerWallet: r.ownerWallet,
        custodyRevision: r.custodyRevision.toString(),
        requestedAt: r.requestedAt.toISOString(),
      })),
    });
  }
  return {
    review,
    async request(bearer: string | undefined, kathaId: string, input: unknown) {
      const parsed = resaleInspectionRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const session = await sessions.authenticate(bearer);
      if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
      const state = await live(kathaId);
      if (state.scope.ownerWallet !== session.walletAddress)
        throw new DomainError("FORBIDDEN");
      if (
        !state.secondary ||
        state.scope.custodyState !== "COLLECTOR_HELD" ||
        String(state.scope.custodyRevision) !== parsed.data.expectedCustodyRevision ||
        state.inspection.version !== parsed.data.expectedConditionVersion
      )
        throw new DomainError("CONFLICT");
      const artwork = await store.load(kathaId);
      if (!artwork) throw new DomainError("NOT_FOUND");
      if (
        !(await store.request(
          artwork,
          session.walletAddress,
          BigInt(parsed.data.expectedCustodyRevision),
          parsed.data.expectedConditionVersion,
          parsed.data.requestId,
        ))
      )
        throw new DomainError("CONFLICT");
      return review(bearer, kathaId);
    },
  };
}
export type ResaleInspectionBoundary = ReturnType<typeof createResaleInspection>;
