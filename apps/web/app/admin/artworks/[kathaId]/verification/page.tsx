import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { artworkDraftParamsSchema } from "@katha/shared";
import { ArtworkVerificationPanel } from "../../../../../components/artwork-verification";
export const metadata: Metadata = {
  title: "Artwork authenticity — Katha",
  robots: { index: false, follow: false },
};
export default async function VerificationPage({
  params,
}: {
  params: Promise<{ kathaId: string }>;
}) {
  const parsed = artworkDraftParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return (
    <div className="page-container admin-page">
      <Link href="/admin" className="text-link">
        Administration
      </Link>
      <Link href={`/admin/artworks/${parsed.data.kathaId}`} className="text-link ml-6">
        Artwork documentation
      </Link>
      <p className="eyebrow mt-8">Katha administration</p>
      <h1 className="mt-4 text-4xl sm:text-5xl">Artwork authenticity</h1>
      <p className="mt-5 max-w-reading text-muted">
        Review Nepal’s cultural artwork in person and attest to its authenticity with
        the authorized verifier wallet.
      </p>
      <ArtworkVerificationPanel kathaId={parsed.data.kathaId} />
    </div>
  );
}
