import type {
  ArtworkProvenanceResponse,
  ConditionGrade,
  ConditionReason,
  PhysicalCustodyState,
  PublicArtworkDetail,
} from "@katha/shared";
import { utcDate, utcDateTime } from "../lib/format";
import { explorerLink } from "../lib/artwork-provenance";
import { Badge, type Tone } from "./ui/status";

export const gradeLabels: Readonly<Record<ConditionGrade, string>> = {
  EXCELLENT: "Excellent",
  GOOD: "Good",
  FAIR: "Fair",
  POOR: "Poor",
  DAMAGED: "Damaged",
};
export const gradeTones: Readonly<Record<ConditionGrade, Tone>> = {
  EXCELLENT: "ok",
  GOOD: "ok",
  FAIR: "warn",
  POOR: "err",
  DAMAGED: "err",
};
export const reasonLabels: Readonly<Record<ConditionReason, string>> = {
  INITIAL_VERIFICATION: "Initial verification",
  PRE_SALE: "Before sale",
  POST_DELIVERY: "After delivery",
  PRE_RESALE: "Before resale",
  RETURN_TO_CUSTODY: "Return to custody",
  INSURANCE: "Insurance",
};
export const custodyLabels: Readonly<Record<PhysicalCustodyState, string>> = {
  UNKNOWN: "Not recorded",
  KATHA_HELD: "Held by Katha",
  COLLECTOR_HELD: "With a collector",
  IN_TRANSIT: "In transit",
};
export const custodyTones: Readonly<Record<PhysicalCustodyState, Tone>> = {
  UNKNOWN: "neu",
  KATHA_HELD: "neu",
  COLLECTOR_HELD: "warn",
  IN_TRANSIT: "info",
};

export function Time({ value, date = false }: { value: string; date?: boolean }) {
  return <time dateTime={value}>{date ? utcDate(value) : utcDateTime(value)}</time>;
}

export function Reference({
  cluster,
  kind,
  value,
}: {
  cluster: PublicArtworkDetail["chain"]["cluster"];
  kind: "address" | "tx";
  value: string;
}) {
  const href = explorerLink(cluster, kind, value);
  return href ? (
    <a className="lnk id" href={href} target="_blank" rel="noopener noreferrer">
      {value}
      <span className="sr-only">, Solana Devnet Explorer, opens in a new tab</span>
    </a>
  ) : (
    <span className="id">{value}</span>
  );
}

// A state without a dated physical observation is not evidence of possession.
export function observedCustody(artwork: PublicArtworkDetail) {
  const { custody } = artwork;
  return custody.source === "MANUAL_OBSERVATION" &&
    custody.observedAt !== null &&
    custody.state !== "UNKNOWN"
    ? { state: custody.state, observedAt: custody.observedAt }
    : null;
}

export function VerificationPanel({ artwork }: { artwork: PublicArtworkDetail }) {
  const { verification } = artwork;
  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <h3 id="artwork-authenticity" className="h3">
        Authenticity verification
      </h3>
      <dl className="m-0">
        <div className="kv kv-wide">
          <dt>Status</dt>
          <dd>
            <Badge tone="ok">Verified</Badge>
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Physical inspection</dt>
          <dd>
            <Time value={verification.inspectedAt} />
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Recorded</dt>
          <dd>
            <Time value={verification.transaction.recordedAt} />
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Verifier wallet</dt>
          <dd>
            <Reference
              cluster={artwork.chain.cluster}
              kind="address"
              value={verification.verifierWallet}
            />
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>What was checked</dt>
          <dd>
            The physical work was inspected in person, and its authorship evidence was
            matched to {artwork.artist.displayName}.
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Transaction</dt>
          <dd>
            <Reference
              cluster={artwork.chain.cluster}
              kind="tx"
              value={verification.transaction.signature}
            />
          </dd>
        </div>
      </dl>
      <p className="xs mut m-0">
        A verification is a recorded manual assessment by a Katha verifier. It
        isn&apos;t a guarantee of authenticity. Solana preserves the record; it
        doesn&apos;t independently authenticate the physical work.
      </p>
    </div>
  );
}

