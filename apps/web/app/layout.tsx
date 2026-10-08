import { publicTransactionRpcUrl } from "../lib/transaction-rpc";
import { publicApiOrigin } from "../lib/public-api";
import { WalletProvider } from "../components/wallet-provider";
import { walletClusterSchema } from "@katha/shared";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Katha — Nepali Art & Real World Assets",
  description:
    "Nepali cultural art as Real World Assets, preserving artist authorship, cultural stories and verifiable provenance.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Wallet endpoints and cluster settings are selected when the server starts.
  // Prerendering would freeze build-machine defaults into administration pages.
  await connection();
  return (
    <html lang="en">
      <body className="site-frame">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <WalletProvider
          rpcUrl={publicTransactionRpcUrl(
            walletClusterSchema.parse(process.env.KATHA_CLUSTER ?? "localnet"),
            process.env.KATHA_PUBLIC_SOLANA_RPC_URL,
          )}
          apiOrigin={publicApiOrigin(
            process.env.KATHA_PUBLIC_API_ORIGIN ?? "http://localhost:3001",
          )}
          appOrigin={publicApiOrigin(
            process.env.KATHA_PUBLIC_APP_ORIGIN ?? "http://localhost:3000",
          )}
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
