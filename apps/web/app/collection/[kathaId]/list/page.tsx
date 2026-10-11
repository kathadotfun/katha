import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { kathaIdSchema } from "@katha/shared";
import { serverApiOrigin } from "../../../../lib/server-api";
import { collectorArtwork } from "../../../../lib/collector-page";
import { OwnerListingPanel } from "../../../../components/owner-listing";
import { CollectorArtworkHeader } from "../../../../components/collector-artwork-header";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Manage listing — Katha",
  robots: { index: false, follow: false },
};
export default async function ListingPage({
  params,
}: {
  params: Promise<{ kathaId: string }>;
}) {
  const id = kathaIdSchema.safeParse((await params).kathaId);
  if (!id.success) notFound();
  const apiOrigin = serverApiOrigin();
  return (
    <div className="app-main" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
      <div className="wrap">
        <CollectorArtworkHeader
          title="Manage listing"
          kathaId={id.data}
          artwork={await collectorArtwork(id.data)}
          apiOrigin={apiOrigin}
        />
        <OwnerListingPanel kathaId={id.data} apiOrigin={apiOrigin} />
      </div>
    </div>
  );
}
