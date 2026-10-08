import type { Metadata } from "next";
import Link from "next/link";
import { serverApiOrigin } from "../../lib/server-api";
import { CollectorCollectionPanel } from "../../components/collector-collection";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "My collection — Katha",
  robots: { index: false, follow: false },
};
export default function CollectionPage() {
  return (
    <div className="page-container py-16 sm:py-24">
      <p className="eyebrow text-brand">Nepali art · Real World Assets</p>
      <h1 className="mt-4 text-section">Your collection, with its stories intact.</h1>
      <p className="mt-5 max-w-reading text-lead text-muted">
        The artworks indexed to your wallet, with artist authorship preserved and
        physical custody recorded separately.
      </p>
      <Link
        href="/account"
        className="text-link mt-5 inline-flex min-h-11 items-center"
      >
        Wallet &amp; account
      </Link>
      <CollectorCollectionPanel apiOrigin={serverApiOrigin()} />
    </div>
  );
}
