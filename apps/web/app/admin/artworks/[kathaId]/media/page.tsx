import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { artworkDraftParamsSchema } from "@katha/shared";
import { ArtworkMediaPanel } from "../../../../../components/artwork-media";
export const metadata: Metadata = {
  title: "Artwork media — Katha",
  robots: { index: false, follow: false },
};
export default async function MediaPage({
  params,
}: {
  params: Promise<{ kathaId: string }>;
}) {
  const parsed = artworkDraftParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return (
    <div className="page-container admin-page">
      <Link href={`/admin/artworks/${parsed.data.kathaId}`} className="text-link">
        Artwork documentation
      </Link>
      <p className="eyebrow mt-8">Katha administration</p>
      <h1 className="mt-4 text-4xl sm:text-5xl">Artwork media</h1>
      <p className="mt-5 max-w-reading text-muted">
        Keep physical inspection evidence private. Approve photographs that tell the
        artwork’s cultural story.
      </p>
      <ArtworkMediaPanel kathaId={parsed.data.kathaId} />
    </div>
  );
}
