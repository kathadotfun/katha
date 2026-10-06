import Link from "next/link";
import type { Metadata } from "next";
import { ArtworkDraftEditorPanel } from "../../../../components/artwork-draft-editor";
export const metadata: Metadata = {
  title: "Document artwork — Katha",
  robots: { index: false, follow: false },
};
export default function NewArtworkPage() {
  return (
    <div className="page-container admin-page">
      <Link href="/admin/artworks" className="text-link">
        Artwork drafts
      </Link>
      <p className="eyebrow mt-8">Katha administration</p>
      <h1 className="mt-4 text-4xl sm:text-5xl">Document a work of art.</h1>
      <p className="mt-5 max-w-reading text-muted">
        Preserve the artist’s attribution, materials and cultural story before
        verification.
      </p>
      <ArtworkDraftEditorPanel />
    </div>
  );
}
