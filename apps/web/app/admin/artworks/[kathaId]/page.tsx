import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { artworkDraftParamsSchema } from "@katha/shared";
import { ArtworkDraftEditorPanel } from "../../../../components/artwork-draft-editor";
export const metadata: Metadata = {
  title: "Artwork documentation — Katha",
  robots: { index: false, follow: false },
};
export default async function EditArtworkPage({
  params,
}: {
  params: Promise<{ kathaId: string }>;
}) {
  const parsed = artworkDraftParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return (
    <div className="page-container admin-page">
      <Link href="/admin/artworks" className="text-link">
        Artwork drafts
      </Link>
      <p className="eyebrow mt-8">Katha administration</p>
      <h1 className="mt-4 text-4xl sm:text-5xl">Artwork documentation</h1>
      <ArtworkDraftEditorPanel kathaId={parsed.data.kathaId} />
    </div>
  );
}
