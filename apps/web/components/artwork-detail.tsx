import Link from "next/link";
import type { PublicArtworkDetail } from "@katha/shared";
import {
  activeListing,
  artworkCategoryLabels,
  artworkDimensionsLabel,
  artworkOriginLabel,
  artworkPhotoLabel,
  artworkPhotos,
  artworkPhotoUrl,
  type PublicListingState,
} from "../lib/artwork-page";
import type { ArtworkEvidence } from "../lib/artwork-provenance";
import { tokenAmount, unixSecondsIso } from "../lib/format";
import { ArtworkGallery } from "./artwork-gallery";
import { ArtworkPhysicalIdentity } from "./artwork-physical-identity";
import {
  ConditionPanel,
  CustodyPanel,
  custodyLabels,
  custodyTones,
  gradeLabels,
  gradeTones,
  observedCustody,
  reasonLabels,
  Time,
  VerificationPanel,
} from "./artwork-care";
import {
  ChainPanel,
  HistoryPanel,
  integrityStatus,
  OwnershipPanel,
  ownershipStatus,
} from "./artwork-provenance";
import { EvidenceTabs } from "./evidence-tabs";
import { CopyButton } from "./ui/copy-button";
import { Badge, Icon, Notice, type Tone } from "./ui/status";

function StatusRow({
  href,
  label,
  tone,
  badge,
  detail,
}: {
  href: string;
  label: string;
  tone: Tone;
  badge: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <a className="srow" href={href}>
      <span className="srow-k">{label}</span>
      <span className="srow-v">
        <Badge tone={tone}>{badge}</Badge>
        <span className="xs mut">{detail}</span>
      </span>
    </a>
  );
}

function SalePanel({
  artwork,
  listing,
  discrepancy,
}: {
  artwork: PublicArtworkDetail;
  listing: PublicListingState | undefined;
  discrepancy: boolean;
}) {
  const purchase = `/art/${artwork.kathaId}/purchase`;
  const active = activeListing(listing);
  if (discrepancy)
    return (
      <div className="panel cut flex flex-col gap-2">
        <p className="h3">Sale paused</p>
        <p className="p sm">
          Ownership records disagree, so this work can&apos;t be bought until Katha
          reconciles them. Its record stays public.
        </p>
      </div>
    );
  if (!listing || listing.kind === "UNAVAILABLE")
    return (
      <div className="panel cut flex flex-col gap-3">
        <p className="h3">Sale status unavailable</p>
        <p className="p sm">
          Katha couldn&apos;t check this work&apos;s listing just now. Purchase review
          checks the current listing before anything is prepared.
        </p>
        <Link className="btn btn-o cut-s self-start" href={purchase}>
          Review purchase
        </Link>
      </div>
    );
  if (!active)
    return (
      <div className="panel cut flex flex-col gap-2">
        <p className="h3">Not for sale right now</p>
        <p className="p sm">
          This work isn&apos;t listed. Its record stays public, and its owner can list
          it later.
        </p>
      </div>
    );
  return (
    <div className="panel cut flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <p className="h3 text-madder">For sale</p>
        <p className="xs mut m-0">
          {active.saleKind === "PRIMARY" ? "Primary sale" : "Secondary sale"}
        </p>
      </div>
      <p className="serif m-0 text-[34px] leading-[1.1] font-semibold text-ink">
        {tokenAmount(active.price)}{" "}
        <span className="font-sans text-base font-medium text-text-3">
          Katha test token
        </span>
      </p>
      <dl className="m-0">
        <div className="kv">
          <dt>Seller</dt>
          <dd className="id">{active.seller}</dd>
        </div>
        <div className="kv">
          <dt>Listing expires</dt>
          <dd>
            <Time value={unixSecondsIso(active.expiresAt)} />
          </dd>
        </div>
      </dl>
      <Link className="btn btn-p cut-s self-stretch" href={purchase}>
        Review purchase
      </Link>
      <p className="xs mut m-0">
        Reviewing doesn&apos;t reserve the work. Test token has no monetary value.
        Buying the work doesn&apos;t transfer its copyright.
      </p>
    </div>
  );
}

