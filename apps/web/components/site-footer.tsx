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
  if (variant === "ops" || variant === "collector")
    return (
      <footer className="ftr-ops">
        <div>
          {networkNote(cluster)}
          {variant === "ops" && " Operations are recorded with your wallet address."}
        </div>
      </footer>
    );
  return (
    <footer className="ftr">
      <div className="wrap flex flex-wrap gap-x-24 gap-y-9">
        <div className="flex max-w-[300px] flex-col gap-3.5">
          <Link className="brand" href="/" aria-label="Katha home">
            <KathaMark size={24} />
            <span className="brand-w text-sm">KATHA</span>
          </Link>
          <p className="p sm">Nepali art, tokenized as RWAs on Solana.</p>
        </div>
        <nav className="flex flex-wrap gap-x-18 gap-y-7" aria-label="Footer">
          <div className="fcol">
            <p className="lbl mb-1">Collect</p>
            <Link href="/explore">Artworks</Link>
            <Link href="/#record">Record</Link>
            <Link href="/account">Connect wallet</Link>
            <Link href="/collection">My collection</Link>
          </div>
          <div className="fcol">
            <p className="lbl mb-1">Learn</p>
            <Link href="/#own">What you own</Link>
            <Link href="/#how">How it works</Link>
            <Link href="/#faq">FAQ</Link>
          </div>
          <div className="fcol">
            <p className="lbl mb-1">Follow</p>
            <a href="https://katha.fun/">katha.fun</a>
            <a href="https://x.com/kathadotfun">X @kathadotfun</a>
          </div>
        </nav>
      </div>
      <div className="wrap mt-12 flex flex-wrap gap-x-8 gap-y-2">
        <p className="mono xs m-0">© {new Date().getFullYear()} Katha</p>
        <p className="mono xs m-0">{networkNote(cluster)}</p>
      </div>
    </footer>
  );
}
