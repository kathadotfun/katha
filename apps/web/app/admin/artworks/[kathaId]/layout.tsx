import { notFound } from "next/navigation";
import { artworkDraftParamsSchema } from "@katha/shared";
import { ArtworkWorkflowNav } from "../../../../components/artwork-workflow-nav";

export default async function ArtworkWorkflowLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ kathaId: string }>;
}) {
  const parsed = artworkDraftParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return (
    <>
      <ArtworkWorkflowNav kathaId={parsed.data.kathaId} />
      <div className="mt-8">{children}</div>
    </>
  );
}
