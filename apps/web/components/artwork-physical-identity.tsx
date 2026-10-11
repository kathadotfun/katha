import type { PublicArtworkDetail } from "@katha/shared";
import { artworkDimensionsLabel } from "../lib/artwork-page";

// NFC is a discovery bridge to this record. A tap never authenticates the object.
export function ArtworkPhysicalIdentity({ artwork }: { artwork: PublicArtworkDetail }) {
  return (
    <section
      id="identify"
      aria-labelledby="artwork-physical-identity"
      className="panel cut"
      style={{ marginTop: "clamp(56px, 7vw, 96px)", padding: "clamp(24px, 4vw, 48px)" }}
    >
      <div className="flex flex-wrap items-start gap-x-12 gap-y-4">
        <div className="flex min-w-0 flex-col gap-2.5" style={{ flex: "1 1 280px" }}>
          <h2 id="artwork-physical-identity" className="h2">
            Identifying this painting
          </h2>
          <p className="p">
            For anyone holding the work, or looking at it after tapping its tag.
          </p>
        </div>
        <div
          className="grid min-w-0"
          style={{
            flex: "2 1 520px",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
            gap: "24px 32px",
          }}
        >
          <div className="flex flex-col gap-1.5">
            <h3 className="h3">Measure it</h3>
            <p className="p sm">
              {artwork.dimensions
                ? `The work should measure ${artworkDimensionsLabel(artwork.dimensions)}.`
                : "Dimensions aren't documented yet, so measuring can't confirm a match."}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="h3">Compare the details</h3>
            <p className="p sm">
              Check distinctive details against the approved photos at full size, not
              just the overall look. Missing details aren&apos;t evidence of a match.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 id="artwork-nfc" className="h3">
              Check the tag
            </h3>
            <p className="p sm">
              A Katha tag, if the work has one, should open this record and Katha ID{" "}
              <span className="id">{artwork.kathaId}</span>. A basic tag can be copied
              or moved, so a successful tap doesn&apos;t prove authenticity, ownership
              or custody.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="h3">If something doesn&apos;t match</h3>
            <p className="p sm">
              Treat the painting as unverified. A tag can be moved; the record and the{" "}
              <a className="lnk" href="#evidence">
                evidence below
              </a>{" "}
              are what count. Physical inspection remains a manual process.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
