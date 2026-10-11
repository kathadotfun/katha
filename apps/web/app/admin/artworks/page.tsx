import type { Metadata } from "next";
import { ArtworkDraftListPanel } from "../../../components/artwork-draft-list";
export const metadata: Metadata = {
  title: "Artworks — Katha operations",
  robots: { index: false, follow: false },
};
export default function ArtworkDraftsPage() {
  return <ArtworkDraftListPanel />;
}