export function ArtworkDetail({
  artwork,
  apiOrigin,
  evidence = { history: null, integrity: { status: "UNAVAILABLE" } },
  listing,
  arrivedByNfc = false,
}: {
  artwork: PublicArtworkDetail;
  apiOrigin: string;
  evidence?: ArtworkEvidence;
  listing?: PublicListingState;
  arrivedByNfc?: boolean;
}) {
  const photos = artworkPhotos(artwork).map((media) => {
    const label = artworkPhotoLabel(media.role);
    return {
      key: `${media.id}:${media.contentHash}`,
      src: artworkPhotoUrl(apiOrigin, media),
      alt: media.altText?.trim() || `${artwork.title}, ${label.toLowerCase()}`,
      label,
    };
  });
  const category = artworkCategoryLabels[artwork.category];
  const { history, integrity } = evidence;
  const custody = observedCustody(artwork);
  const ownership = ownershipStatus(artwork, history);
  const integrityRow = integrityStatus[integrity.status];
  const discrepancy = history?.indexing.ownerCheck?.status === "MISMATCH";
  const delayed = history && ["LAGGING", "STALE"].includes(history.indexing.status);
  const integrityFailed =
    integrity.status === "MISMATCH" || integrity.status === "INVALID";
  const reading = [
    ["artwork-story", "Story", artwork.story],
    ["artwork-meaning", "Meaning", artwork.meaning],
    ["artwork-culture", "Cultural context", artwork.culturalContext],
    ["artwork-process", "How it was made", artwork.creationProcess],
  ] as const;
  return (
    <article
      className="ops-main"
      aria-labelledby="artwork-title"
      style={{
        paddingTop: "clamp(28px, 4vw, 48px)",
        paddingBottom: "clamp(72px, 8vw, 112px)",
      }}
    >
      <div className="wrap">
        {arrivedByNfc && (
          <Notice tone="info" icon="nfc" className="mb-7">
            <p>
              <strong>You tapped a Katha tag.</strong> It opened this artwork&apos;s
              public record. Compare the painting in front of you with the photos and
              details here; the tag alone doesn&apos;t prove the painting is authentic.{" "}
              <a className="lnk" href="#identify">
                How to identify this painting
              </a>
            </p>
          </Notice>
        )}
        <nav aria-label="Breadcrumb" className="crumbs">
          <Link className="lnk" href="/explore">
            Artworks
          </Link>
          <span aria-hidden="true">/</span>
          <Link className="lnk" href={`/explore?category=${artwork.category}`}>
            {category}
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="wrap-anywhere">
            {artwork.title}
          </span>
        </nav>

        <div className="artwork-layout mt-6">
          <div className="artwork-gallery min-w-0">
            <ArtworkGallery photos={photos} title={artwork.title} />
          </div>
          <div className="artwork-summary flex min-w-0 flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="chip-cat cut-s">{category}</span>
              <span className="sm mut">Created {artwork.creationYear}</span>
            </div>
            <h1 id="artwork-title" className="h1 h1-record">
              {artwork.title}
            </h1>
            <p className="m-0 text-lg text-ink">
              by{" "}
              <Link className="lnk" href={`/artists/${artwork.artist.slug}`}>
                {artwork.artist.displayName}
              </Link>
            </p>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-paper-2 px-4.5 py-3.5">
              <div className="min-w-0">
                <p className="xs mut m-0">Permanent Katha ID</p>
                <p className="id m-0 text-lg">{artwork.kathaId}</p>
              </div>
              <CopyButton
                value={artwork.kathaId}
                label="Copy Katha ID"
                text="Copy ID"
              />
            </div>
            <div>
              <StatusRow
                href="#ev-verification"
                label="Verification"
                tone="ok"
                badge="Verified"
                detail={
                  <>
                    Manual check recorded{" "}
                    <Time value={artwork.verification.transaction.recordedAt} date />
                  </>
                }
              />
              <StatusRow
                href="#ev-condition"
                label="Condition"
                tone={gradeTones[artwork.condition.grade]}
                badge={gradeLabels[artwork.condition.grade]}
                detail={
                  <>
                    Inspected <Time value={artwork.condition.inspectedAt} date />,{" "}
                    {reasonLabels[artwork.condition.reason].toLowerCase()}
                  </>
                }
              />
              <StatusRow
                href="#ev-custody"
                label="Physical custody"
                tone={custodyTones[custody?.state ?? "UNKNOWN"]}
                badge={custodyLabels[custody?.state ?? "UNKNOWN"]}
                detail={
                  custody ? (
                    <>
                      Recorded <Time value={custody.observedAt} />
                    </>
                  ) : (
                    "No dated observation"
                  )
                }
              />
              <StatusRow
                href="#ev-ownership"
                label="Digital ownership"
                tone={ownership.tone}
                badge={ownership.badge}
                detail={ownership.detail}
              />
              <StatusRow
                href="#ev-chain"
                label="Record integrity"
                tone={integrityRow.tone}
                badge={integrityRow.badge}
                detail={integrityRow.detail}
              />
            </div>
            <SalePanel artwork={artwork} listing={listing} discrepancy={discrepancy} />
          </div>
        </div>

        <section
          aria-labelledby="artwork-details"
          style={{ marginTop: "clamp(64px, 8vw, 112px)" }}
        >
          <div className="layout-split">
            <div
              className="panel flex min-w-0 flex-col gap-4"
              style={{ flex: "1 1 320px" }}
            >
              <h2 id="artwork-details" className="h2">
                About the work
              </h2>
              <dl className="m-0">
                <div className="kv kv-wide">
                  <dt>Tradition</dt>
                  <dd>{category}</dd>
                </div>
                <div className="kv kv-wide">
                  <dt>Created</dt>
                  <dd>{artwork.creationYear}</dd>
                </div>
                <div className="kv kv-wide">
                  <dt>Origin</dt>
                  <dd>{artworkOriginLabel(artwork.origin)}</dd>
                </div>
                <div className="kv kv-wide">
                  <dt>Dimensions</dt>
                  <dd>{artworkDimensionsLabel(artwork.dimensions)}</dd>
                </div>
                <div className="kv kv-wide">
                  <dt>Materials</dt>
                  <dd>
                    {artwork.materials.length
                      ? artwork.materials.join(", ")
                      : "Not documented"}
                  </dd>
                </div>
                <div className="kv kv-wide">
                  <dt>Technique</dt>
                  <dd>{artwork.technique ?? "Not documented"}</dd>
                </div>
              </dl>
              <p className="xs mut m-0">
                Attribution to {artwork.artist.displayName} is permanent and stays with
                the work after every sale. Buying a work doesn&apos;t automatically
                transfer its copyright or reproduction rights.
              </p>
            </div>
            <div className="panel min-w-0" style={{ flex: "2 1 520px" }}>
              {integrityFailed && (
                <Notice tone="err" icon="warning" className="mb-4">
                  <p>
                    <strong>
                      This record&apos;s metadata doesn&apos;t match its recorded
                      fingerprint.
                    </strong>{" "}
                    Don&apos;t rely on the story text below until Katha resolves it. The
                    rest of the record is unaffected.
                  </p>
                </Notice>
              )}
              {reading.map(([id, title, text], index) => (
                <details key={id} className="read" open={index === 0}>
                  <summary id={id}>
                    {title}
                    <Icon name="chevron" size={20} className="chev" />
                  </summary>
                  <div className="body">{text ?? "Not yet documented."}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <ArtworkPhysicalIdentity artwork={artwork} />

        <section
          id="evidence"
          aria-labelledby="evidence-heading"
          style={{ marginTop: "clamp(64px, 8vw, 112px)" }}
        >
          <div className="flex max-w-reading flex-col gap-2.5">
            <h2 id="evidence-heading" className="h2">
              Record and evidence
            </h2>
            <p className="p">
              What Katha has recorded about this work, and where each record lives.
              Recorded checks are manual assessments, not guarantees.
            </p>
          </div>
          {delayed && (
            <Notice tone="warn" icon="clock" className="mt-6">
              <p>
                <strong>Recent activity is still being indexed.</strong> Ownership and
                history may be a few minutes behind Solana.
              </p>
            </Notice>
          )}
          {discrepancy && (
            <Notice tone="err" icon="warning" className="mt-6">
              <p>
                <strong>Ownership records disagree.</strong> Katha&apos;s index lists{" "}
                <span className="id">{artwork.ownership.ownerWallet}</span>, but the
                owner observed on Solana differs. Katha is reconciling the two. Until
                then, don&apos;t rely on the recorded owner.
              </p>
            </Notice>
          )}
          {!history && artwork.indexing.freshness === "GAP_DETECTED" && (
            <Notice tone="warn" className="mt-6">
              <p>
                <strong>Some history is missing.</strong> Later inspections or custody
                changes may not appear yet.
              </p>
            </Notice>
          )}
          <div className="mt-7">
            <EvidenceTabs
              tabs={[
                {
                  id: "ev-verification",
                  label: "Verification",
                  content: <VerificationPanel artwork={artwork} />,
                },
                {
                  id: "ev-condition",
                  label: "Condition",
                  content: <ConditionPanel artwork={artwork} history={history} />,
                },
                {
                  id: "ev-custody",
                  label: "Custody",
                  content: <CustodyPanel artwork={artwork} history={history} />,
                },
                {
                  id: "ev-ownership",
                  label: "Ownership",
                  content: <OwnershipPanel artwork={artwork} history={history} />,
                },
                {
                  id: "provenance",
                  label: "History",
                  content: (
                    <HistoryPanel
                      artwork={artwork}
                      history={history}
                      apiOrigin={apiOrigin}
                    />
                  ),
                },
                {
                  id: "ev-chain",
                  label: "On-chain details",
                  content: <ChainPanel artwork={artwork} evidence={evidence} />,
                },
              ]}
            />
          </div>
        </section>
      </div>
    </article>
  );
}
