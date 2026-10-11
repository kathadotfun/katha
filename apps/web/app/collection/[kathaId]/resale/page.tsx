import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { kathaIdSchema } from "@katha/shared";
import { serverApiOrigin } from "../../../../lib/server-api";
import { collectorArtwork } from "../../../../lib/collector-page";
import { ResaleInspectionPanel } from "../../../../components/resale-inspection";
import { CollectorArtworkHeader } from "../../../../components/collector-artwork-header";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Inspection and resale — Katha",
  robots: { index: false, follow: false },
};
export default async function ResalePage({
  params,
}: {
  params: Promise<{ kathaId: string }>;
}) {
  const id = kathaIdSchema.safeParse((await params).kathaId);
  if (!id.success) notFound();
  return (
    <div className="app-main" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
      <div className="wrap">
        <CollectorArtworkHeader
          title="Inspection and resale"
          kathaId={id.data}
          artwork={await collectorArtwork(id.data)}
          apiOrigin={serverApiOrigin()}
        />
        <ResaleInspectionPanel kathaId={id.data} />
      </div>
    </div>
  );
}
