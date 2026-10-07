import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { artworkDraftParamsSchema } from "@katha/shared";
import { ArtworkMintingPanel } from "../../../../../components/artwork-minting";
export const metadata: Metadata = {
  title: "Minting and publication — Katha",
  robots: { index: false, follow: false },
};
export default async function MintingPage({
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
      <Link
        href={`/admin/artworks/${parsed.data.kathaId}/verification`}
        className="text-link ml-6"
      >
        Artwork authenticity
      </Link>
      <Link
        href={`/admin/artworks/${parsed.data.kathaId}/custody`}
        className="text-link ml-6"
      >
        Custody coordination
      </Link>
      <p className="eyebrow mt-8">Katha administration</p>
      <h1 className="mt-4 text-4xl sm:text-5xl">Minting and publication</h1>
      <p className="mt-5 max-w-reading text-muted">
        Create a verified Real World Asset record for Nepal’s cultural artwork and
        publish its approved documentation after finalized reconciliation.
      </p>
      <ArtworkMintingPanel kathaId={parsed.data.kathaId} />
    </div>
  );
}
