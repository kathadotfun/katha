import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { artworkDraftParamsSchema } from "@katha/shared";
import { CustodyAdministrationPanel } from "../../../../../components/custody-administration";
export const metadata: Metadata = {
  title: "Custody coordination — Katha",
  robots: { index: false, follow: false },
};
export default async function CustodyPage({
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
      <p className="eyebrow mt-8">Katha administration</p>
      <h1 className="mt-4 text-4xl sm:text-5xl">Custody coordination</h1>
      <p className="mt-5 max-w-reading text-muted">
        Coordinate the physical care and delivery of Nepal’s cultural artwork, with
        private fulfillment details and explicit custody authority approval.
      </p>
      <CustodyAdministrationPanel kathaId={parsed.data.kathaId} />
    </div>
  );
}
