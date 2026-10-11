import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { artworkDraftParamsSchema } from "@katha/shared";
import { MetadataRevisionsPanel } from "../../../../../components/metadata-revisions";
export const metadata: Metadata = {
  title: "Metadata revisions — Katha operations",
  robots: { index: false, follow: false },
};
// The workflow layout renders the shared navigation for this permanent ID.
export default async function Page({
  params,
}: {
  params: Promise<{ kathaId: string }>;
}) {
  const parsed = artworkDraftParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const { kathaId } = parsed.data;
  return <MetadataRevisionsPanel kathaId={kathaId} />;
}
