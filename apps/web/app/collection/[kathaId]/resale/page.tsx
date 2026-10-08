import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { kathaIdSchema } from "@katha/shared";
import { ResaleInspectionPanel } from "../../../../components/resale-inspection";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Inspected resale — Katha",
  robots: { index: false, follow: false },
};
export default async function ResalePage({
  params,
}: {
  params: Promise<{ kathaId: string }>;
}) {
  const parsed = kathaIdSchema.safeParse((await params).kathaId);
  if (!parsed.success) notFound();
  return (
    <div className="page-container py-16 sm:py-24">
      <p className="eyebrow text-brand">Collecting · Real World Assets</p>
      <h1 className="mt-4 text-section">Preserve the story through resale.</h1>
      <p className="mt-5 max-w-reading text-muted">
        Coordinate Katha’s inspection before offering collector-held Nepali artwork to
        its next owner.
      </p>
      <Link
        className="text-link mt-5 inline-flex min-h-11 items-center"
        href="/collection"
      >
        Back to my collection
      </Link>
      <ResaleInspectionPanel kathaId={parsed.data} />
    </div>
  );
}
