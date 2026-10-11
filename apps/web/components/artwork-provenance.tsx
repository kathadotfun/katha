import Link from "next/link";
import type {
  ArtworkProvenanceResponse,
  PublicArtworkDetail,
  PublicProvenanceEvent,
} from "@katha/shared";
import { artworkPhotoUrl } from "../lib/artwork-page";
import type { ArtworkEvidence, MetadataIntegrity } from "../lib/artwork-provenance";
import { shortAddress, tokenAmount } from "../lib/format";
import {
  custodyLabels,
  gradeLabels,
  reasonLabels,
  Reference,
  Time,
} from "./artwork-care";
import { CopyButton } from "./ui/copy-button";
import { Pagination } from "./ui/pagination";
import { Badge, Icon, Notice, type Tone } from "./ui/status";

export const integrityStatus: Readonly<
  Record<MetadataIntegrity["status"], { tone: Tone; badge: string; detail: string }>
> = {
  MATCH: {
    tone: "ok",
    badge: "Matches",
    detail: "Metadata bytes match the published commitment.",
  },
  MISMATCH: {
    tone: "err",
    badge: "Mismatch",
    detail:
      "Metadata integrity failure: the bytes don't match the published commitment.",
  },
  INVALID: {
    tone: "err",
    badge: "Invalid",
    detail: "The metadata document is invalid or belongs to a different artwork.",
  },
  UNAVAILABLE: {
    tone: "neu",
    badge: "Not checked",
    detail:
      "Metadata integrity couldn't be checked right now. Try refreshing the page.",
  },
  UNSUPPORTED: {
    tone: "neu",
    badge: "Not checked",
    detail:
      "The document is outside Katha's public storage, so integrity is unchecked.",
  },
};

const ownerChecks = {
  MATCH:
    "Matched the Solana asset owner at the recorded check; this isn't a live ownership check.",
  MISMATCH:
    "Katha's index differs from the owner observed on Solana. Don't rely on this owner record until it's reconciled.",
  MISSING: "The Solana ownership check found no asset. Ownership is unconfirmed.",
  INVALID:
    "The Solana ownership check found an invalid asset. Ownership is unconfirmed.",
  STALE: "The Solana ownership check is stale. Ownership is unconfirmed.",
} as const;

export function ownershipStatus(
  artwork: PublicArtworkDetail,
  history: ArtworkProvenanceResponse | null,
): { tone: Tone; badge: string; detail: React.ReactNode } {
  const check = history?.indexing.ownerCheck?.status;
  if (check === "MISMATCH")
    return {
      tone: "err",
      badge: "Records disagree",
      detail: "Katha is reconciling its index with Solana",
    };
  if (history && ["LAGGING", "STALE"].includes(history.indexing.status))
    return {
      tone: "warn",
      badge: "Updating",
      detail: "Recent activity is still being indexed",
    };
  if (check && check !== "MATCH")
    return { tone: "warn", badge: "Unconfirmed", detail: ownerChecks[check] };
  return {
    tone: "neu",
    badge: shortAddress(artwork.ownership.ownerWallet),
    detail: (
      <>
        Observed <Time value={artwork.ownership.observedAt} />
      </>
    ),
  };
}

