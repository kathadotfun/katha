import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { artworkDraftParamsSchema } from "@katha/shared";
import { ArtworkRegistrationPanel } from "../../../../../components/artwork-registration";
export const metadata: Metadata = {
  title: "Artwork registration — Katha",
  robots: { index: false, follow: false },
};
export default async function RegistrationPage({
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
      <h1 className="mt-4 text-4xl sm:text-5xl">Artwork registration</h1>
      <p className="mt-5 max-w-reading text-muted">
        Register the permanent identity and artist attribution. Preserve the artwork’s
        cultural story.
      </p>
      <ArtworkRegistrationPanel kathaId={parsed.data.kathaId} />
    </div>
  );
}