export function ConditionPanel({
  artwork,
  history,
}: {
  artwork: PublicArtworkDetail;
  history: ArtworkProvenanceResponse | null;
}) {
  const { condition } = artwork;
  const earlier =
    history?.items.flatMap((event) =>
      event.type === "CONDITION" && event.data.version !== condition.version
        ? [event]
        : [],
    ) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <h3 id="artwork-condition" className="h3">
        Latest condition inspection
      </h3>
      <dl className="m-0 max-w-[760px]">
        <div className="kv kv-wide">
          <dt>Grade</dt>
          <dd>
            <Badge tone={gradeTones[condition.grade]}>
              {gradeLabels[condition.grade]}
            </Badge>
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Inspected</dt>
          <dd>
            <Time value={condition.inspectedAt} />
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Reason</dt>
          <dd>{reasonLabels[condition.reason]}</dd>
        </div>
        <div className="kv kv-wide">
          <dt>Report version</dt>
          <dd>
            Version {condition.version}
            {condition.version > 1
              ? ` (replaces version ${condition.version - 1})`
              : ""}
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Inspector wallet</dt>
          <dd>
            <Reference
              cluster={artwork.chain.cluster}
              kind="address"
              value={condition.verifierWallet}
            />
          </dd>
        </div>
        <div className="kv kv-wide">
          <dt>Report fingerprint</dt>
          <dd className="id">sha256 {condition.documentHash}</dd>
        </div>
      </dl>
      {condition.reason === "PRE_RESALE" && (
        <p className="p sm">
          A pre-resale inspection alone doesn&apos;t establish resale approval.
        </p>
      )}
      {earlier.length > 0 && (
        <>
          <h3 className="h3 mt-4">Earlier inspections</h3>
          <ul className="m-0 list-none p-0">
            {earlier.map((event) => (
              <li key={event.id} className="kv justify-between">
                <span>{reasonLabels[event.data.reason]}</span>
                <span className="mut">
                  <Time value={event.data.inspectedAt} date />, grade{" "}
                  {gradeLabels[event.data.grade]}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="xs mut m-0">
        This is the latest available inspection, not a live assessment. Inspection notes
        and private evidence stay private; the public record shows the grade, date,
        reason and report fingerprint, plus any photos Katha approved for public view.
      </p>
    </div>
  );
}

export function CustodyPanel({
  artwork,
  history,
}: {
  artwork: PublicArtworkDetail;
  history: ArtworkProvenanceResponse | null;
}) {
  const observed = observedCustody(artwork);
  const latest = history?.items.findLast((event) => event.type === "CUSTODY");
  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <h3 id="artwork-custody" className="h3">
        Physical custody
      </h3>
      <dl className="m-0">
        <div className="kv kv-wide">
          <dt>Recorded custody</dt>
          <dd>{custodyLabels[observed?.state ?? "UNKNOWN"]}</dd>
        </div>
        {observed ? (
          <>
            <div className="kv kv-wide">
              <dt>Last observed</dt>
              <dd>
                <Time value={observed.observedAt} />
              </dd>
            </div>
            <div className="kv kv-wide">
              <dt>Source</dt>
              <dd>Manual custody observation</dd>
            </div>
          </>
        ) : (
          <div className="kv kv-wide">
            <dt>Last observed</dt>
            <dd>
              No dated physical observation is available. No holder or delivery status
              is inferred.
            </dd>
          </div>
        )}
        {latest?.type === "CUSTODY" && (
          <>
            <div className="kv kv-wide">
              <dt>Revision</dt>
              <dd>{latest.data.revision}</dd>
            </div>
            <div className="kv kv-wide">
              <dt>Transaction</dt>
              <dd>
                <Reference
                  cluster={artwork.chain.cluster}
                  kind="tx"
                  value={latest.transaction.signature}
                />
              </dd>
            </div>
          </>
        )}
      </dl>
      {observed?.state === "IN_TRANSIT" && (
        <p className="p sm">
          Recorded transit doesn&apos;t confirm receipt by a collector.
        </p>
      )}
      <p className="xs mut m-0">
        Custody is who physically holds the painting. It&apos;s recorded separately from
        digital ownership and can differ from it.
      </p>
    </div>
  );
}