function lower(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

function eventTitle(event: PublicProvenanceEvent): string {
  switch (event.type) {
    case "REGISTRATION":
      return "Registered";
    case "VERIFICATION":
      return "Verified";
    case "METADATA":
      return `Metadata version ${event.data.version}`;
    case "CONDITION":
      return "Condition inspection";
    case "CUSTODY":
      return "Custody recorded";
    case "MINT":
      return "Minted";
    case "TRANSFER":
      return event.data.sale
        ? event.data.sale.isPrimary
          ? "Primary sale"
          : "Secondary sale"
        : "Ownership transferred";
  }
}

function EventDetail({
  event,
  artwork,
  apiOrigin,
}: {
  event: PublicProvenanceEvent;
  artwork: PublicArtworkDetail;
  apiOrigin: string;
}) {
  const cluster = artwork.chain.cluster;
  switch (event.type) {
    case "REGISTRATION":
      return (
        <p className="p sm">
          Permanent Katha ID issued; attributed to {artwork.artist.displayName}.
        </p>
      );
    case "VERIFICATION":
      return (
        <p className="p sm">
          Katha verification recorded. Authorship evidence matched.
        </p>
      );
    case "METADATA":
      return (
        <p className="p sm">
          Metadata version {event.data.version} committed. Earlier versions are
          preserved.
        </p>
      );
    case "MINT":
      return (
        <p className="p sm">Unique digital asset created and bound to this record.</p>
      );
    case "CUSTODY":
      return (
        <p className="p sm">
          {custodyLabels[event.data.fromState]} → {custodyLabels[event.data.toState]}.
          Revision {event.data.revision}, attested by{" "}
          <Reference cluster={cluster} kind="address" value={event.data.attestedBy} />.
          A physical custody claim, separate from digital ownership.
        </p>
      );
    case "CONDITION":
      return (
        <div className="flex flex-col gap-2">
          <p className="p sm">
            Condition report {event.data.version}: {gradeLabels[event.data.grade]},{" "}
            {lower(reasonLabels[event.data.reason])}. Physically inspected{" "}
            <Time value={event.data.inspectedAt} />.
          </p>
          {event.data.publicMedia.length ? (
            <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
              {event.data.publicMedia.map((media) => {
                const src = artworkPhotoUrl(apiOrigin, { ...media, kind: "IMAGE" });
                return (
                  <li key={media.contentHash} className="min-w-0">
                    <a
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lnk sm"
                    >
                      <span
                        className="ph cut-s mb-2 block"
                        style={{ aspectRatio: "4 / 3" }}
                      >
                        <img src={src} alt={media.altText} loading="lazy" />
                      </span>
                      View report {event.data.version} photograph
                      <span className="sr-only">, opens in a new tab</span>
                    </a>
                    <p className="xs mut id mt-1 mb-0">
                      Photo SHA-256: {media.contentHash}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="xs mut m-0">
              No approved public photographs for this report. Private inspection
              evidence stays private.
            </p>
          )}
        </div>
      );
    case "TRANSFER":
      return (
        <div className="flex flex-col gap-2">
          <p className="p sm">
            Recorded new owner:{" "}
            <Reference cluster={cluster} kind="address" value={event.data.newOwner} />
          </p>
          {event.data.sale ? (
            <dl className="m-0">
              <div className="kv">
                <dt>Seller</dt>
                <dd>
                  <Reference
                    cluster={cluster}
                    kind="address"
                    value={event.data.sale.sellerWallet}
                  />
                </dd>
              </div>
              <div className="kv">
                <dt>Price</dt>
                <dd>
                  {tokenAmount(event.data.sale.price)} Katha test token (
                  {event.data.sale.price} base units)
                </dd>
              </div>
              <div className="kv">
                <dt>Settlement</dt>
                <dd>
                  {event.data.sale.isPrimary ? "Artist proceeds" : "Seller proceeds"}{" "}
                  {tokenAmount(event.data.sale.proceedsAmount)} · Artist royalty{" "}
                  {tokenAmount(event.data.sale.royaltyAmount)} · Platform fee{" "}
                  {tokenAmount(event.data.sale.platformFee)}
                </dd>
              </div>
              <div className="kv">
                <dt>Payment mint</dt>
                <dd>
                  <Reference
                    cluster={cluster}
                    kind="address"
                    value={event.data.sale.paymentMint}
                  />
                </dd>
              </div>
              <div className="kv">
                <dt>Listing revision</dt>
                <dd>{event.data.sale.listingRevision}</dd>
              </div>
            </dl>
          ) : (
            <p className="xs mut m-0">
              No matched marketplace settlement is available. This transfer alone
              doesn&apos;t prove a purchase.
            </p>
          )}
        </div>
      );
  }
}

const indexingNotices = {
  UNKNOWN: null,
  AT_OBSERVED_HEAD: null,
  LAGGING: {
    tone: "warn",
    title: "Recent activity is still being indexed.",
    body: "Ownership and history may be a few minutes behind Solana.",
  },
  STALE: {
    tone: "warn",
    title: "Katha's last network observation is stale.",
    body: "Recent transfers, inspections or custody changes may not appear yet.",
  },
  GAP_DETECTED: {
    tone: "warn",
    title: "Some history couldn't be loaded.",
    body: "Part of this work's chain history is missing from Katha's index. It's still on Solana; this list fills in when indexing catches up.",
  },
} as const;

export function HistoryPanel({
  artwork,
  history,
  apiOrigin,
}: {
  artwork: PublicArtworkDetail;
  history: ArtworkProvenanceResponse | null;
  apiOrigin: string;
}) {
  const notice = history ? indexingNotices[history.indexing.status] : null;
  return (
    <div className="flex flex-col gap-3">
      <h3 id="artwork-provenance" className="h3">
        History
      </h3>
      <p className="p sm">
        Artist authorship remains with{" "}
        <Link className="lnk" href={`/artists/${artwork.artist.slug}`}>
          {artwork.artist.displayName}
        </Link>
        . A purchase changes digital ownership; physical custody is recorded separately.
      </p>
      {!history ? (
        <Notice tone="warn">
          <p>
            <strong>History is unavailable right now.</strong> It couldn&apos;t be
            loaded or matched to this artwork.{" "}
            <a className="lnk" href={`/art/${artwork.kathaId}#provenance`}>
              Reload the first history page
            </a>
          </p>
        </Notice>
      ) : (
        <>
          {notice && (
            <Notice tone={notice.tone}>
              <p>
                <strong>{notice.title}</strong> {notice.body}
              </p>
            </Notice>
          )}
          {history.indexing.status === "AT_OBSERVED_HEAD" && (
            <p className="xs mut m-0">
              History reached the last observed finalized slot. This isn&apos;t a live
              network check.
            </p>
          )}
          {history.indexing.status === "UNKNOWN" && (
            <p className="xs mut m-0">History freshness is unconfirmed.</p>
          )}
          {history.indexing.network?.blocked && (
            <Notice tone="err">
              <p>
                <strong>Network indexing is blocked.</strong> Records may be incomplete.
              </p>
            </Notice>
          )}
          {history.items.length ? (
            <ol className="tl" start={history.pagination.offset + 1}>
              {history.items.map((event) => (
                <li key={event.id}>
                  <p className="sm mut m-0">
                    <Time value={event.transaction.recordedAt} date />
                  </p>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="m-0 font-semibold">{eventTitle(event)}</p>
                    <EventDetail
                      event={event}
                      artwork={artwork}
                      apiOrigin={apiOrigin}
                    />
                    <details className="more">
                      <summary>Transaction details</summary>
                      <dl className="m-0">
                        <div className="kv">
                          <dt>Finalized transaction</dt>
                          <dd>
                            <Reference
                              cluster={artwork.chain.cluster}
                              kind="tx"
                              value={event.transaction.signature}
                            />
                          </dd>
                        </div>
                        <div className="kv">
                          <dt>Recorded</dt>
                          <dd>
                            <Time value={event.transaction.recordedAt} />
                          </dd>
                        </div>
                        <div className="kv">
                          <dt>Slot</dt>
                          <dd className="id">{event.transaction.slot}</dd>
                        </div>
                        <div className="kv">
                          <dt>Program</dt>
                          <dd>
                            <Reference
                              cluster={artwork.chain.cluster}
                              kind="address"
                              value={event.programAddress}
                            />
                          </dd>
                        </div>
                        {(event.type === "METADATA" || event.type === "CONDITION") && (
                          <div className="kv">
                            <dt>Document SHA-256</dt>
                            <dd className="id">{event.data.documentHash}</dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="p">
              No indexed events are available on this page. This doesn&apos;t establish
              that no earlier activity exists.
            </p>
          )}
          <Pagination
            label="History pages"
            page={history.pagination.offset / 20 + 1}
            previousHref={
              history.pagination.offset > 0
                ? `/art/${artwork.kathaId}?historyOffset=${history.pagination.offset - 20}#provenance`
                : null
            }
            nextHref={
              history.pagination.hasMore && history.pagination.offset + 20 <= 100000
                ? `/art/${artwork.kathaId}?historyOffset=${history.pagination.offset + 20}#provenance`
                : null
            }
            limitNote={
              history.pagination.hasMore && history.pagination.offset + 20 > 100000
                ? "More history exists beyond the public page limit."
                : null
            }
          />
        </>
      )}
    </div>
  );
}

export function OwnershipPanel({
  artwork,
  history,
}: {
  artwork: PublicArtworkDetail;
  history: ArtworkProvenanceResponse | null;
}) {
  const status = ownershipStatus(artwork, history);
  const check = history?.indexing.ownerCheck;
  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <h3 id="artwork-owner" className="h3">
        Digital ownership
      </h3>
      <dl className="m-0">
        <div className="kv kv-wide">
          <dt>Owner</dt>
          <dd className="id">
            <Reference
              cluster={artwork.chain.cluster}
              kind="address"
              value={artwork.ownership.ownerWallet}
            />
            <CopyButton
              value={artwork.ownership.ownerWallet}
              label="Copy owner address"
            />
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Source</dt>
          <dd>Solana asset account, read through Katha&apos;s index</dd>
        </div>
        <div className="kv kv-wide">
          <dt>Observed</dt>
          <dd>
            <Time value={artwork.ownership.observedAt} />
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Status</dt>
          <dd>
            <Badge tone={status.tone}>{status.badge}</Badge>
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Ownership check</dt>
          <dd>
            {check ? (
              <>
                {ownerChecks[check.status]} Checked <Time value={check.checkedAt} /> at
                slot <span className="id">{check.observedSlot}</span>.
              </>
            ) : (
              "Ownership reconciliation is unavailable. This isn't a live ownership check."
            )}
          </dd>
        </div>
      </dl>
      <p className="xs mut m-0">
        Owning the digital asset is separate from holding the painting, and from its
        copyright.
      </p>
    </div>
  );
}

export function ChainPanel({
  artwork,
  evidence,
}: {
  artwork: PublicArtworkDetail;
  evidence: ArtworkEvidence;
}) {
  const { history, integrity } = evidence;
  const status = integrityStatus[integrity.status];
  const cluster = artwork.chain.cluster;
  const assetHref =
    cluster === "DEVNET"
      ? `https://explorer.solana.com/address/${artwork.chain.coreAssetAddress}?cluster=devnet`
      : null;
  return (
    <div className="flex flex-col gap-4">
      <h3 id="artwork-integrity" className="h3">
        On-chain details
      </h3>
      <dl className="m-0">
        <div className="kv kv-wide">
          <dt>Network</dt>
          <dd>
            {cluster === "DEVNET"
              ? "Solana Devnet, a test network"
              : "Localnet, local development only; no public explorer links"}
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Asset address</dt>
          <dd className="id">
            <Reference
              cluster={cluster}
              kind="address"
              value={artwork.chain.coreAssetAddress}
            />
            <CopyButton
              value={artwork.chain.coreAssetAddress}
              label="Copy asset address"
            />
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Registry address</dt>
          <dd className="id">
            {artwork.chain.registryRecordAddress ? (
              <>
                <Reference
                  cluster={cluster}
                  kind="address"
                  value={artwork.chain.registryRecordAddress}
                />
                <CopyButton
                  value={artwork.chain.registryRecordAddress}
                  label="Copy registry address"
                />
              </>
            ) : (
              "Address unavailable"
            )}
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Collection</dt>
          <dd className="id">
            {artwork.chain.collectionAddress ? (
              <Reference
                cluster={cluster}
                kind="address"
                value={artwork.chain.collectionAddress}
              />
            ) : (
              "Address unavailable"
            )}
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Metadata document</dt>
          <dd>Version {artwork.metadata.version}</dd>
        </div>
        <div className="kv kv-wide">
          <dt>Metadata fingerprint</dt>
          <dd className="id">sha256 {artwork.metadata.documentHash}</dd>
        </div>
        {integrity.actualHash &&
          integrity.actualHash !== artwork.metadata.documentHash && (
            <div className="kv kv-wide">
              <dt>Observed fingerprint</dt>
              <dd className="id">sha256 {integrity.actualHash}</dd>
            </div>
          )}
        <div className="kv kv-wide">
          <dt>Integrity</dt>
          <dd>
            <Badge tone={status.tone}>{status.badge}</Badge>{" "}
            <span className="sm mut">{status.detail}</span>
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Metadata transaction</dt>
          <dd>
            <Reference
              cluster={cluster}
              kind="tx"
              value={artwork.metadata.transaction.signature}
            />
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Verification transaction</dt>
          <dd>
            <Reference
              cluster={cluster}
              kind="tx"
              value={artwork.verification.transaction.signature}
            />
          </dd>
        </div>
      </dl>
      {history && (history.indexing.network || history.indexing.streams.length > 0) && (
        <details className="more">
          <summary>Indexing details</summary>
          <dl className="m-0">
            {history.indexing.network && (
              <div className="kv kv-wide">
                <dt>Last observed finalized slot</dt>
                <dd className="id">
                  {history.indexing.network.observedFinalizedSlot} ·{" "}
                  <Time value={history.indexing.network.observedAt} />
                </dd>
              </div>
            )}
            {history.indexing.streams.map((stream) => (
              <div key={stream.programAddress} className="kv kv-wide">
                <dt>Program checkpoint</dt>
                <dd>
                  <Reference
                    cluster={cluster}
                    kind="address"
                    value={stream.programAddress}
                  />
                  <p className="xs mut id mt-1 mb-0">
                    {stream.checkpoint
                      ? `Scanned through ${stream.checkpoint.scannedThroughSlot ?? "unknown"}; lag ${stream.checkpoint.lagSlots ?? "unknown"}; gap ${stream.checkpoint.gapFromSlot ?? "none recorded"} to ${stream.checkpoint.gapThroughSlot ?? "none recorded"}; reason ${stream.checkpoint.gapReason ?? "none recorded"}`
                      : "Checkpoint unavailable"}
                  </p>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {assetHref && (
        <a
          className="lnk inline-flex items-center gap-1.5 self-start py-2"
          href={assetHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          View asset on a Solana explorer
          <Icon name="external" size={14} />
          <span className="sr-only">, opens in a new tab</span>
        </a>
      )}
      <p className="xs mut m-0">
        SHA-256 checks the exact document bytes against metadata version{" "}
        {artwork.metadata.version} in the public record. It doesn&apos;t authenticate
        the physical artwork. Photos, stories and private reports are stored off chain;
        Solana keeps ownership history and a fingerprint of each document.
      </p>
    </div>
  );
}
