"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { headerVariant } from "../lib/site-routes";
import { KathaMark } from "./ui/katha-mark";

export function networkNote(cluster: "localnet" | "devnet") {
  return cluster === "devnet"
    ? "Running on Solana Devnet. Katha test token — no monetary value."
    : "Running on a local Solana network for development. Katha test token — no monetary value.";
}

export function SiteFooter({ cluster }: { cluster: "localnet" | "devnet" }) {
  const variant = headerVariant(usePathname() ?? "/");
  if (variant === "ops")
    return (
      <footer className="ftr-ops">
        <div className="wrap flex flex-wrap justify-between gap-x-6 gap-y-2">
          <span>
            Katha operations, {cluster === "devnet" ? "Solana Devnet" : "local network"}
          </span>
          <span>Actions here are recorded with your wallet address.</span>
        </div>
      </footer>
    );
  if (variant === "home")
    return (
      <footer className="ftr ftr-home dk">
        <div className="wrap">
          <div className="flex flex-wrap justify-between gap-12">
            <div className="flex max-w-[320px] flex-col gap-4">
              <Link
                className="brand"
                href="/"
                aria-label="Katha home"
                style={{ textDecoration: "none" }}
              >
                <KathaMark size={34} variant="footer" />
                <span className="brand-w" style={{ fontSize: 22 }}>
                  KATHA
                </span>
              </Link>
              <p className="m-0 text-base">
                Tokenizing Nepali art: physical paintings as real-world assets on
                Solana.
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-18 gap-y-10">
              <div className="flex flex-col gap-1.5">
                <p className="serif m-0 mb-1.5 text-lg font-semibold text-paper">
                  Explore
                </p>
                <Link className="flink" href="/explore">
                  Artworks
                </Link>
                <Link className="flink" href="/#rwa">
                  Why RWAs
                </Link>
                <Link className="flink" href="/#traditions">
                  Traditions
                </Link>
                <Link className="flink" href="/#collecting">
                  How collecting works
                </Link>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="serif m-0 mb-1.5 text-lg font-semibold text-paper">
                  Collectors
                </p>
                <Link className="flink" href="/account">
                  Sign in
                </Link>
                <Link className="flink" href="/collection">
                  My collection
                </Link>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="serif m-0 mb-1.5 text-lg font-semibold text-paper">
                  Follow
                </p>
                <a className="flink" href="https://katha.fun/">
                  katha.fun
                </a>
                <a className="flink" href="https://x.com/kathadotfun">
                  X @kathadotfun
                </a>
              </div>
            </nav>
          </div>
          <div className="mt-14 flex flex-wrap justify-between gap-x-8 gap-y-2 border-t border-[rgba(243,232,216,0.14)] pt-6">
            <p className="m-0 text-sm text-footer-text">
              © {new Date().getFullYear()} Katha
            </p>
            <p className="m-0 text-sm text-footer-text">{networkNote(cluster)}</p>
          </div>
        </div>
      </footer>
    );
  return (
    <footer className="ftr dk">
      <div className="wrap flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <Link className="brand" href="/" aria-label="Katha home">
          <KathaMark size={26} variant="footer" />
          <span className="brand-w" style={{ fontSize: 18 }}>
            KATHA
          </span>
        </Link>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
          <Link href="/explore">Artworks</Link>
          <Link href="/collection">My collection</Link>
          <a href="https://katha.fun/">katha.fun</a>
          <a href="https://x.com/kathadotfun">X @kathadotfun</a>
        </nav>
        <p className="xs m-0 basis-full text-footer-text">{networkNote(cluster)}</p>
      </div>
    </footer>
  );
}
