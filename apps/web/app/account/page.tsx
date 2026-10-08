import type { Metadata } from "next";
import { CollectorAccountPanel } from "../../components/collector-account";
// Read public wallet network/origin configuration at request time.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "My account — Katha",
  robots: { index: false, follow: false },
};
export default function AccountPage() {
  return (
    <div className="page-container py-16 sm:py-24">
      <p className="eyebrow text-brand">Your Katha account</p>
      <h1 className="mt-4 text-section">A place for your collecting journey.</h1>
      <p className="mt-5 max-w-reading text-lead text-muted">
        Collect Nepali cultural art as Real World Assets, with the artist’s story and
        authorship preserved.
      </p>
      <CollectorAccountPanel />
    </div>
  );
}
