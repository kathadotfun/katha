import type { Metadata } from "next";
import { CollectorAccountPanel } from "../../components/collector-account";
import { safeReturnPath } from "../../lib/return-path";
// Read public wallet network/origin configuration at request time.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Account — Katha",
  robots: { index: false, follow: false },
};
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const next = safeReturnPath((await searchParams).next);
  return (
    <div className="app-main">
      <div className="wrap account-narrow">
        <CollectorAccountPanel next={next} />
      </div>
    </div>
  );
}
