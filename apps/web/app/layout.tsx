import { WalletProvider } from "../components/wallet-provider";
import { walletClusterSchema } from "@katha/shared";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Katha — Nepali Art & Real World Assets",
  description:
    "Nepali cultural art as Real World Assets, preserving artist authorship, cultural stories and verifiable provenance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="site-frame">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <WalletProvider
          cluster={walletClusterSchema.parse(process.env.KATHA_CLUSTER ?? "localnet")}
        >
          <SiteHeader />
        </WalletProvider>
        <main id="main-content" tabIndex={-1} className="min-w-0">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
