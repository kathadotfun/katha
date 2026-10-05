import type {
  ConditionGrade,
  ConditionReason,
  PhysicalCustodyState,
  PublicArtworkDetail,
} from "@katha/shared";

const grades: Readonly<Record<ConditionGrade, string>> = {
  EXCELLENT: "Excellent",
  GOOD: "Good",
  FAIR: "Fair",
  POOR: "Poor",
  DAMAGED: "Damaged",
};
const reasons: Readonly<Record<ConditionReason, string>> = {
  INITIAL_VERIFICATION: "Initial verification",
  PRE_SALE: "Before sale",
  POST_DELIVERY: "After delivery",
  PRE_RESALE: "Before resale",
  RETURN_TO_CUSTODY: "Return to custody",
  INSURANCE: "Insurance inspection",
};
const custodyLabels: Readonly<Record<PhysicalCustodyState, string>> = {
  UNKNOWN: "Physical custody unknown",
  KATHA_HELD: "Recorded in Katha custody",
  COLLECTOR_HELD: "Recorded with a collector",
  IN_TRANSIT: "Recorded in transit",
};

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
function RecordedTime({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))} UTC</time>;
}

export function ArtworkCare({ artwork }: { artwork: PublicArtworkDetail }) {
  const { verification, condition, custody } = artwork;
  // A state without a dated physical observation is not evidence of possession.
  const observedCustody =
    custody.source === "MANUAL_OBSERVATION" &&
    custody.observedAt !== null &&
    custody.state !== "UNKNOWN";
  return (
    <section aria-labelledby="artwork-care" className="mt-[var(--section-space)]">
      <h2 id="artwork-care" className="text-section">
        Verification and physical care
      </h2>
      <p className="mt-6 max-w-reading text-muted">
        {artwork.indexing.freshness === "GAP_DETECTED"
          ? "Some history is missing. Later inspections or custody changes may not appear yet."
          : "Record freshness is unconfirmed. Later inspections or custody changes may not appear yet."}
      </p>
      <div className="mt-10 grid gap-10 lg:grid-cols-3">
        <section
          aria-labelledby="artwork-authenticity"
          className="min-w-0 border-t border-line pt-6"
        >
          <h3 id="artwork-authenticity" className="text-2xl">
            Authenticity
          </h3>
          <p className="mt-4 font-medium">Katha verification recorded</p>
          <p className="mt-4 text-muted">
            Katha manually inspected this artwork and recorded its verification.
            Blockchain preserves the record; it does not independently authenticate the
            physical work.
          </p>
          <dl className="artwork-facts mt-4">
            <div>
              <dt>Physical inspection</dt>
              <dd>
                <RecordedTime value={verification.inspectedAt} />
              </dd>
            </div>
            <div>
              <dt>Verification recorded</dt>
              <dd>
                <RecordedTime value={verification.transaction.recordedAt} />
              </dd>
            </div>
            <div>
              <dt>Verifier wallet</dt>
              <dd className="break-all font-mono text-sm">
                {verification.verifierWallet}
              </dd>
            </div>
          </dl>
        </section>
        <section
          aria-labelledby="artwork-condition"
          className="min-w-0 border-t border-line pt-6"
        >
          <h3 id="artwork-condition" className="text-2xl">
            Condition
          </h3>
          <p className="mt-4 font-medium">
            {grades[condition.grade]} · Report #{condition.version}
          </p>
          <p className="mt-4 text-muted">
            This is the latest available inspection, not a live assessment of the work.
            Earlier reports remain part of its history.
          </p>
          <dl className="artwork-facts mt-4">
            <div>
              <dt>Inspected</dt>
              <dd>
                <RecordedTime value={condition.inspectedAt} />
              </dd>
            </div>
            <div>
              <dt>Inspection purpose</dt>
              <dd>{reasons[condition.reason]}</dd>
            </div>
            <div>
              <dt>Inspector wallet</dt>
              <dd className="break-all font-mono text-sm">
                {condition.verifierWallet}
              </dd>
            </div>
          </dl>
          {condition.reason === "PRE_RESALE" && (
            <p className="mt-4 text-sm text-muted">
              A pre-resale inspection alone does not establish resale approval.
            </p>
          )}
        </section>
        <section
          aria-labelledby="artwork-custody"
          className="min-w-0 border-t border-line pt-6"
        >
          <h3 id="artwork-custody" className="text-2xl">
            Physical custody
          </h3>
          <p className="mt-4 font-medium">
            {custodyLabels[observedCustody ? custody.state : "UNKNOWN"]}
          </p>
          <p className="mt-4 text-muted">
            Physical custody describes who holds or safeguards the artwork. Digital
            ownership can change without moving the physical work.
          </p>
          {observedCustody ? (
            <dl className="artwork-facts mt-4">
              <div>
                <dt>Last physical observation</dt>
                <dd>
                  <RecordedTime value={custody.observedAt!} />
                </dd>
              </div>
              <div>
                <dt>Record source</dt>
                <dd>Manual custody observation</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-muted">
              A dated physical custody observation is unavailable. No holder or delivery
              status is inferred.
            </p>
          )}
          {observedCustody && custody.state === "IN_TRANSIT" && (
            <p className="mt-4 text-sm text-muted">
              Recorded transit does not confirm receipt by a collector.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
