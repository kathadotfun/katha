import Link from "next/link";
import { artworkPhotoUrl } from "../lib/artwork-page";
import type { PublicArtworkDetail, PublicProvenanceEvent } from "@katha/shared";
import { explorerLink, type ArtworkEvidence } from "../lib/artwork-provenance";

const dates = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
function Time({ value }: { value: string }) {
  return <time dateTime={value}>{dates.format(new Date(value))} UTC</time>;
}
const indexingLabels = {
  UNKNOWN: "History freshness is unconfirmed.",
  GAP_DETECTED: "Some chain history is missing.",
  LAGGING: "History is catching up with the observed network.",
  STALE: "The last network observation is stale.",
  AT_OBSERVED_HEAD:
    "History reached the last observed finalized slot. This is not a live network check.",
};
const integrityLabels = {
  MATCH: "Metadata bytes match the published commitment.",
  MISMATCH:
    "Metadata integrity failure: the bytes do not match the published commitment.",
  INVALID: "Metadata document is invalid or belongs to a different artwork.",
  UNAVAILABLE: "Metadata integrity could not be checked. Try refreshing the page.",
  UNSUPPORTED:
    "Metadata integrity is unchecked: this document is outside the configured public storage service.",
};
const ownerLabels = {
  MATCH: "Matched Core at the recorded check; this is not a live ownership check.",
  MISMATCH:
    "Indexed ownership differs from the observed Core owner. Do not rely on this owner record.",
  MISSING: "The Core ownership check found no asset. Ownership is unconfirmed.",
  INVALID: "The Core ownership check found an invalid asset. Ownership is unconfirmed.",
  STALE: "The Core ownership check is stale. Ownership is unconfirmed.",
};
function eventDescription(event: PublicProvenanceEvent): string {
  switch (event.type) {
    case "REGISTRATION":
      return "Permanent artwork identity registered";
    case "VERIFICATION":
      return "Katha verification recorded";
    case "METADATA":
      return `Metadata version ${event.data.version} committed`;
    case "CONDITION":
      return `Condition report ${event.data.version}: ${event.data.grade.toLowerCase().replaceAll("_", " ")} · ${event.data.reason.toLowerCase().replaceAll("_", " ")}`;
    case "CUSTODY":
      return `Physical custody recorded: ${event.data.fromState.toLowerCase().replaceAll("_", " ")} → ${event.data.toState.toLowerCase().replaceAll("_", " ")}`;
    case "MINT":
      return "Core artwork asset minted";
    case "TRANSFER":
      return event.data.sale
        ? `${event.data.sale.isPrimary ? "Primary purchase" : "Secondary purchase"} · digital ownership transferred`
        : "Digital ownership transferred";
  }
}
export function ArtworkProvenance({
  artwork,
  evidence,
  apiOrigin,
}: {
  artwork: PublicArtworkDetail;
  evidence?: ArtworkEvidence | undefined;
  apiOrigin: string;
}) {
  const history = evidence?.history;
  const integrity = evidence?.integrity ?? { status: "UNAVAILABLE" as const };
  function Reference({ kind, value }: { kind: "address" | "tx"; value: string }) {
    const href = explorerLink(artwork.chain.cluster, kind, value);
    return href ? (
      <a
        className="break-all font-mono text-sm underline underline-offset-4"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {value}
        <span className="sr-only"> — Solana Devnet Explorer, opens in a new tab</span>
      </a>
    ) : (
      <span className="break-all font-mono text-sm">{value}</span>
    );
  }
  return (
    <section
      id="provenance"
      aria-labelledby="artwork-provenance"
      className="mt-[var(--section-space)]"
    >
      <h2 id="artwork-provenance" className="text-section">
        The recorded history
      </h2>
      <p className="mt-6 max-w-reading text-muted">
        Artist authorship remains with{" "}
        <Link className="underline" href={`/artists/${artwork.artist.slug}`}>
          {artwork.artist.displayName}
        </Link>
        . A purchase changes digital ownership; physical custody is recorded separately.
        Transfers without matched settlement evidence do not establish a sale.
      </p>
      <p className="mt-4 max-w-reading text-muted">
        {history
          ? indexingLabels[history.indexing.status]
          : "History is unavailable or could not be matched to this artwork. Refresh to try again."}
      </p>
      {history?.indexing.network?.blocked && (
        <p className="mt-4 text-brand">
          Network indexing is blocked. Records may be incomplete.
        </p>
      )}
      {history ? (
        <>
          {history.items.length ? (
            <ol className="mt-8 space-y-6" start={history.pagination.offset + 1}>
              {history.items.map((event) => (
                <li key={event.id} className="min-w-0 border-t border-line pt-6">
                  <h3 className="text-xl">{eventDescription(event)}</h3>
                  <p className="mt-2 text-sm text-muted">
                    Chain recorded <Time value={event.transaction.recordedAt} />
                  </p>
                  {event.type === "CONDITION" && (
                    <div className="mt-3">
                      <p className="text-sm">
                        Physically inspected <Time value={event.data.inspectedAt} />
                      </p>
                      <p className="mt-2 text-sm">
                        Verifier:{" "}
                        <Reference kind="address" value={event.data.verifierWallet} />
                      </p>
                      {event.data.publicMedia.length ? (
                        <ul className="mt-4 grid gap-6 sm:grid-cols-2">
                          {event.data.publicMedia.map((media) => (
                            <li key={media.contentHash} className="min-w-0">
                              <a
                                href={artworkPhotoUrl(apiOrigin, {
                                  ...media,
                                  kind: "IMAGE",
                                })}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block underline"
                              >
                                <img
                                  src={artworkPhotoUrl(apiOrigin, {
                                    ...media,
                                    kind: "IMAGE",
                                  })}
                                  alt={media.altText}
                                  loading="lazy"
                                  className="aspect-[4/3] w-full object-contain bg-surface"
                                />
                                View report {event.data.version} photograph
                                <span className="sr-only"> — opens in a new tab</span>
                              </a>
                              <p className="mt-2 break-all font-mono text-xs">
                                Photo SHA-256: {media.contentHash}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-sm text-muted">
                          No approved public photographs are available for this report.
                          Private inspection evidence remains private.
                        </p>
                      )}
                    </div>
                  )}
                  {event.type === "CUSTODY" && (
                    <p className="mt-3 text-sm">
                      Custody revision {event.data.revision}. Attested by{" "}
                      <Reference kind="address" value={event.data.attestedBy} />. This
                      is a physical custody claim, separate from digital ownership.
                    </p>
                  )}
                  {event.type === "TRANSFER" && (
                    <div className="mt-3">
                      <p>
                        Recorded new owner:{" "}
                        <Reference kind="address" value={event.data.newOwner} />
                      </p>
                      {event.data.sale ? (
                        <dl className="artwork-facts mt-4">
                          <div>
                            <dt>Seller</dt>
                            <dd>
                              <Reference
                                kind="address"
                                value={event.data.sale.sellerWallet}
                              />
                            </dd>
                          </div>
                          <div>
                            <dt>Test-token price (base units)</dt>
                            <dd className="break-all font-mono">
                              {event.data.sale.price}
                            </dd>
                          </div>
                          <div>
                            <dt>Payment mint</dt>
                            <dd>
                              <Reference
                                kind="address"
                                value={event.data.sale.paymentMint}
                              />
                            </dd>
                          </div>
                          <div>
                            <dt>Settlement (base units)</dt>
                            <dd className="break-words">
                              Proceeds {event.data.sale.proceedsAmount} · Artist royalty{" "}
                              {event.data.sale.royaltyAmount} · Platform fee{" "}
                              {event.data.sale.platformFee}
                            </dd>
                          </div>
                          <div>
                            <dt>Listing revision</dt>
                            <dd>{event.data.sale.listingRevision}</dd>
                          </div>
                        </dl>
                      ) : (
                        <p className="mt-3 text-sm text-muted">
                          No matched Marketplace settlement is available. This transfer
                          alone does not prove a purchase.
                        </p>
                      )}
                    </div>
                  )}
                  <details className="mt-3">
                    <summary className="cursor-pointer">Transaction details</summary>
                    <dl className="artwork-facts mt-4">
                      <div>
                        <dt>Finalized transaction</dt>
                        <dd>
                          <Reference kind="tx" value={event.transaction.signature} />
                        </dd>
                      </div>
                      <div>
                        <dt>Slot</dt>
                        <dd className="break-all font-mono text-sm">
                          {event.transaction.slot}
                        </dd>
                      </div>
                      <div>
                        <dt>Program</dt>
                        <dd>
                          <Reference kind="address" value={event.programAddress} />
                        </dd>
                      </div>
                      {(event.type === "METADATA" || event.type === "CONDITION") && (
                        <div>
                          <dt>Document SHA-256</dt>
                          <dd className="break-all font-mono text-sm">
                            {event.data.documentHash}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-8">
              No indexed events are available on this page. This does not establish that
              no earlier activity exists.
            </p>
          )}
          <nav aria-label="History pages" className="mt-6 flex flex-wrap gap-6">
            {history.pagination.offset > 0 && (
              <a
                className="underline"
                href={`?historyOffset=${history.pagination.offset - 20}#provenance`}
              >
                Previous history
              </a>
            )}
            {history.pagination.hasMore && history.pagination.offset + 20 <= 100000 && (
              <a
                className="underline"
                href={`?historyOffset=${history.pagination.offset + 20}#provenance`}
              >
                Next history
              </a>
            )}
            {history.pagination.hasMore && history.pagination.offset + 20 > 100000 && (
              <p>More history exists beyond the public pagination limit.</p>
            )}
          </nav>
        </>
      ) : (
        <a
          href={`/art/${artwork.kathaId}#provenance`}
          className="mt-6 inline-block underline"
        >
          Reload first history page
        </a>
      )}
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section
          aria-labelledby="artwork-owner"
          className="min-w-0 border-t border-line pt-6"
        >
          <h3 id="artwork-owner" className="text-2xl">
            Recorded digital owner
          </h3>
          <p className="mt-4">
            <Reference kind="address" value={artwork.ownership.ownerWallet} />
          </p>
          <p className="mt-4 text-sm text-muted">
            Indexed Core observation: <Time value={artwork.ownership.observedAt} />.
            Physical custody is recorded separately.
          </p>
          <p className="mt-4 text-muted">
            {history?.indexing.ownerCheck
              ? ownerLabels[history.indexing.ownerCheck.status]
              : "Core ownership reconciliation is unavailable. This is not a live ownership check."}
          </p>
          {history?.indexing.ownerCheck && (
            <p className="mt-3 text-sm">
              Checked <Time value={history.indexing.ownerCheck.checkedAt} /> at slot{" "}
              <span className="break-all font-mono">
                {history.indexing.ownerCheck.observedSlot}
              </span>
              .
            </p>
          )}
        </section>
        <section
          aria-labelledby="artwork-integrity"
          className="min-w-0 border-t border-line pt-6"
        >
          <h3 id="artwork-integrity" className="text-2xl">
            Metadata integrity
          </h3>
          <p
            className={`mt-4 ${integrity.status === "MISMATCH" || integrity.status === "INVALID" ? "text-brand" : "text-muted"}`}
          >
            {integrityLabels[integrity.status]}
          </p>
          <p className="mt-4 text-sm text-muted">
            SHA-256 checks the exact document bytes against metadata version{" "}
            {artwork.metadata.version} in the public API record. It does not
            independently query the Registry or authenticate the physical artwork.
          </p>
          <details className="mt-4">
            <summary className="cursor-pointer">Commitment and Solana records</summary>
            <dl className="artwork-facts mt-4">
              <div>
                <dt>Expected SHA-256</dt>
                <dd className="break-all font-mono text-sm">
                  {artwork.metadata.documentHash}
                </dd>
              </div>
              {integrity.actualHash && (
                <div>
                  <dt>Observed SHA-256</dt>
                  <dd className="break-all font-mono text-sm">
                    {integrity.actualHash}
                  </dd>
                </div>
              )}
              <div>
                <dt>Network</dt>
                <dd>
                  {artwork.chain.cluster === "DEVNET"
                    ? "Solana Devnet — test network"
                    : "Localnet — local development only; no public explorer links"}
                </dd>
              </div>
              <div>
                <dt>Core asset</dt>
                <dd>
                  <Reference kind="address" value={artwork.chain.coreAssetAddress} />
                </dd>
              </div>
              <div>
                <dt>Registry record</dt>
                <dd>
                  {artwork.chain.registryRecordAddress ? (
                    <Reference
                      kind="address"
                      value={artwork.chain.registryRecordAddress}
                    />
                  ) : (
                    "Address unavailable"
                  )}
                </dd>
              </div>
              <div>
                <dt>Collection</dt>
                <dd>
                  {artwork.chain.collectionAddress ? (
                    <Reference kind="address" value={artwork.chain.collectionAddress} />
                  ) : (
                    "Address unavailable"
                  )}
                </dd>
              </div>
              <div>
                <dt>Metadata transaction</dt>
                <dd>
                  <Reference kind="tx" value={artwork.metadata.transaction.signature} />
                </dd>
              </div>
              <div>
                <dt>Verification transaction</dt>
                <dd>
                  <Reference
                    kind="tx"
                    value={artwork.verification.transaction.signature}
                  />
                </dd>
              </div>
              {history?.indexing.network && (
                <div>
                  <dt>Last observed finalized slot</dt>
                  <dd className="break-all">
                    {history.indexing.network.observedFinalizedSlot} ·{" "}
                    <Time value={history.indexing.network.observedAt} />
                  </dd>
                </div>
              )}
              {history?.indexing.streams.map((stream) => (
                <div key={stream.programAddress}>
                  <dt>Program checkpoint</dt>
                  <dd>
                    <Reference kind="address" value={stream.programAddress} />
                    <p className="mt-2 break-all">
                      {stream.checkpoint
                        ? `Scanned through ${stream.checkpoint.scannedThroughSlot ?? "unknown"}; lag ${stream.checkpoint.lagSlots ?? "unknown"}; gap ${stream.checkpoint.gapFromSlot ?? "none recorded"} to ${stream.checkpoint.gapThroughSlot ?? "none recorded"}; reason ${stream.checkpoint.gapReason ?? "none recorded"}`
                        : "Checkpoint unavailable"}
                    </p>
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      </div>
    </section>
  );
}
