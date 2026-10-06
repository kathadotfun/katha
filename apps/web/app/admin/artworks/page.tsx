import Link from "next/link";
import type { Metadata } from "next";
import { ArtworkDraftListPanel } from "../../../components/artwork-draft-list";
export const metadata: Metadata = {
  title: "Artwork drafts — Katha",
  robots: { index: false, follow: false },
};
export default function ArtworkDraftsPage() {
  return (
    <div className="page-container admin-page">
      <Link href="/admin" className="text-link">
        Artist administration
      </Link>
      <p className="eyebrow mt-8">Katha administration</p>
      <h1 className="mt-4 text-4xl sm:text-5xl">Artwork drafts</h1>
      <p className="mt-5 max-w-reading text-muted">
        Follow the documentation of Nepal’s cultural art before publication. Artist
        verification and artwork onboarding remain separate.
      </p>
      <ArtworkDraftListPanel />
    </div>
  );
}
