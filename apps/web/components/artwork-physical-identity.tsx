import type { PublicArtworkDetail } from "@katha/shared";
import { artworkDimensionsLabel } from "../lib/artwork-page";

export function ArtworkPhysicalIdentity({ artwork }: { artwork: PublicArtworkDetail }) {
  return (
    <section
      aria-labelledby="artwork-physical-identity"
      className="mt-[var(--section-space)]"
    >
      <h2 id="artwork-physical-identity" className="text-section">
        Physical identity and NFC
      </h2>
      <p className="mt-6 max-w-reading text-lead">
        A permanent record for this physical artwork, with its artist and cultural story
        preserved when ownership changes.
      </p>
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section
          aria-labelledby="artwork-identification"
          className="min-w-0 border-t border-line pt-6"
        >
          <h3 id="artwork-identification" className="text-2xl">
            Compare the work with its record
          </h3>
          <dl className="artwork-facts mt-6">
            <div>
              <dt>Permanent Katha ID</dt>
              <dd>
                <a
                  className="text-link break-all font-mono text-sm"
                  href={`/art/${artwork.kathaId}`}
                >
                  {artwork.kathaId}
                </a>
              </dd>
            </div>
            <div>
              <dt>Artist</dt>
              <dd>{artwork.artist.displayName}</dd>
            </div>
            <div>
              <dt>Recorded dimensions</dt>
              <dd>{artworkDimensionsLabel(artwork.dimensions)}</dd>
            </div>
          </dl>
          <p className="mt-6 text-muted">
            Compare the physical work with the public photographs, dimensions, materials
            and technique in{" "}
            <a className="text-link" href="#artwork-details">
              About the work
            </a>
            . Missing details are not evidence of a match. A matching page alone cannot
            confirm that the object in front of you is authentic.
          </p>
          <p className="mt-4 text-muted">
            Review the{" "}
            <a className="text-link" href="#artwork-authenticity">
              recorded manual verification
            </a>
            ,{" "}
            <a className="text-link" href="#artwork-condition">
              latest available condition inspection
            </a>{" "}
            and{" "}
            <a className="text-link" href="#artwork-provenance">
              provenance and blockchain references
            </a>
            . Physical inspection remains a manual process.
          </p>
        </section>
        <section
          aria-labelledby="artwork-nfc"
          className="min-w-0 border-t border-line pt-6"
        >
          <h3 id="artwork-nfc" className="text-2xl">
            What an NFC tap tells you
          </h3>
          <p className="mt-6 text-muted">
            An assigned NFC tag opens the artwork&apos;s permanent Katha page. It is a
            discovery bridge to the record. A basic NFC tag can be cloned, and its link
            can be copied or attached to another object.
          </p>
          <p className="mt-4 text-muted">
            A successful tap does not independently prove authenticity, ownership,
            physical custody or delivery. This page does not confirm that a tag is
            attached, secure or currently active.
          </p>
          <p className="mt-4 text-muted">
            An unknown or retired tag may not open a record. That result alone does not
            establish whether the artwork is authentic. Check the permanent Katha ID and
            the recorded inspections before relying on a tag.
          </p>
        </section>
      </div>
    </section>
  );
}
