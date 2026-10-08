import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { kathaIdSchema } from "@katha/shared";
import { serverApiOrigin } from "../../../../lib/server-api";
import { CollectorDeliveryPanel } from "../../../../components/collector-delivery";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Artwork delivery — Katha",
  robots: { index: false, follow: false },
};
export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ kathaId: string }>;
}) {
  const id = kathaIdSchema.safeParse((await params).kathaId);
  if (!id.success) notFound();
  return (
    <div className="page-container py-16 sm:py-24">
      <p className="eyebrow text-brand">Collecting · Real World Assets</p>
      <h1 className="mt-4 text-section">Bring the artwork home.</h1>
      <p className="mt-5 max-w-reading text-muted">
        Request delivery of your Nepali artwork and coordinate its receipt. Digital
        ownership, physical custody and condition inspection remain separate.
      </p>
      <Link
        href="/collection"
        className="text-link mt-5 inline-flex min-h-11 items-center"
      >
        Back to my collection
      </Link>
      <CollectorDeliveryPanel kathaId={id.data} apiOrigin={serverApiOrigin()} />
    </div>
  );
}
