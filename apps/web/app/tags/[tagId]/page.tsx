import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { nfcTagIdSchema } from "@katha/shared";
import { TagStatus } from "../../../components/tag-status";
import { PublicApiError } from "../../../lib/public-api";
import { serverApi } from "../../../lib/server-api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Katha tag | Katha",
  robots: { index: false, follow: false },
};

// Browsers land here when the API resolver can't open an artwork for a tag.
export default async function TagPage({
  params,
}: {
  params: Promise<{ tagId: string }>;
}) {
  const parsed = nfcTagIdSchema.safeParse((await params).tagId);
  if (!parsed.success) notFound();
  const checkedAt = new Date().toISOString();
  let status;
  try {
    status = await serverApi().nfcTagStatus(parsed.data);
  } catch (error) {
    if (!(error instanceof PublicApiError)) throw error;
    return <TagStatus tagId={parsed.data} state="UNAVAILABLE" checkedAt={checkedAt} />;
  }
  if (status.state === "ACTIVE") redirect(`/art/${status.kathaId}?source=nfc`);
  return <TagStatus tagId={parsed.data} state={status.state} checkedAt={checkedAt} />;
}
