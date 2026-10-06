import Link from "next/link";
import type { Metadata } from "next";
import { ArtistOnboardingPanel } from "../../components/artist-onboarding";
export const metadata: Metadata = {
  title: "Administration — Katha",
  robots: { index: false, follow: false },
};
export default function AdminPage() {
  return (
    <div className="page-container admin-page">
      <p className="eyebrow">Katha administration</p>
      <h1 className="mt-4 text-4xl sm:text-5xl">Document the people behind the art.</h1>
      <p className="mt-5 max-w-reading text-muted">
        Onboard artists and record manual profile verification for Nepal’s cultural art.
      </p>
      <Link href="/admin/artworks" className="text-link mt-6 inline-block">
        Artwork drafts
      </Link>
      <ArtistOnboardingPanel />
    </div>
  );
}
