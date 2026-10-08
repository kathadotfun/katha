import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { kathaIdSchema } from "@katha/shared";
import { serverApiOrigin } from "../../../../lib/server-api";
import { PurchaseQuotePanel } from "../../../../components/purchase-quote";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Purchase quote — Katha",
  robots: { index: false, follow: false },
};
export default async function PurchasePage({
  params,
}: {
  params: Promise<{ kathaId: string }>;
}) {
  const id = kathaIdSchema.safeParse((await params).kathaId);
  if (!id.success) notFound();
  return (
    <div className="page-container py-16 sm:py-24">
      <p className="eyebrow text-brand">Collecting · Real World Assets</p>
      <h1 className="mt-4 text-section">Understand the purchase.</h1>
      <p className="mt-5 max-w-reading text-muted">
        Review the artwork’s test-token quote and how proceeds are distributed. Physical
        custody and artist authorship remain separate from digital ownership.
      </p>
      <Link
        className="text-link mt-5 inline-flex min-h-11 items-center"
        href={`/art/${id.data}`}
      >
        Back to the artwork
      </Link>
      <PurchaseQuotePanel kathaId={id.data} apiOrigin={serverApiOrigin()} />
    </div>
  );
}
