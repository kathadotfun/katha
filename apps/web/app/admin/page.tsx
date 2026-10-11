import type { Metadata } from "next";
import { AdministrationPanel } from "../../components/artist-onboarding";
export const metadata: Metadata = {
  title: "Administration — Katha",
  robots: { index: false, follow: false },
};
export default function AdminPage() {
  return <AdministrationPanel />;
}
