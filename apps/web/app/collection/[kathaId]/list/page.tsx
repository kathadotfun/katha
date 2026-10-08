import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { kathaIdSchema } from "@katha/shared";
import { serverApiOrigin } from "../../../../lib/server-api";
import { OwnerListingPanel } from "../../../../components/owner-listing";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "List an artwork — Katha",
  robots: { index: false, follow: false },
};
export default async function ListingPage({
  params,
}: {
  params: Promise<{ kathaId: string }>;
}) {
  const id = kathaIdSchema.safeParse((await params).kathaId);
  if (!id.success) notFound();
  return (
    <div className="page-container py-16 sm:py-24">
      <p className="eyebrow text-brand">Owner listing · Test environment</p>
      <h1 className="mt-4 text-section">Offer your artwork for sale.</h1>
      <p className="mt-5 max-w-reading text-muted">
        Preserve the artist’s authorship while offering digital ownership. Listing locks
        the Core asset temporarily; physical custody stays separate.
      </p>
      <Link
        href="/collection"
        className="text-link mt-5 inline-flex min-h-11 items-center"
      >
        Back to my collection
      </Link>
      <OwnerListingPanel kathaId={id.data} apiOrigin={serverApiOrigin()} />
    </div>
  );
}
