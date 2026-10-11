import type { Metadata } from "next";
import { serverApiOrigin } from "../../lib/server-api";
import { CollectorCollectionPanel } from "../../components/collector-collection";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "My collection — Katha",
  robots: { index: false, follow: false },
};
export default function CollectionPage() {
  return <CollectorCollectionPanel apiOrigin={serverApiOrigin()} />;
}
