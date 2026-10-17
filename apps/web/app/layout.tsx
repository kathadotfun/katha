import { publicTransactionRpcUrl } from "../lib/transaction-rpc";
import { publicApiOrigin } from "../lib/public-api";
import { WalletProvider } from "../components/wallet-provider";
import { walletClusterSchema } from "@katha/shared";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { BackToTop } from "../components/back-to-top";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Mukta } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

// Self-hosted by Next at build time; no runtime Google Fonts request.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});
const mukta = Mukta({
  subsets: ["latin", "devanagari"],
  weight: ["500"],
  variable: "--font-mukta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Katha — Nepali Art as Real-World Assets",
  description:
    "Tokenizing Nepali art: physical Mandala, Paubha and Thangka paintings backed 1:1 by onchain assets on Solana, with verified artists, custody and history.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Wallet endpoints and cluster settings are selected when the server starts.
  // Prerendering would freeze build-machine defaults into administration pages.
  await connection();
  const cluster = walletClusterSchema.parse(process.env.KATHA_CLUSTER ?? "localnet");
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${mukta.variable} t-dark`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('katha-theme');if(t==='light'){document.documentElement.classList.replace('t-dark','t-light')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="site-frame k">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <div className="app-shell public-shell">
          <div className="land" aria-hidden="true" />
          <div className="lotus" aria-hidden="true" />
          <WalletProvider
            rpcUrl={publicTransactionRpcUrl(
              cluster,
              process.env.KATHA_PUBLIC_SOLANA_RPC_URL,
            )}
            apiOrigin={publicApiOrigin(
              process.env.KATHA_PUBLIC_API_ORIGIN ?? "http://localhost:3001",
            )}
            appOrigin={publicApiOrigin(
              process.env.KATHA_PUBLIC_APP_ORIGIN ?? "http://localhost:3000",
            )}
            cluster={cluster}
          >
            <SiteHeader cluster={cluster} />
          </WalletProvider>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter cluster={cluster} />
          <BackToTop />
        </div>
      </body>
    </html>
  );
}
